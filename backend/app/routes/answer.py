from __future__ import annotations

import logging
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException

from ..ai.router import AIRouter, AllProvidersFailed, NoProviderAvailable, shared_router
from ..config import get_settings
from ..schemas import AnswerRequest, AnswerResponse

router = APIRouter()
log = logging.getLogger("evalix.answer")


def get_router() -> AIRouter:
    return shared_router(get_settings())


def page_origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}".rstrip("/")


@router.post("/answer", response_model=AnswerResponse)
async def answer(req: AnswerRequest, ai: AIRouter = Depends(get_router)) -> AnswerResponse:
    settings = get_settings()
    # Second line of defence behind the extension's own checks: only answer for allowlisted pages.
    if page_origin(req.page_url) not in settings.allowed_page_origins:
        raise HTTPException(403, f"Page origin {page_origin(req.page_url)} is not in ALLOWED_PAGE_ORIGINS")

    mode = (req.provider or settings.default_provider).upper()
    try:
        res = await ai.answer(req, mode)
    except NoProviderAvailable as e:
        raise HTTPException(503, str(e)) from e
    except AllProvidersFailed as e:
        log.error("session %s %s: all providers failed: %s", req.session_id, req.question_id, e)
        raise HTTPException(502, f"All providers failed: {e}") from e
    log.info(
        "session %s %s -> %s (%.2f) via %s/%s in %.0f ms, attempts=%d%s",
        req.session_id[:8], req.question_id, res.answer, res.confidence, res.provider, res.model,
        res.latency_ms, res.attempts, " [fallback]" if res.fallback_used else "",
    )
    return res
