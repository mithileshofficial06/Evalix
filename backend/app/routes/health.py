from __future__ import annotations

from fastapi import APIRouter

from ..config import VERSION, get_settings
from ..schemas import HealthResponse, ProviderStatus

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    s = get_settings()
    # Report whether each provider is configured — never the key itself.
    return HealthResponse(
        status="ok",
        version=VERSION,
        default_provider=s.default_provider,
        providers=[
            ProviderStatus(name="MISTRAL", configured=s.mistral_configured, model=s.mistral_model),
            ProviderStatus(name="NVIDIA", configured=s.nvidia_configured, model=s.nvidia_model),
            ProviderStatus(name="MOCK", configured=s.enable_mock, model="answer-key"),
        ],
        allowed_page_origins=list(s.allowed_page_origins),
    )
