from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..schemas import AgentDecideRequest, AgentDecision, AnswerRequest


class ProviderError(Exception):
    """A provider call failed. `retryable` decides whether the router retries the same provider."""

    def __init__(self, message: str, *, retryable: bool, status: int | None = None, retry_after: float | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status
        self.retry_after = retry_after  # seconds, from a Retry-After header

    @property
    def unavailable(self) -> bool:
        """Rate-limited or temporarily down: another provider should take over right away."""
        return self.status in (429, 503)


@dataclass
class ProviderAnswer:
    answer: str
    confidence: float
    model: str
    action: str = "select_answer"


@dataclass
class ProviderDecision:
    decision: AgentDecision
    model: str
    used_screenshot: bool = False


class Provider(Protocol):
    name: str
    model: str

    async def answer(self, request: AnswerRequest) -> ProviderAnswer: ...

    async def decide(self, request: AgentDecideRequest) -> ProviderDecision: ...
