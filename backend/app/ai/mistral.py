from .openai_compat import OpenAICompatibleProvider


class MistralProvider(OpenAICompatibleProvider):
    """Mistral La Plateforme chat completions. Supports native JSON mode."""

    name = "MISTRAL"
    base_url = "https://api.mistral.ai/v1"
    json_mode = True
