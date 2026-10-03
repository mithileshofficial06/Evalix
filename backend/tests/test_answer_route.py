from app.grading.keys import load_key
from tests.factories import make_request


def body(**overrides):
    return make_request(**overrides).model_dump()


def test_answer_with_mock_provider(client):
    r = client.post("/answer", json=body(provider="MOCK"))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["answer"] == load_key("quiz-15")["q01"]
    assert data["provider"] == "MOCK"
    assert 0 <= data["confidence"] <= 1
    assert data["latency_ms"] >= 0


def test_page_origin_must_be_allowlisted(client):
    r = client.post("/answer", json=body(provider="MOCK", page_url="https://lms.example.com/quiz/1"))
    assert r.status_code == 403


def test_validation_rejects_bad_options(client):
    payload = body(provider="MOCK")
    payload["options"] = [{"id": "A", "text": "only one"}]
    assert client.post("/answer", json=payload).status_code == 422


def test_unconfigured_provider_returns_503(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setenv("EVALIX_ENABLE_MOCK", "false")
    get_settings.cache_clear()
    assert client.post("/answer", json=body(provider="MOCK")).status_code == 503


def test_mock_without_key_entry_returns_502(client):
    r = client.post("/answer", json=body(provider="MOCK", test_id="unknown-test"))
    assert r.status_code == 502
