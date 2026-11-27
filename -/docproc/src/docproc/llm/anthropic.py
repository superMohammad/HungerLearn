"""Claude via the official Anthropic SDK with structured outputs (pip install -e ".[anthropic]")."""
from __future__ import annotations

from docproc.llm.base import CHANGE_SYSTEM_PROMPT, SYSTEM_PROMPT, build_change_prompt, build_user_prompt
from docproc.models import ChangeVerdict, ClauseDraft, ClauseDraftList, ClauseRecord, Section


class AnthropicExtractor:
    name = "anthropic"

    def __init__(self, model: str = "claude-opus-5-5", api_key: str = "", timeout: float = 120.0, max_retries: int = 2):
        import anthropic

        kwargs = {"timeout": timeout, "max_retries": max_retries}
        if api_key:
            kwargs["api_key"] = api_key
        self.client = anthropic.Anthropic(**kwargs)  # also picks up ANTHROPIC_API_KEY / `ant auth login`
        self.model = model

    def extract(self, section: Section) -> list[ClauseDraft]:
        response = self.client.messages.parse(
            model=self.model,
            max_tokens=16000,
            output_config={"effort": "medium"},
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": build_user_prompt(section)}],
            output_format=ClauseDraftList,
            # Server-side fallback if a safety classifier declines the request.
            extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
            extra_body={"fallbacks": "default"},
        )
        if response.stop_reason == "refusal":
            raise RuntimeError(f"model refused: {getattr(response, 'stop_details', None)}")
        if response.stop_reason == "max_tokens":
            raise RuntimeError("output truncated (max_tokens)")
        parsed = response.parsed_output
        if parsed is None:
            raise RuntimeError("no structured output returned")
        return ClauseDraftList.model_validate(parsed.model_dump()).clauses


class AnthropicJudge:
    """Change judge via the Anthropic SDK with structured outputs.

    Claude Opus 5.5 cannot turn thinking off, so the judge asks for low effort and leaves room for thinking
    in max_tokens instead of using change_max_output_tokens (which is sized for a thinking-off answer).
    """

    name = "anthropic"
    MAX_TOKENS = 4096
    max_output_tokens = MAX_TOKENS  # thinking cannot be turned off on claude-opus-5-5: budget for it

    def __init__(self, model: str = "claude-opus-5-5", api_key: str = "", timeout: float = 120.0, max_retries: int = 2):
        import anthropic

        kwargs = {"timeout": timeout, "max_retries": max_retries}
        if api_key:
            kwargs["api_key"] = api_key
        self.client = anthropic.Anthropic(**kwargs)
        self.model = model

    def judge(self, old: ClauseRecord, new: ClauseRecord) -> ChangeVerdict:
        response = self.client.messages.parse(
            model=self.model,
            max_tokens=self.MAX_TOKENS,
            output_config={"effort": "low"},
            system=CHANGE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": build_change_prompt(old, new)}],
            output_format=ChangeVerdict,
            extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
            extra_body={"fallbacks": "default"},
        )
        if response.stop_reason == "refusal":
            raise RuntimeError(f"change judge refused clause {new.record_id}: {getattr(response, 'stop_details', None)}")
        if response.stop_reason == "max_tokens":
            raise RuntimeError(f"change judge answer cut off at max_tokens={self.MAX_TOKENS} for clause {new.record_id}")
        parsed = response.parsed_output
        if parsed is None:
            raise RuntimeError(f"change judge returned no structured output for clause {new.record_id}")
        return ChangeVerdict.model_validate(parsed.model_dump())
