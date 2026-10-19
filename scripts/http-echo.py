#!/usr/bin/env python3
"""Local-only HTTP fixture for examples/request-json-test.ts; also serves dist imports."""
import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8765)
parser.add_argument('--log', type=Path, default=Path('artifacts/http-requests.jsonl'))
args = parser.parse_args()
args.log.parent.mkdir(parents=True, exist_ok=True)

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *items, **kwargs):
        super().__init__(*items, directory=str(Path('dist').resolve()), **kwargs)

    def do_GET(self):
        if self.path.startswith('/echo') or self.path == '/array':
            self.echo()
        else:
            super().do_GET()

    def echo(self):
        raw = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        try:
            received = json.loads(raw) if raw else None
        except (ValueError, UnicodeError) as error:
            self.send_error(400, 'Invalid JSON: ' + str(error))
            return
        record = {
            'method': self.command, 'path': self.path,
            'accept': self.headers.get('Accept', ''),
            'contentType': self.headers.get('Content-Type', ''),
            'marker': self.headers.get('X-Toolkit-Test', ''),
            'rawBody': raw.decode('utf-8'), 'received': received,
        }
        with args.log.open('a', encoding='utf-8') as log:
            log.write(json.dumps(record, ensure_ascii=False) + '\n')
        result = [{'n': 2}, {'n': 3}] if self.path == '/array' else record
        encoded = json.dumps(result, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    do_POST = echo
    do_PUT = echo
    do_PATCH = echo
    do_DELETE = echo

print(f'Local test server: http://127.0.0.1:{args.port}; log: {args.log}', flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
