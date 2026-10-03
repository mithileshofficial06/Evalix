"""Shared client for OpenAI-compatible chat-completions APIs (Mistral and NVIDIA NIM both are)."""

from __future__ import annotations

import httpx

from ..schemas import AnswerRequest
from .base import ProviderAnswer, ProviderError
from .prompt import InvalidModelOutput, build_messages, parse_answer


class OpenAICompatibleProvider:
    name = "OPENAI_COMPATIBLE"
    base_url = ""
    json_mode = False  # send response_format={"type": "json_object"}
    max_tokens = 100

    def __init__(
        self,
        api_key: str,
        model: str,
        timeout: float = 30,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self._transport = transport

    def _extra_payload(self) -> dict:
        """Provider-specific request fields."""
        return {}

    def _payload(self, req: AnswerRequest) -> dict:
        payload = {
            "model": self.model,
            "messages": build_messages(req),
            "temperature": 0,
            "max_tokens": self.max_tokens,
            **self._extra_payload(),
        }
        if self.json_mode:
            payload["response_format"] = {"type": "json_object"}
        return payload

    async def answer(self, req: AnswerRequest) -> ProviderAnswer:
        if not self.api_key:
            raise ProviderError(f"{self.name} API key is not configured", retryable=False)

        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self._transport) as client:
                res = await client.post(f"{self.base_url}/chat/completions", json=self._payload(req), headers=headers)
        except httpx.TimeoutException as e:
            raise ProviderError(f"{self.name} timed out", retryable=True) from e
        except httpx.HTTPError as e:
            raise ProviderError(f"{self.name} network error: {e}", retryable=True) from e

        if res.status_code == 429 and res.headers.get("x-ratelimit-limit-req-minute") == "0":
            # A zero quota means the model isn't included in the account's plan — retrying can't help.
            raise ProviderError(
                f"{self.name} model {self.model!r} is not available on this API plan (0 requests/min)",
                retryable=False,
                status=429,
            )
        if res.status_code != 200:
            retryable = res.status_code in (408, 409, 429) or res.status_code >= 500
            # Error bodies don't contain the key, but never echo request headers.
            raise ProviderError(
                f"{self.name} HTTP {res.status_code}: {res.text[:300]}", retryable=retryable, status=res.status_code
            )

        try:
            content = res.json()["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise ProviderError(f"{self.name} returned an unexpected response shape", retryable=True) from e

        try:
            letter, confidence = parse_answer(content, req)
        except InvalidModelOutput as e:
            # Sampling can produce malformed output; another attempt often succeeds.
            raise ProviderError(f"{self.name} invalid output: {e}", retryable=True) from e
        return ProviderAnswer(answer=letter, confidence=confidence, model=self.model)
