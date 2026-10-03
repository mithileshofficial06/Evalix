"""Provider selection, retries and fallback.

  MISTRAL -> Mistral only
  NVIDIA  -> NVIDIA NIM only
  AUTO    -> Mistral first, NVIDIA NIM if Mistral fails (or isn't configured)
  MOCK    -> answer-key mock (only when EVALIX_ENABLE_MOCK=true)
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

from ..config import Settings
from ..schemas import AnswerRequest, AnswerResponse
from .base import Provider, ProviderError
from .mistral import MistralProvider
from .mock import MockProvider
from .nvidia import NvidiaProvider

log = logging.getLogger("evalix.router")


class NoProviderAvailable(Exception):
    pass


class AllProvidersFailed(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


class AIRouter:
    def __init__(self, providers: dict[str, Provider], max_retries: int = 2, backoff_seconds: float = 0.5):
        self.providers = providers
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds

    def chain(self, mode: str) -> list[Provider]:
        order = {"MISTRAL": ["MISTRAL"], "NVIDIA": ["NVIDIA"], "AUTO": ["MISTRAL", "NVIDIA"], "MOCK": ["MOCK"]}
        names = order.get(mode)
        if names is None:
            raise NoProviderAvailable(f"Unknown provider mode {mode!r}")
        chain = [self.providers[n] for n in names if n in self.providers]
        if not chain:
            raise NoProviderAvailable(f"No configured provider for mode {mode} — check backend/.env")
        return chain

    async def answer(self, req: AnswerRequest, mode: str) -> AnswerResponse:
        chain = self.chain(mode)
        errors: list[str] = []
        attempts = 0
        started = time.perf_counter()

        for index, provider in enumerate(chain):
            for attempt in range(self.max_retries + 1):
                if attempt:
                    await asyncio.sleep(self.backoff_seconds * 2 ** (attempt - 1))
                attempts += 1
                try:
                    result = await provider.answer(req)
                except ProviderError as e:
                    errors.append(str(e))
                    log.warning("provider %s attempt %d failed: %s", provider.name, attempt + 1, e)
                    if not e.retryable:
                        break  # e.g. bad key — go straight to the next provider
                    continue
                return AnswerResponse(
                    answer=result.answer,
                    confidence=result.confidence,
                    provider=provider.name,
                    model=result.model,
                    latency_ms=round((time.perf_counter() - started) * 1000, 1),
                    attempts=attempts,
                    fallback_used=index > 0,
                )
        raise AllProvidersFailed(errors)


def build_router(settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> AIRouter:
    providers: dict[str, Provider] = {}
    if settings.mistral_configured:
        providers["MISTRAL"] = MistralProvider(
            settings.mistral_api_key, settings.mistral_model, settings.ai_timeout_seconds, transport
        )
    if settings.nvidia_configured:
        providers["NVIDIA"] = NvidiaProvider(
            settings.nvidia_api_key,
            settings.nvidia_model,
            settings.ai_timeout_seconds,
            transport,
            enable_thinking=settings.nvidia_enable_thinking,
        )
    if settings.enable_mock:
        providers["MOCK"] = MockProvider(settings.mock_accuracy)
    return AIRouter(providers, max_retries=settings.ai_max_retries)
