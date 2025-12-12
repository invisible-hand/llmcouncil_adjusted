"""
Vercel Python Function entrypoint.

Vercel detects an ASGI app via a module-level variable named `app`.
We re-export the FastAPI app defined in `backend/main.py`.
"""

from backend.main import app  # noqa: F401


