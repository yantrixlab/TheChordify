"""Send www.<site> to <site>, so search engines (and visitors) see one site, not two copies of every page."""
from __future__ import annotations

from urllib.parse import quote

from starlette.responses import RedirectResponse


class WwwRedirect:
    """ASGI middleware: a request for www.example.com is answered with a permanent redirect to the same path on example.com.

    GET and HEAD get a 301; anything else gets a 308, which keeps the method and body, so a client that posts to the www
    address (a payment webhook, say) is not turned into a GET. Hosts without a `www.` prefix, and bare IPs or localhost, pass through.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            host = dict(scope["headers"]).get(b"host", b"").decode("latin-1").split(":")[0].lower()
            if host.startswith("www.") and host.count(".") >= 2:
                target = f"https://{host[4:]}{quote(scope['path'])}"
                if scope.get("query_string"):
                    target += "?" + scope["query_string"].decode("latin-1")
                status = 301 if scope["method"] in ("GET", "HEAD") else 308
                await RedirectResponse(target, status_code=status)(scope, receive, send)
                return
        await self.app(scope, receive, send)
