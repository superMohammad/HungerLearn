"""Any OpenAI-compatible /chat/completions endpoint (OpenAI, Ollama, vLLM, LM Studio, ...)."""
from __future__ import annotations

import httpx

from docproc.llm.base import (
    CHANGE_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    build_change_prompt,
    build_user_prompt,
    parse_change_verdict,
    parse_clause_json,
)
from docproc.models import ChangeVerdict, ClauseDraft, ClauseDraftList, ClauseRecord, Section


class OpenAICompatExtractor:
    name = "openai_compat"

    def __init__(self, base_url: str, model: str, api_key: str = "", timeout: float = 120.0, max_retries: int = 2,
                 reasoning_effort: str = ""):
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self.timeout = timeout
        self.max_retries = max_retries
        self.reasoning_effort = reasoning_effort  # e.g. "none" turns off thinking on Ollama reasoning models

    def extract(self, section: Section) -> list[ClauseDraft]:
        body = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_prompt(section)},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "clauses", "schema": ClauseDraftList.model_json_schema()},
            },
        }
        if self.reasoning_effort:
            body["reasoning_effort"] = self.reasoning_effort
        last: Exception | None = None
        for _ in range(self.max_retries + 1):
            try:
                r = httpx.post(self.url, json=body, headers=self.headers, timeout=self.timeout)
                r.raise_for_status()
                content = r.json()["choices"][0]["message"]["content"]
                return parse_clause_json(content)
            except (httpx.HTTPError, ValueError, KeyError) as e:  # ValueError covers JSON/Pydantic errors
                last = e
        raise RuntimeError(f"LLM extraction failed after retries: {last}")


class OpenAICompatJudge:
    """Change judge over an OpenAI-compatible /chat/completions endpoint (Ollama, OpenRouter, vLLM, ...)."""

    name = "openai_compat"

    def __init__(self, base_url: str, model: str, api_key: str = "", timeout: float = 120.0, max_retries: int = 2,
                 reasoning_effort: str = "none", max_output_tokens: int = 512):
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self.timeout = timeout
        self.max_retries = max_retries
        # Sent on every call: thinking tokens would otherwise eat max_output_tokens and cut the answer off.
        self.reasoning_effort = reasoning_effort
        self.max_output_tokens = max_output_tokens
        self.transport: httpx.BaseTransport | None = None  # tests inject a mock transport

    def judge(self, old: ClauseRecord, new: ClauseRecord) -> ChangeVerdict:
        messages = [
            {"role": "system", "content": CHANGE_SYSTEM_PROMPT},
            {"role": "user", "content": build_change_prompt(old, new)},
        ]
        problem = ""
        with httpx.Client(transport=self.transport, timeout=self.timeout) as client:
            for _ in range(self.max_retries + 1):
                body: dict = {
                    "model": self.model,
                    "temperature": 0,
                    "max_tokens": self.max_output_tokens,
                    "messages": messages,
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {"name": "change_verdict", "schema": ChangeVerdict.model_json_schema()},
                    },
                }
                if self.reasoning_effort:
                    body["reasoning_effort"] = self.reasoning_effort
                try:
                    r = client.post(self.url, json=body, headers=self.headers)
                    r.raise_for_status()
                    choice = r.json()["choices"][0]
                except (httpx.HTTPError, ValueError, KeyError, IndexError) as e:
                    problem = f"request failed: {e}"
                    continue
                content = choice["message"].get("content") or ""
                if choice.get("finish_reason") == "length":
                    problem = (f"answer cut off at max_tokens={self.max_output_tokens} (reasoning_effort="
                               f"{self.reasoning_effort or 'server default'})")
                    continue
                try:
                    return parse_change_verdict(content)
                except ValueError as e:  # JSON or schema error: show the model its answer and the error
                    problem = f"invalid answer: {e}"
                    messages = [*messages[:2], {"role": "assistant", "content": content},
                                {"role": "user", "content": f"Your answer was invalid: {e}. Return only JSON "
                                                            "matching the schema."}]
        raise RuntimeError(f"change judge ({self.model}) failed after {self.max_retries + 1} attempts for clause "
                           f"{new.record_id}: {problem}")
