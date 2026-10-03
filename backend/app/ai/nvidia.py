import httpx

from .openai_compat import OpenAICompatibleProvider


class NvidiaProvider(OpenAICompatibleProvider):
    """NVIDIA NIM hosted API (build.nvidia.com). OpenAI-compatible; one key works for every model.

    JSON mode support varies by model, so we rely on the strict prompt + validated parsing instead.
    Hybrid reasoning models (e.g. Nemotron 3.x) think before answering by default; for one-letter
    multiple-choice answers that roughly doubles latency, so thinking is off unless enabled.
    """

    name = "NVIDIA"
    base_url = "https://integrate.api.nvidia.com/v1"
    json_mode = False

    def __init__(
        self,
        api_key: str,
        model: str,
        timeout: float = 30,
        transport: httpx.AsyncBaseTransport | None = None,
        enable_thinking: bool = False,
        vision_model: str | None = None,
    ):
        super().__init__(api_key, model, timeout, transport, vision_model)
        self.enable_thinking = enable_thinking
        # Reasoning tokens count against max_tokens, so leave room when thinking is on.
        self.max_tokens = 4096 if enable_thinking else 100

    def _extra_payload(self) -> dict:
        # Models without a thinking switch ignore chat_template_kwargs.
        return {"chat_template_kwargs": {"enable_thinking": self.enable_thinking}}
