import sys
import os

# Add root directory to sys.path so 'backend' package is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app as fastapi_app

async def app(scope, receive, send):
    if scope["type"] == "http":
        headers = dict(scope.get("headers", []))
        
        # Vercel supplies the actual requested path in one of these headers:
        raw_path = headers.get(b"x-matched-path", b"").decode("latin-1")
        if not raw_path:
            raw_path = headers.get(b"x-vercel-original-url", b"").decode("latin-1")
        if not raw_path:
            raw_path = headers.get(b"x-forwarded-uri", b"").decode("latin-1")
        if not raw_path:
            raw_path = scope.get("path", "")
            
        # Strip query parameters if present
        if "?" in raw_path:
            raw_path = raw_path.split("?")[0]
            
        # Strip /api/index.py or /api/index if present
        if raw_path.startswith("/api/index.py"):
            raw_path = raw_path[len("/api/index.py"):]
        elif raw_path.startswith("/api/index"):
            raw_path = raw_path[len("/api/index"):]
            
        if not raw_path or raw_path == "":
            raw_path = "/"
            
        if not raw_path.startswith("/"):
            raw_path = "/" + raw_path
            
        scope["path"] = raw_path
        scope["raw_path"] = raw_path.encode("latin-1")
        
    return await fastapi_app(scope, receive, send)
