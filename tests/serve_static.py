#!/usr/bin/env python3
"""Local clean-URL server with production-like security headers."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent / "dist"
CSP = (
    "default-src 'self'; base-uri 'self'; connect-src 'self' https://api.openai.com; "
    "font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; "
    "media-src 'self' blob:; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'"
)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        clean = urlsplit(path).path
        if clean != "/" and not Path(clean).suffix:
            candidate = ROOT / clean.lstrip("/")
            if candidate.with_suffix(".html").is_file():
                clean += ".html"
        return super().translate_path(clean)

    def send_error(self, code, message=None, explain=None):
        if code == 404 and (ROOT / "404.html").is_file():
            body = (ROOT / "404.html").read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def end_headers(self):
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), geolocation=(), payment=(), microphone=(self)")
        super().end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 4173), Handler).serve_forever()
