"""API contract shared with the extension (mirrored in extension/src/shared/types.ts)."""

from __future__ import annotations

from pydantic import BaseModel


class ProviderStatus(BaseModel):
    name: str
    configured: bool
    model: str


class HealthResponse(BaseModel):
    status: str
    version: str
    default_provider: str
    providers: list[ProviderStatus]
    allowed_page_origins: list[str]
