#!/usr/bin/env python3
"""
Yakima Basin Dashboard — local development server.

Serves the static dashboard files and proxies requests that lack CORS headers:
  /api/usbr?...   → https://www.usbr.gov/pn-bin/instant.pl?...
  /api/nwrfc?...  → https://www.nwrfc.noaa.gov/station/flowplot/textPlot.cgi?...

Usage:
    python3 server.py          # serves on http://localhost:8080
    python3 server.py 9000     # custom port
"""

import http.server
import urllib.request
import urllib.error
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

PROXY_ROUTES = {
    "/api/usbr":  "https://www.usbr.gov/pn-bin/instant.pl",
    "/api/nwrfc": "https://www.nwrfc.noaa.gov/station/flowplot/textPlot.cgi",
}


class Handler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        for prefix, upstream in PROXY_ROUTES.items():
            if self.path.startswith(prefix):
                self._proxy(upstream)
                return
        super().do_GET()

    def _proxy(self, upstream_base):
        """Forward request to upstream, adding Access-Control-Allow-Origin: *."""
        qs = self.path.split("?", 1)[1] if "?" in self.path else ""
        target = f"{upstream_base}?{qs}" if qs else upstream_base
        try:
            req = urllib.request.Request(
                target,
                headers={"User-Agent": "YakimaBasinDashboard/1.0 (local proxy)"},
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read()
                content_type = resp.headers.get("Content-Type", "text/plain")
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except urllib.error.HTTPError as e:
            self.send_error(e.code, f"Upstream error: {e.reason}")
        except Exception as e:
            self.send_error(502, f"Proxy error: {e}")

    def log_message(self, fmt, *args):
        path = args[0] if args else ""
        if any(path.startswith(p) for p in PROXY_ROUTES):
            super().log_message(fmt, *args)
        elif not any(ext in path for ext in [".css", ".js", ".png", ".ico", ".woff"]):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(("", PORT), Handler)
    print(f"Yakima Dashboard → http://localhost:{PORT}")
    for prefix, upstream in PROXY_ROUTES.items():
        print(f"Proxy {prefix:12s} → {upstream}")
    print("Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
