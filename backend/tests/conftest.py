import pytest
from fastapi.testclient import TestClient

from app.config import get_settings

TEST_ENV = {
    "MISTRAL_API_KEY": "test-mistral-key",
    "NVIDIA_API_KEY": "test-nvidia-key",
    "MISTRAL_MODEL": "mistral-small-latest",
    "NVIDIA_MODEL": "meta/llama-3.3-70b-instruct",
    "AI_PROVIDER": "AUTO",
    "EVALIX_ENABLE_MOCK": "true",
    "MOCK_ACCURACY": "1.0",
    "AI_TIMEOUT_SECONDS": "5",
    "AI_MAX_RETRIES": "1",
    "ALLOWED_PAGE_ORIGINS": "http://localhost:8080,http://127.0.0.1:8080",
}


@pytest.fixture(autouse=True)
def test_env(monkeypatch):
    # Explicit env vars win over backend/.env (load_dotenv uses override=False),
    # so tests never touch real keys.
    for key, value in TEST_ENV.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def client():
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c
