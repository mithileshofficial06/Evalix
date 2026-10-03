from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..schemas import AnswerRequest


class ProviderError(Exception):
    """A provider call failed. `retryable` decides whether the router retries the same provider."""

    def __init__(self, message: str, *, retryable: bool, status: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status


@dataclass
class ProviderAnswer:
    answer: str
    confidence: float
    model: str


class Provider(Protocol):
    name: str
    model: str

    async def answer(self, request: AnswerRequest) -> ProviderAnswer: ...
