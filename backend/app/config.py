"""Backend configuration loaded from backend/.env (never shipped to the extension)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
VERSION = "0.1.0"

PROVIDER_MODES = ("MISTRAL", "NVIDIA", "AUTO", "MOCK")


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _csv(value: str | None) -> tuple[str, ...]:
    return tuple(v.strip().rstrip("/") for v in (value or "").split(",") if v.strip())


@dataclass(frozen=True)
class Settings:
    mistral_api_key: str
    nvidia_api_key: str
    mistral_model: str
    nvidia_model: str
    default_provider: str
    enable_mock: bool
    mock_accuracy: float
    ai_timeout_seconds: float
    ai_max_retries: int
    nvidia_enable_thinking: bool
    allowed_page_origins: tuple[str, ...]

    @property
    def mistral_configured(self) -> bool:
        return bool(self.mistral_api_key)

    @property
    def nvidia_configured(self) -> bool:
        return bool(self.nvidia_api_key)


@lru_cache
def get_settings() -> Settings:
    load_dotenv(BACKEND_DIR / ".env", override=False)
    provider = os.getenv("AI_PROVIDER", "AUTO").strip().upper()
    if provider not in PROVIDER_MODES:
        provider = "AUTO"
    return Settings(
        mistral_api_key=os.getenv("MISTRAL_API_KEY", "").strip(),
        nvidia_api_key=os.getenv("NVIDIA_API_KEY", "").strip(),
        mistral_model=os.getenv("MISTRAL_MODEL", "ministral-14b-latest").strip(),
        nvidia_model=os.getenv("NVIDIA_MODEL", "nvidia/nemotron-3.5-lightning-30b-a3b").strip(),
        default_provider=provider,
        enable_mock=_bool(os.getenv("EVALIX_ENABLE_MOCK"), default=False),
        mock_accuracy=float(os.getenv("MOCK_ACCURACY", "0.9")),
        ai_timeout_seconds=float(os.getenv("AI_TIMEOUT_SECONDS", "15")),
        ai_max_retries=int(os.getenv("AI_MAX_RETRIES", "2")),
        nvidia_enable_thinking=_bool(os.getenv("NVIDIA_ENABLE_THINKING"), default=False),
        allowed_page_origins=_csv(
            os.getenv("ALLOWED_PAGE_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080")
        ),
    )
