import json

import httpx
import pytest

from app.ai.base import ProviderError
from app.ai.mistral import MistralProvider
from app.ai.mock import MockProvider
from app.ai.nvidia import NvidiaProvider
from tests.factories import make_request


def completion(content: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": content}}]})


async def test_mistral_request_shape():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return completion('{"answer": "D", "confidence": 0.93}')

    p = MistralProvider("mk", "mistral-small-latest", transport=httpx.MockTransport(handler))
    result = await p.answer(make_request())

    assert (result.answer, result.confidence, result.model) == ("D", 0.93, "mistral-small-latest")
    assert seen["url"] == "https://api.mistral.ai/v1/chat/completions"
    assert seen["auth"] == "Bearer mk"
    assert seen["body"]["response_format"] == {"type": "json_object"}
    assert seen["body"]["temperature"] == 0


async def test_nvidia_request_shape():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return completion('{"answer": "D", "confidence": 0.8}')

    p = NvidiaProvider("nk", "meta/llama-3.3-70b-instruct", transport=httpx.MockTransport(handler))
    assert (await p.answer(make_request())).answer == "D"
    assert seen["url"] == "https://integrate.api.nvidia.com/v1/chat/completions"
    assert seen["body"]["model"] == "meta/llama-3.3-70b-instruct"
    assert "response_format" not in seen["body"]
    assert seen["body"]["chat_template_kwargs"] == {"enable_thinking": False}
    assert seen["body"]["max_tokens"] == 100


async def test_nvidia_thinking_enabled_raises_token_budget():
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = json.loads(request.content)
        return completion('<think>7*8=56, option D</think>{"answer": "D", "confidence": 0.97}')

    p = NvidiaProvider("nk", "nvidia/nemotron-3.5-lightning-30b-a3b", transport=httpx.MockTransport(handler), enable_thinking=True)
    assert (await p.answer(make_request())).answer == "D"
    assert seen["body"]["chat_template_kwargs"] == {"enable_thinking": True}
    assert seen["body"]["max_tokens"] == 4096


@pytest.mark.parametrize(
    "response, retryable",
    [
        (httpx.Response(401, json={"error": "unauthorized"}), False),
        (httpx.Response(400, json={"error": "bad"}), False),
        (httpx.Response(429, json={"error": "rate limit"}), True),
        (httpx.Response(503, text="unavailable"), True),
        (completion("I think it's D"), True),  # invalid output
        (httpx.Response(200, json={"unexpected": True}), True),
    ],
)
async def test_provider_error_classification(response, retryable):
    p = MistralProvider("mk", "m", transport=httpx.MockTransport(lambda r: response))
    with pytest.raises(ProviderError) as exc:
        await p.answer(make_request())
    assert exc.value.retryable is retryable


async def test_timeout_is_retryable():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    p = NvidiaProvider("nk", "m", transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderError) as exc:
        await p.answer(make_request())
    assert exc.value.retryable


async def test_missing_key_is_not_retryable():
    with pytest.raises(ProviderError) as exc:
        await MistralProvider("", "m").answer(make_request())
    assert not exc.value.retryable


async def test_mock_uses_answer_key():
    p = MockProvider(accuracy=1.0, latency_range=(0, 0))
    result = await p.answer(make_request())  # quiz-15 q01 is "What is 7 × 8?"
    from app.grading.keys import load_key

    assert result.answer == load_key("quiz-15")["q01"]


async def test_mock_accuracy_zero_is_always_wrong():
    from app.grading.keys import load_key

    p = MockProvider(accuracy=0.0, latency_range=(0, 0))
    key = load_key("quiz-15")
    for qid in ["q01", "q02", "q03"]:
        assert (await p.answer(make_request(question_id=qid))).answer != key[qid]
