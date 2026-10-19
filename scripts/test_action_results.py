import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

from action_results import render, result_for

spec = importlib.util.spec_from_file_location('extract_results', Path(__file__).with_name('extract-action-results.py'))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


def message(field, payload):
    assert len(payload) < 128
    return bytes([field * 8 + 2, len(payload)]) + payload


class OutputMetadataTests(unittest.TestCase):
    def test_new_catalog_actions_are_explicitly_unresolved(self):
        self.assertEqual(result_for({'id': 'new'}, {'actions': {}}), 'UnresolvedActionResult<"new">')

    def test_scalar_array_and_union(self):
        identifiers = {b's': ['string'], b'n': ['number']}
        scalar = message(1, b's')
        array = message(2, scalar)
        union = message(4, message(1, array) + message(1, message(1, b'n')))
        schema = extractor.decode_instance(union, identifiers, {'string', 'number'})
        self.assertEqual(render(schema, {}), 'Array<string> | number')
        self.assertEqual(extractor.type_ids(schema), {'string', 'number'})

    def test_invalid_or_ambiguous_metadata_is_rejected(self):
        for blob in [b'\x0a\x04s', b'\x00', b'\x09', b'\x80', message(5, b's')]:
            with self.subTest(blob=blob), self.assertRaises(ValueError):
                extractor.decode_instance(blob, {b's': ['string']}, {'string'})
        with self.assertRaises(ValueError):
            extractor.decode_instance(message(1, b's'), {b's': ['string', 'other']}, {'string', 'other'})

    def test_snapshot_exports_only_static_english_cases_and_preserves_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'Tools.v80.sqlite'
            with sqlite3.connect(path) as db:
                db.executescript('''
                    CREATE TABLE Types(rowId TEXT, id BLOB, kind INTEGER);
                    CREATE TABLE Tools(rowId INTEGER, id TEXT, outputTypeInstance BLOB);
                    CREATE TABLE ToolOutputTypes(toolId INTEGER, typeIdentifier TEXT);
                    CREATE TABLE EnumerationCases(typeId TEXT, locale TEXT, id TEXT, title TEXT);
                ''')
                db.executemany('INSERT INTO Types VALUES (?, ?, ?)', [('enum', b'e', 3), ('picker', b'p', 4)])
                db.executemany('INSERT INTO Tools VALUES (?, ?, ?)', [(1, 'known', message(1, b'e')), (2, 'dynamic', message(1, b'p'))])
                db.executemany('INSERT INTO ToolOutputTypes VALUES (?, ?)', [(1, 'enum'), (2, 'picker')])
                db.executemany('INSERT INTO EnumerationCases VALUES (?, ?, ?, ?)', [
                    ('enum', 'en', '0', 'Portrait'), ('enum', 'nl', '0', 'Staand'),
                    ('picker', 'en', 'private-id', 'Private picker value'),
                ])
            before = path.read_bytes()
            snapshot = extractor.extract([path], {'known', 'dynamic', 'missing'})
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(snapshot['types']['enum']['cases'], [{'id': '0', 'title': 'Portrait'}])
            self.assertNotIn('cases', snapshot['types']['picker'])
            self.assertEqual(result_for({'id': 'known'}, snapshot), 'NativeEnumValues["enum"]')
            self.assertEqual(result_for({'id': 'dynamic'}, snapshot), 'NativeEntity<"picker">')
            self.assertEqual(result_for({'id': 'missing'}, snapshot), 'UnresolvedActionResult<"missing">')


if __name__ == '__main__':
    unittest.main()
