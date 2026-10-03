from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from ..ai.router import AIRouter, AllProvidersFailed, NoProviderAvailable
from ..config import get_settings
from ..schemas import AgentDecideRequest, AgentDecideResponse
from .answer import get_router, page_origin

router = APIRouter(prefix="/agent")
log = logging.getLogger("evalix.agent")


@router.post("/decide", response_model=AgentDecideResponse)
async def decide(req: AgentDecideRequest, ai: AIRouter = Depends(get_router)) -> AgentDecideResponse:
    """Page understanding / recovery: returns one validated, structured decision about the page."""
    settings = get_settings()
    for url in (req.page_url, req.snapshot.url):
        if page_origin(url) not in settings.allowed_page_origins:
            raise HTTPException(403, f"Page origin {page_origin(url)} is not in ALLOWED_PAGE_ORIGINS")

    mode = (req.provider or settings.default_provider).upper()
    try:
        res = await ai.decide(req, mode)
    except NoProviderAvailable as e:
        raise HTTPException(503, str(e)) from e
    except AllProvidersFailed as e:
        log.error("session %s %s: all providers failed: %s", req.session_id[:8], req.task, e)
        raise HTTPException(502, f"All providers failed: {e}") from e
    log.info(
        "session %s %s -> %s, %s %s (%.2f) via %s/%s in %.0f ms%s%s",
        req.session_id[:8], req.task, res.page_state, res.action.action, res.action.target or "", res.confidence,
        res.provider, res.model, res.latency_ms, " [screenshot]" if res.used_screenshot else "",
        " [fallback]" if res.fallback_used else "",
    )
    return res
