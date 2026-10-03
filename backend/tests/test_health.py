def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["default_provider"] == "AUTO"
    names = {p["name"]: p for p in body["providers"]}
    assert names["MISTRAL"]["configured"] is True
    assert names["NVIDIA"]["configured"] is True


def test_health_never_leaks_keys(client):
    text = client.get("/health").text
    assert "test-mistral-key" not in text
    assert "test-nvidia-key" not in text


def test_extension_origin_allowed(client):
    origin = "chrome-extension://" + "a" * 32
    r = client.get("/health", headers={"Origin": origin})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origin


def test_allowlisted_page_origin_allowed(client):
    r = client.get("/health", headers={"Origin": "http://localhost:8080"})
    assert r.status_code == 200


def test_foreign_origin_rejected(client):
    r = client.get("/health", headers={"Origin": "https://example.com"})
    assert r.status_code == 403
