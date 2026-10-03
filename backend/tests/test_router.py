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
TRANSIENT = ProviderError("500", retryable=True, status=500)
UNAVAILABLE = ProviderError("503", retryable=True, status=503)
RATE_LIMITED = ProviderError("429", retryable=True, status=429)
FATAL = ProviderError("401", retryable=False, status=401)


def router(clock=None, **providers):
    extra = {"clock": clock} if clock else {}
    return AIRouter(providers, max_retries=2, backoff_seconds=0, cooldown_seconds=30, **extra)


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


async def test_auto_switches_immediately_on_rate_limit():
    m = FakeProvider("MISTRAL", [RATE_LIMITED])
    n = FakeProvider("NVIDIA", [OK])
    res = await router(MISTRAL=m, NVIDIA=n).answer(make_request(), "AUTO")
    assert (m.calls, res.provider, res.attempts, res.fallback_used) == (1, "NVIDIA", 2, True)


async def test_auto_switches_immediately_when_unavailable():
    m = FakeProvider("MISTRAL", [UNAVAILABLE])
    n = FakeProvider("NVIDIA", [OK])
    res = await router(MISTRAL=m, NVIDIA=n).answer(make_request(), "AUTO")
    assert m.calls == 1 and res.provider == "NVIDIA"


async def test_explicit_mode_still_retries_rate_limits():
    m = FakeProvider("MISTRAL", [RATE_LIMITED, OK])
    res = await router(MISTRAL=m).answer(make_request(), "MISTRAL")
    assert m.calls == 2 and res.provider == "MISTRAL"


async def test_rate_limited_provider_cools_down_then_recovers():
    now = [1000.0]
    m = FakeProvider("MISTRAL", [RATE_LIMITED, OK])
    n = FakeProvider("NVIDIA", [OK, OK])
    r = router(clock=lambda: now[0], MISTRAL=m, NVIDIA=n)

    await r.answer(make_request(), "AUTO")  # Mistral 429 -> NVIDIA
    assert r.cooling_down() == ["MISTRAL"]
    res = await r.answer(make_request(), "AUTO")  # Mistral skipped while cooling down
    assert res.provider == "NVIDIA" and m.calls == 1

    now[0] += 31
    res = await r.answer(make_request(), "AUTO")  # cooldown over: back to the preferred provider
    assert res.provider == "MISTRAL" and res.fallback_used is False and r.cooling_down() == []


async def test_retry_after_header_sets_cooldown():
    now = [0.0]
    m = FakeProvider("MISTRAL", [ProviderError("429", retryable=True, status=429, retry_after=5)])
    n = FakeProvider("NVIDIA", [OK])
    r = router(clock=lambda: now[0], MISTRAL=m, NVIDIA=n)
    await r.answer(make_request(), "AUTO")
    assert r.cooling_down() == ["MISTRAL"]
    now[0] = 6
    assert r.cooling_down() == []


async def test_decide_goes_through_the_same_fallback():
    from app.ai.base import ProviderDecision
    from app.schemas import AgentDecision, BrowserAction
    from tests.factories import make_decide_request

    decision = AgentDecision(page_state="loading", action=BrowserAction(action="wait", value="500"), confidence=0.5)

    class Decider(FakeProvider):
        async def decide(self, req):
            self.calls += 1
            step = self.script.pop(0)
            if isinstance(step, Exception):
                raise step
            return ProviderDecision(decision=decision, model=self.model)

    m = Decider("MISTRAL", [RATE_LIMITED])
    n = Decider("NVIDIA", [None])
    res = await router(MISTRAL=m, NVIDIA=n).decide(make_decide_request(), "AUTO")
    assert (res.provider, res.page_state, res.action.action, res.fallback_used) == ("NVIDIA", "loading", "wait", True)
