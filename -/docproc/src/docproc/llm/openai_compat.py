"""Any OpenAI-compatible /chat/completions endpoint (OpenAI, Ollama, vLLM, LM Studio, ...)."""
from __future__ import annotations

import httpx

from docproc.llm.base import SYSTEM_PROMPT, build_user_prompt, parse_clause_json
from docproc.models import ClauseDraft, ClauseDraftList, Section


class OpenAICompatExtractor:
    name = "openai_compat"

    def __init__(self, base_url: str, model: str, api_key: str = "", timeout: float = 120.0, max_retries: int = 2):
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self.timeout = timeout
        self.max_retries = max_retries

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
