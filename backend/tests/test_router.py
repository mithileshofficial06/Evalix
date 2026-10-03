import pytest

from app.ai.base import ProviderAnswer, ProviderError
from app.ai.router import AIRouter, AllProvidersFailed, NoProviderAvailable, build_router
from app.config import get_settings
from tests.factories import make_request


class FakeProvider:
    def __init__(self, name, script):
        """script: list of ProviderAnswer | ProviderError, consumed per call."""
        self.name = name
        self.model = f"{name.lower()}-model"
        self.script = list(script)
        self.calls = 0

    async def answer(self, req):
        self.calls += 1
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


OK = ProviderAnswer(answer="D", confidence=0.9, model="m")
TRANSIENT = ProviderError("503", retryable=True, status=503)
FATAL = ProviderError("401", retryable=False, status=401)


def router(**providers):
    return AIRouter(providers, max_retries=2, backoff_seconds=0)


async def test_single_provider_success():
    m = FakeProvider("MISTRAL", [OK])
    res = await router(MISTRAL=m).answer(make_request(), "MISTRAL")
    assert (res.answer, res.provider, res.attempts, res.fallback_used) == ("D", "MISTRAL", 1, False)


async def test_retries_transient_errors():
    m = FakeProvider("MISTRAL", [TRANSIENT, TRANSIENT, OK])
    res = await router(MISTRAL=m).answer(make_request(), "MISTRAL")
    assert res.attempts == 3 and m.calls == 3


async def test_auto_falls_back_to_nvidia_after_retries_exhausted():
    m = FakeProvider("MISTRAL", [TRANSIENT, TRANSIENT, TRANSIENT])
    n = FakeProvider("NVIDIA", [OK])
    res = await router(MISTRAL=m, NVIDIA=n).answer(make_request(), "AUTO")
    assert (res.provider, res.fallback_used, res.attempts) == ("NVIDIA", True, 4)


async def test_auto_skips_retries_on_fatal_error():
    m = FakeProvider("MISTRAL", [FATAL])
    n = FakeProvider("NVIDIA", [OK])
    res = await router(MISTRAL=m, NVIDIA=n).answer(make_request(), "AUTO")
    assert m.calls == 1 and res.provider == "NVIDIA"


async def test_auto_uses_nvidia_when_mistral_not_configured():
    n = FakeProvider("NVIDIA", [OK])
    res = await router(NVIDIA=n).answer(make_request(), "AUTO")
    assert res.provider == "NVIDIA" and res.fallback_used is False


async def test_explicit_mode_does_not_fall_back():
    m = FakeProvider("MISTRAL", [FATAL])
    n = FakeProvider("NVIDIA", [OK])
    with pytest.raises(AllProvidersFailed):
        await router(MISTRAL=m, NVIDIA=n).answer(make_request(), "MISTRAL")
    assert n.calls == 0


async def test_all_fail_collects_errors():
    m = FakeProvider("MISTRAL", [FATAL])
    n = FakeProvider("NVIDIA", [FATAL])
    with pytest.raises(AllProvidersFailed) as exc:
        await router(MISTRAL=m, NVIDIA=n).answer(make_request(), "AUTO")
    assert len(exc.value.errors) == 2


async def test_unconfigured_mode_raises():
    with pytest.raises(NoProviderAvailable):
        await router().answer(make_request(), "NVIDIA")


def test_build_router_only_includes_configured(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "")
    monkeypatch.setenv("EVALIX_ENABLE_MOCK", "false")
    get_settings.cache_clear()
    r = build_router(get_settings())
    assert set(r.providers) == {"MISTRAL"}
