import json

import httpx
import pytest

from app.ai.agent_prompt import build_agent_messages, parse_decision
from app.ai.base import ProviderError
from app.ai.mistral import MistralProvider
from app.ai.mock import MockProvider
from app.ai.nvidia import NvidiaProvider
from app.ai.prompt import InvalidModelOutput
from tests.factories import SNAPSHOT, make_decide_request

REQ = make_decide_request()
SHOT = "data:image/jpeg;base64,/9j/AAAA"

GOOD = {
    "page_state": "question",
    "question_text": "What is 7 × 8?",
    "option_ids": ["e2", "e3", "e4", "e5"],
    "next_id": "e6",
    "action": {"action": "select_answer", "target": None, "value": None},
    "confidence": 0.9,
}


def completion(content: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": content}}]})


def test_prompt_lists_elements_and_demands_json():
    system, user = build_agent_messages(REQ)
    assert "ONLY one JSON object" in system["content"]
    assert 'e5 [radio/input] "56" group=g1' in user["content"]
    assert 'e6 [button/button; disabled] "Next"' in user["content"]


def test_screenshot_is_sent_as_image_part():
    _, user = build_agent_messages(make_decide_request(screenshot=SHOT))
    assert user["content"][1] == {"type": "image_url", "image_url": {"url": SHOT}}


def test_parses_valid_decision():
    d = parse_decision(json.dumps(GOOD), REQ)
    assert d.option_ids == ["e2", "e3", "e4", "e5"] and d.next_id == "e6"


def test_flattened_action_and_percentage_confidence_are_normalised():
    d = parse_decision(json.dumps({**GOOD, "action": "select_answer", "confidence": 85}), REQ)
    assert d.action.action == "select_answer" and d.confidence == 0.85


@pytest.mark.parametrize(
    "patch, reason",
    [
        ({"option_ids": ["e2", "e99"]}, "not on the page"),
        ({"option_ids": ["e2"]}, "at least two"),
        ({"option_ids": ["e2", "e2"]}, "duplicates"),
        ({"next_id": "e2"}, "cannot also be an answer"),
        ({"action": {"action": "click"}}, "needs a target"),
        ({"action": {"action": "type", "target": "e2", "value": "x"}}, "Cannot type"),
        ({"action": {"action": "wait", "value": "60000"}}, "between 0 and 5000"),
        ({"action": {"action": "navigate", "value": "https://evil.example.com/"}}, "own site"),
        ({"action": {"action": "rm -rf", "target": "e2"}}, "schema"),
        ({"page_state": "anything"}, "schema"),
    ],
)
def test_rejects_invalid_decisions(patch, reason):
    with pytest.raises(InvalidModelOutput, match=reason):
        parse_decision(json.dumps({**GOOD, **patch}), REQ)


def test_same_origin_navigation_is_allowed():
    d = parse_decision(json.dumps({**GOOD, "action": {"action": "navigate", "value": "/complete.html"}}), REQ)
    assert d.action.value == "/complete.html"


async def test_mistral_decide_uses_vision_model_only_with_screenshot():
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return completion(json.dumps(GOOD))

    p = MistralProvider("mk", "ministral-14b-latest", transport=httpx.MockTransport(handler), vision_model="vision-x")
    await p.decide(REQ)
    r = await p.decide(make_decide_request(screenshot=SHOT))
    assert [b["model"] for b in seen] == ["ministral-14b-latest", "vision-x"]
    assert r.used_screenshot and seen[0]["response_format"] == {"type": "json_object"}


async def test_invalid_decision_is_retryable_provider_error():
    p = NvidiaProvider("nk", "m", transport=httpx.MockTransport(lambda r: completion('{"page_state": "question"}')))
    with pytest.raises(ProviderError) as exc:
        await p.decide(REQ)
    assert exc.value.retryable


async def test_mock_reads_the_page():
    d = (await MockProvider(latency_range=(0, 0)).decide(REQ)).decision
    assert (d.page_state, d.question_text, d.option_ids, d.next_id) == (
        "question", "What is 7 × 8?", ["e2", "e3", "e4", "e5"], "e6"
    )


async def test_mock_recover_finds_unlabelled_next():
    snap = {**SNAPSHOT, "elements": [*SNAPSHOT["elements"][1:5], {"id": "e9", "tag": "button", "role": "button", "text": "⇨"}]}
    req = make_decide_request(task="recover", goal="advance to the next question", snapshot=snap)
    d = (await MockProvider(latency_range=(0, 0)).decide(req)).decision
    assert d.action.action == "click" and d.action.target == "e9"


async def test_mock_detects_completion():
    snap = {"url": SNAPSHOT["url"], "title": "Assessment Complete", "texts": ["Assessment complete", "Score 15 / 15"], "elements": []}
    d = (await MockProvider(latency_range=(0, 0)).decide(make_decide_request(snapshot=snap))).decision
    assert (d.page_state, d.action.action) == ("complete", "finish")


def test_decide_endpoint(client):
    r = client.post("/agent/decide", json=make_decide_request(provider="MOCK").model_dump())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider"] == "MOCK" and body["page_state"] == "question"
    assert body["option_ids"] == ["e2", "e3", "e4", "e5"] and body["used_screenshot"] is False


def test_decide_endpoint_refuses_other_origins(client):
    payload = make_decide_request(provider="MOCK").model_dump()
    payload["snapshot"]["url"] = "https://lms.example.com/quiz"
    assert client.post("/agent/decide", json=payload).status_code == 403


def test_decide_endpoint_validates_screenshot_format(client):
    payload = make_decide_request(provider="MOCK").model_dump()
    payload["screenshot"] = "javascript:alert(1)"
    assert client.post("/agent/decide", json=payload).status_code == 422


def test_answer_response_carries_action(client):
    from tests.factories import make_request

    r = client.post("/answer", json=make_request(provider="MOCK").model_dump())
    assert r.json()["action"] == "select_answer"
