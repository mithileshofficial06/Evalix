from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException

from ..ai.router import AIRouter, AllProvidersFailed, NoProviderAvailable, build_router
from ..config import get_settings
from ..schemas import AnswerRequest, AnswerResponse

router = APIRouter()


def get_router() -> AIRouter:
    return build_router(get_settings())


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
        return await ai.answer(req, mode)
    except NoProviderAvailable as e:
        raise HTTPException(503, str(e)) from e
    except AllProvidersFailed as e:
        raise HTTPException(502, f"All providers failed: {e}") from e
