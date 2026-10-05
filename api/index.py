import sys
import os
import urllib.parse

# Add root directory to sys.path so 'backend' package is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app as fastapi_app

async def app(scope, receive, send):
    if scope["type"] == "http":
        headers = dict(scope.get("headers", []))
        
        # 1. Check x-now-route-matches (Vercel standard for regex rewrites)
        route_matches = headers.get(b"x-now-route-matches", b"").decode("latin-1")
        matched_subpath = None
        if route_matches:
            params = urllib.parse.parse_qs(route_matches)
            if "1" in params and params["1"]:
                matched_subpath = params["1"][0]
            elif "path" in params and params["path"]:
                matched_subpath = params["path"][0]

        # 2. Check other headers
        original_url = headers.get(b"x-vercel-original-url", b"").decode("latin-1")
        forwarded_uri = headers.get(b"x-forwarded-uri", b"").decode("latin-1")
        matched_path = headers.get(b"x-matched-path", b"").decode("latin-1")
        
        path = scope.get("path", "")
        
        if matched_subpath:
            raw_path = "/api/" + matched_subpath.lstrip("/")
        elif original_url and not original_url.startswith("/api/index"):
            raw_path = original_url
        elif forwarded_uri and not forwarded_uri.startswith("/api/index"):
            raw_path = forwarded_uri
        elif matched_path and not matched_path.startswith("/api/index"):
            raw_path = matched_path
        else:
            raw_path = path

        if "?" in raw_path:
            raw_path = raw_path.split("?")[0]
            
        if not raw_path or raw_path == "":
            raw_path = "/"
            
        if not raw_path.startswith("/"):
            raw_path = "/" + raw_path
            
        scope["path"] = raw_path
        scope["raw_path"] = raw_path.encode("latin-1")
        
    return await fastapi_app(scope, receive, send)
