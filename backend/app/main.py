"""Evalix backend entrypoint: `uvicorn app.main:app --port 8000`."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import VERSION, get_settings
from .routes import answer, health

EXTENSION_ORIGIN_PREFIX = "chrome-extension://"


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Evalix backend", version=VERSION)

    @app.middleware("http")
    async def origin_guard(request: Request, call_next):
        # Browsers always send Origin on cross-origin requests. Only the Evalix extension and the
        # allowlisted QA pages may call this server; any other website is refused, so a random page
        # you visit cannot spend your API credits through localhost.
        origin = (request.headers.get("origin") or "").rstrip("/")
        if (
            origin
            and not origin.startswith(EXTENSION_ORIGIN_PREFIX)
            and origin not in settings.allowed_page_origins
        ):
            return JSONResponse({"detail": f"Origin not allowed: {origin}"}, status_code=403)
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_page_origins),
        allow_origin_regex=r"chrome-extension://[a-p]{32}",
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    app.include_router(health.router)
    app.include_router(answer.router)
    return app


app = create_app()
