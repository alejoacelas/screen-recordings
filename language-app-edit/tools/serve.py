"""Serve the editor with HTTP Range support (needed for video seeking) and save edits.

Usage: python3 tools/serve.py [port]   (run from language-app-edit/)
PUT /data/edit-<video>.json or /data/zoom.json writes that file.
"""
import http.server, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITABLE = {"/data/edit-tracker.json", "/data/edit-companion.json", "/data/zoom.json"}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_PUT(self):
        if self.path not in WRITABLE:
            self.send_error(403)
            return
        body = self.rfile.read(int(self.headers["Content-Length"]))
        with open(os.path.join(ROOT, self.path.lstrip("/")), "wb") as f:
            f.write(body)
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().do_GET()
        size = os.path.getsize(path)
        m = re.match(r"bytes=(\d*)-(\d*)", rng)
        start = int(m.group(1)) if m.group(1) else size - int(m.group(2))
        end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
        end = min(end, size - 1, start + 8 * 1024 * 1024 - 1)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            try:
                self.wfile.write(f.read(end - start + 1))
            except (BrokenPipeError, ConnectionResetError):
                pass


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8790), Handler).serve_forever()
