"""Read Apple ToolKit databases without modifying them; export catalog output schemas.

Usage: python3 scripts/extract-action-results.py [database.sqlite ...]
With no arguments, inspect the host and installed simulator ToolKit databases.
Only catalog actions, their referenced output type definitions and static entity
property declarations (identifier, English title, value type) are exported.
"""
import collections
import json
from pathlib import Path
import re
import sqlite3
import sys

ROOT = Path(__file__).resolve().parent.parent


def fields(data):
    """Decode the protobuf wire envelope, rejecting unrecognized wire encodings."""
    offset = 0

    def varint():
        nonlocal offset
        result = shift = 0
        while offset < len(data) and shift < 70:
            byte = data[offset]
            offset += 1
            result |= (byte & 127) << shift
            if byte < 128:
                return result
            shift += 7
        raise ValueError('Truncated or invalid protobuf varint')

    result = []
    while offset < len(data):
        tag = varint()
        number, wire = tag >> 3, tag & 7
        if not number:
            raise ValueError('Invalid protobuf field zero')
        if wire == 0:
            value = varint()
        elif wire == 2:
            length = varint()
            value = data[offset:offset + length]
            offset += length
            if len(value) != length:
                raise ValueError('Truncated protobuf message')
        else:
            raise ValueError(f'Unsupported protobuf wire type {wire}')
        result.append((number, value))
    return result


def decode_instance(blob, identifiers, expected):
    items = fields(blob)
    if len(items) != 1:
        raise ValueError('Expected one TypeInstance variant')
    kind, value = items[0]
    if not isinstance(value, bytes):
        raise ValueError('Expected nested TypeInstance message')
    if kind == 1:
        choices = identifiers.get(value, [])
        matches = [item for item in choices if item in expected]
        if len(matches) != 1:
            raise ValueError(f'Unresolved type identifier: {choices}')
        return {'kind': 'type', 'id': matches[0]}
    if kind == 2:
        return {'kind': 'array', 'element': decode_instance(value, identifiers, expected)}
    if kind == 4:
        members = fields(value)
        if not members or any(key != 1 or not isinstance(item, bytes) for key, item in members):
            raise ValueError('Unsupported union encoding')
        variants = [decode_instance(item, identifiers, expected) for _, item in members]
        return {'kind': 'union', 'members': sorted(variants, key=lambda item: json.dumps(item, sort_keys=True))}
    raise ValueError(f'Unsupported TypeInstance variant {kind}')


def entity_properties(connection, type_id, identifiers, known):
    try:
        rows = connection.execute(
            "SELECT p.id, p.typeInstance, (SELECT displayName FROM EntityPropertyLocalizations l "
            "WHERE l.typeId = p.typeId AND l.propertyId = p.id AND l.locale = 'en') "
            "FROM EntityProperties p WHERE p.typeId = ? ORDER BY p.id", (type_id,)).fetchall()
    except sqlite3.OperationalError:
        return []
    properties = []
    for identifier, blob, title in rows:
        optional = False
        try:
            items = fields(blob)
            while len(items) == 1 and items[0][0] in (3, 6) and isinstance(items[0][1], bytes):
                # Property wrappers hold the value TypeInstance in field 1: variant 3 marks
                # an optional value; variant 6 appears on settable entity properties.
                inner = fields(items[0][1])
                if len(inner) != 1 or inner[0][0] != 1 or not isinstance(inner[0][1], bytes):
                    raise ValueError('Unsupported property wrapper encoding')
                blob, optional = inner[0][1], optional or items[0][0] == 3
                items = fields(blob)
            schema = decode_instance(blob, identifiers, known)
        except (ValueError, TypeError):
            # An undecodable property type is omitted rather than guessed.
            continue
        properties.append({'id': identifier, 'title': title, 'schema': schema, **({'optional': True} if optional else {})})
    return properties


def type_ids(schema):
    if schema['kind'] == 'type':
        return {schema['id']}
    if schema['kind'] == 'array':
        return type_ids(schema['element'])
    return set().union(*(type_ids(member) for member in schema['members']))


