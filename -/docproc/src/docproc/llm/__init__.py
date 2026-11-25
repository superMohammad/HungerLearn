from docproc.config import Settings
from docproc.llm.base import ClauseExtractor
from docproc.llm.fixture import FixtureExtractor


def make_extractor(settings: Settings) -> ClauseExtractor:
    if settings.llm == "fixture":
        return FixtureExtractor()
    if settings.llm == "openai_compat":
        from docproc.llm.openai_compat import OpenAICompatExtractor

        return OpenAICompatExtractor(
            settings.llm_base_url, settings.llm_model, settings.llm_api_key,
            settings.llm_timeout_s, settings.llm_max_retries, settings.llm_reasoning_effort,
        )
    if settings.llm == "anthropic":
        from docproc.llm.anthropic import AnthropicExtractor

        model = settings.llm_model if settings.llm_model.startswith("claude") else "claude-opus-5-5"
        return AnthropicExtractor(model, settings.anthropic_api_key, settings.llm_timeout_s, settings.llm_max_retries)
    raise ValueError(settings.llm)


__all__ = ["ClauseExtractor", "FixtureExtractor", "make_extractor"]
