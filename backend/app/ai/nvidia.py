from .openai_compat import OpenAICompatibleProvider


class NvidiaProvider(OpenAICompatibleProvider):
    """NVIDIA NIM hosted API (build.nvidia.com). OpenAI-compatible; one key works for every model.

    JSON mode support varies by model, so we rely on the strict prompt + validated parsing instead.
    """

    name = "NVIDIA"
    base_url = "https://integrate.api.nvidia.com/v1"
    json_mode = False
