"""Local-only simulator depth probe. Edit /tmp/while-recursion-config.json between runs."""
import json
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

CONFIG = Path('/tmp/while-recursion-config.json')
EVENTS = Path('/tmp/while-recursion-events.jsonl')

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/TS-Recursion-Probe.shortcut':
            body = Path('dist/TS-Recursion-Probe.shortcut').read_bytes()
            mime = 'application/octet-stream'
        elif url.path == '/config':
            body = CONFIG.read_bytes()
            mime = 'application/json'
            self.record('start', json.loads(body))
        elif url.path == '/done':
            self.record('done', {k: v[0] for k, v in parse_qs(url.query).items()})
            body, mime = b'{"ok":true}', 'application/json'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def record(self, event, data):
        entry = {'time': time.time(), 'event': event, **data}
        with EVENTS.open('a') as f:
            f.write(json.dumps(entry) + '\n')
        print(json.dumps(entry), flush=True)
    def log_message(self, *_):
        pass

if __name__ == '__main__':
    if not CONFIG.exists():
        CONFIG.write_text(json.dumps({'limit': 10, 'run': 'depth-10'}))
    HTTPServer(('127.0.0.1', 8770), Handler).serve_forever()
