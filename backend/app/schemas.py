"""API contract shared with the extension (mirrored in extension/src/shared/types.ts)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ProviderMode = Literal["AUTO", "MISTRAL", "NVIDIA", "MOCK"]


class OptionItem(BaseModel):
    id: str = Field(pattern=r"^[A-J]$")
    text: str = Field(min_length=1, max_length=1000)


class AnswerRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    test_id: str | None = Field(default=None, max_length=64)
    page_url: str = Field(max_length=2048)
    provider: ProviderMode | None = None
    question_id: str = Field(min_length=1, max_length=128)
    question_number: int | None = None
    text: str = Field(min_length=1, max_length=4000)
    options: list[OptionItem] = Field(min_length=2, max_length=10)


class AnswerResponse(BaseModel):
    answer: str
    confidence: float = Field(ge=0, le=1)
    provider: str
    model: str
    latency_ms: float
    attempts: int
    fallback_used: bool


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