def extract(paths, catalog):
    actions, types, priorities, type_priorities = {}, {}, {}, {}
    for path in sorted(paths):
        version = int(re.search(r'\.v(\d+)', path.name).group(1))
        platform = 'iOS Simulator' if 'CoreSimulator' in str(path) else 'macOS'
        source = f'Apple ToolKit v{version}, {platform}'
        with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as connection:
            connection.execute('PRAGMA query_only = ON')
            identifiers = collections.defaultdict(list)
            definitions = {}
            for identifier, blob, kind in connection.execute('SELECT rowId, id, kind FROM Types'):
                identifiers[blob].append(identifier)
                definitions[identifier] = kind
            try:
                rows = connection.execute('SELECT rowId, id, outputTypeInstance FROM Tools').fetchall()
            except sqlite3.OperationalError:
                continue
            for row_id, identifier, blob in rows:
                if identifier not in catalog:
                    continue
                priority = (version, platform == 'iOS Simulator')
                if priorities.get(identifier, (-1, False)) >= priority:
                    continue
                expected = {row[0] for row in connection.execute('SELECT typeIdentifier FROM ToolOutputTypes WHERE toolId = ?', (row_id,))}
                try:
                    schema = decode_instance(blob, identifiers, expected)
                except (ValueError, TypeError) as error:
                    # Missing metadata is never silently turned into void or a guessed primitive.
                    actions[identifier] = {'status': 'unresolved', 'reason': str(error), 'source': source}
                    priorities[identifier] = priority
                    continue
                actions[identifier] = {'status': 'known', 'schema': schema, 'source': source}
                priorities[identifier] = priority
                pending = list(type_ids(schema))
                while pending:
                    type_id = pending.pop()
                    if type_priorities.get(type_id, (-1, False)) >= priority:
                        continue
                    kind = definitions[type_id]
                    definition = {'kind': kind, 'source': source}
                    # AppEnum cases are static. Do not export dynamic picker/entity data.
                    if kind == 3:
                        cases = [dict(id=case, title=title) for case, title in connection.execute(
                            "SELECT id, title FROM EnumerationCases WHERE typeId = ? AND locale = 'en' ORDER BY id", (type_id,))]
                        if cases:
                            definition['cases'] = cases
                    elif kind == 2:
                        # Static App Entity property declarations (identifier, English title, value type).
                        # Property values are never read.
                        properties = entity_properties(connection, type_id, identifiers, set(definitions))
                        if properties:
                            definition['properties'] = properties
                            for item in properties:
                                pending.extend(type_ids(item['schema']))
                    types[type_id] = definition
                    type_priorities[type_id] = priority
    for identifier in sorted(catalog - actions.keys()):
        actions[identifier] = {'status': 'unresolved', 'reason': 'Absent from the inspected Apple ToolKit databases.'}
    referenced = set().union(*(type_ids(a['schema']) for a in actions.values() if a['status'] == 'known'))
    pending = list(referenced)
    while pending:
        for item in types.get(pending.pop(), {}).get('properties', []):
            for type_id in type_ids(item['schema']) - referenced:
                referenced.add(type_id)
                pending.append(type_id)
    return {
        'formatVersion': 1,
        'notice': 'Apple-declared output schemas, not device execution guarantees. Enum titles use English localization. Missing and parameter-dependent results are explicit.',
        'actions': dict(sorted(actions.items())),
        'types': {key: types[key] for key in sorted(referenced)},
    }


if __name__ == '__main__':
    paths = list(map(Path, sys.argv[1:])) if len(sys.argv) > 1 else [
        *Path.home().joinpath('Library/Shortcuts/ToolKit').glob('*.sqlite'),
        *Path.home().joinpath('Library/Developer/CoreSimulator/Devices').glob('*/data/Library/Shortcuts/ToolKit/*.sqlite'),
    ]
    if not paths:
        raise SystemExit('No ToolKit databases found. Pass their paths explicitly.')
    catalog = {a['id'] for a in json.loads((ROOT / 'data/actions.json').read_text())['actions']}
    snapshot = extract(paths, catalog)
    (ROOT / 'data/action-results.json').write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + '\n')
    counts = collections.Counter(a['status'] for a in snapshot['actions'].values())
    print(f'Output schemas: {dict(counts)}; {len(snapshot["types"])} referenced types.')
