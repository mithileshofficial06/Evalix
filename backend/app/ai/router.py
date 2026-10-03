"""Provider selection, retries and fallback.

  MISTRAL -> Mistral only
  NVIDIA  -> NVIDIA NIM only
  AUTO    -> Mistral first, NVIDIA NIM if Mistral fails (or isn't configured)
  MOCK    -> answer-key mock (only when EVALIX_ENABLE_MOCK=true)

In AUTO, a provider that is rate-limited (429) or unavailable (503) is skipped immediately rather
than retried, and a rate-limited provider is put on a short cooldown so the following requests go
straight to the other provider until it recovers.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Generic, TypeVar

import httpx

from ..config import Settings
from ..schemas import AgentDecideRequest, AgentDecideResponse, AnswerRequest, AnswerResponse
from .base import Provider, ProviderError
from .mistral import MistralProvider
from .mock import MockProvider
from .nvidia import NvidiaProvider

log = logging.getLogger("evalix.router")
T = TypeVar("T")

ORDER = {"MISTRAL": ["MISTRAL"], "NVIDIA": ["NVIDIA"], "AUTO": ["MISTRAL", "NVIDIA"], "MOCK": ["MOCK"]}


class NoProviderAvailable(Exception):
    pass


class AllProvidersFailed(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


@dataclass
class RouterResult(Generic[T]):
    value: T
    provider: Provider
    attempts: int
    latency_ms: float
    fallback_used: bool


class AIRouter:
    def __init__(
        self,
        providers: dict[str, Provider],
        max_retries: int = 2,
        backoff_seconds: float = 0.5,
        cooldown_seconds: float = 30,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.providers = providers
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds
        self.cooldown_seconds = cooldown_seconds
        self.clock = clock
        self._cooldown_until: dict[str, float] = {}

    def chain(self, mode: str) -> list[Provider]:
        names = ORDER.get(mode)
        if names is None:
            raise NoProviderAvailable(f"Unknown provider mode {mode!r}")
        chain = [self.providers[n] for n in names if n in self.providers]
        if not chain:
            raise NoProviderAvailable(f"No configured provider for mode {mode} — check backend/.env")
        if len(chain) > 1:
            # Providers cooling down after a rate limit go last (stable sort keeps the preference order).
            now = self.clock()
            chain.sort(key=lambda p: self._cooldown_until.get(p.name, 0) > now)
        return chain

    def cooling_down(self) -> list[str]:
        now = self.clock()
        return [name for name, until in self._cooldown_until.items() if until > now]

    async def run(self, mode: str, call: Callable[[Provider], Awaitable[T]]) -> RouterResult[T]:
        chain = self.chain(mode)
        preferred = next(self.providers[n] for n in ORDER[mode] if n in self.providers)
        errors: list[str] = []
        attempts = 0
        started = time.perf_counter()

        for index, provider in enumerate(chain):
            has_next = index + 1 < len(chain)
            for attempt in range(self.max_retries + 1):
                if attempt:
                    await asyncio.sleep(self.backoff_seconds * 2 ** (attempt - 1))
                attempts += 1
                try:
                    value = await call(provider)
                except ProviderError as e:
                    errors.append(str(e))
                    log.warning("provider %s attempt %d failed: %s", provider.name, attempt + 1, e)
                    if e.status == 429:
                        self._cooldown_until[provider.name] = self.clock() + (e.retry_after or self.cooldown_seconds)
                    if not e.retryable:
                        break  # e.g. bad key — go straight to the next provider
                    if e.unavailable and has_next:
                        log.info("provider %s unavailable (%s) — switching to %s", provider.name, e.status, chain[index + 1].name)
                        break
                    continue
                self._cooldown_until.pop(provider.name, None)
                return RouterResult(
                    value=value,
                    provider=provider,
                    attempts=attempts,
                    latency_ms=round((time.perf_counter() - started) * 1000, 1),
                    fallback_used=provider is not preferred,
                )
        raise AllProvidersFailed(errors)

    async def answer(self, req: AnswerRequest, mode: str) -> AnswerResponse:
        r = await self.run(mode, lambda p: p.answer(req))
        return AnswerResponse(
            answer=r.value.answer,
            confidence=r.value.confidence,
            provider=r.provider.name,
            model=r.value.model,
            latency_ms=r.latency_ms,
            attempts=r.attempts,
            fallback_used=r.fallback_used,
        )

    async def decide(self, req: AgentDecideRequest, mode: str) -> AgentDecideResponse:
        r = await self.run(mode, lambda p: p.decide(req))
        return AgentDecideResponse(
            **r.value.decision.model_dump(),
            provider=r.provider.name,
            model=r.value.model,
            latency_ms=r.latency_ms,
            attempts=r.attempts,
            fallback_used=r.fallback_used,
            used_screenshot=r.value.used_screenshot,
        )


def build_router(settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> AIRouter:
    providers: dict[str, Provider] = {}
    if settings.mistral_configured:
        providers["MISTRAL"] = MistralProvider(
            settings.mistral_api_key,
            settings.mistral_model,
            settings.ai_timeout_seconds,
            transport,
            vision_model=settings.mistral_vision_model,
        )
    if settings.nvidia_configured:
        providers["NVIDIA"] = NvidiaProvider(
            settings.nvidia_api_key,
            settings.nvidia_model,
            settings.ai_timeout_seconds,
            transport,
            enable_thinking=settings.nvidia_enable_thinking,
            vision_model=settings.nvidia_vision_model,
        )
    if settings.enable_mock:
        providers["MOCK"] = MockProvider(settings.mock_accuracy)
    return AIRouter(providers, max_retries=settings.ai_max_retries, cooldown_seconds=settings.ai_cooldown_seconds)


_shared: tuple[Settings, AIRouter] | None = None


def shared_router(settings: Settings) -> AIRouter:
    """One router per settings so rate-limit cooldowns carry over between requests."""
    global _shared
    if _shared is None or _shared[0] is not settings:
        _shared = (settings, build_router(settings))
    return _shared[1]
