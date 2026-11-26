from docproc.config import Settings
from docproc.llm.base import ChangeJudge, ClauseExtractor
from docproc.llm.fixture import FixtureExtractor, FixtureJudge


def _anthropic_model(settings: Settings) -> str:
    return settings.llm_model if settings.llm_model.startswith("claude") else "claude-opus-5-5"


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

        return AnthropicExtractor(_anthropic_model(settings), settings.anthropic_api_key, settings.llm_timeout_s,
                                  settings.llm_max_retries)
    raise ValueError(settings.llm)


def make_change_judge(settings: Settings) -> ChangeJudge:
    """The model that decides whether a matched clause pair changed: the same backend as extraction."""
    if settings.llm == "fixture":
        return FixtureJudge(settings.change_max_output_tokens)
    if settings.llm == "openai_compat":
        from docproc.llm.openai_compat import OpenAICompatJudge

        return OpenAICompatJudge(
            settings.llm_base_url, settings.llm_model, settings.llm_api_key, settings.llm_timeout_s,
            settings.llm_max_retries, settings.change_reasoning_effort, settings.change_max_output_tokens,
        )
    if settings.llm == "anthropic":
        from docproc.llm.anthropic import AnthropicJudge

        return AnthropicJudge(_anthropic_model(settings), settings.anthropic_api_key, settings.llm_timeout_s,
                              settings.llm_max_retries)
    raise ValueError(settings.llm)


__all__ = ["ChangeJudge", "ClauseExtractor", "FixtureExtractor", "FixtureJudge", "make_change_judge", "make_extractor"]
