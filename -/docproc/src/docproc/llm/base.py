"""Clause-extraction interface + the shared prompt used by real LLM backends."""
from __future__ import annotations

import json
from typing import Protocol

from docproc.models import ClauseDraft, ClauseDraftList, Section

SYSTEM_PROMPT = """You extract policy clauses (rules and procedures) from one section of an \
Arabic, English, or mixed-language policy document.

Return JSON matching the schema. For each rule or procedure in the section:
- quote: copy the clause text EXACTLY from the section, character for character. Keep Arabic \
wording, Arabic-Indic or Latin digits, punctuation, and reading order as they appear. Do not \
translate, paraphrase, fix typos, or merge text from different paragraphs unless they form one clause.
- statement: one short sentence (same language as the quote) stating the rule.
- steps: ordered steps if the clause is a procedure, otherwise [].
- audiences: any of owner, employee, partner. Use unspecified only when no audience applies. If \
several audiences explicitly apply, list all of them.
- audience_source: "explicit" if the clause text names the audience, "inherited" if it comes only \
from the section heading, "unspecified" otherwise.
- audience_evidence: the words naming the audience; for inherited audiences, the exact heading text.
- clause_number: the clause number as written (e.g. "2.1", "٢-١", "Article 3") or null.
- heading: the section heading as written, or null.
Skip headings, titles, and text that states no rule. Never invent clauses."""


def build_user_prompt(section: Section) -> str:
    return json.dumps(
        {
            "heading_path": section.heading_path,
            "section_text": section.text,
        },
        ensure_ascii=False,
        indent=1,
    )


class ClauseExtractor(Protocol):
    name: str

    def extract(self, section: Section) -> list[ClauseDraft]: ...


def parse_clause_json(raw: str) -> list[ClauseDraft]:
    """Validate raw JSON text from an LLM into ClauseDrafts (raises on invalid output)."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw[raw.find("{"):]
    data = json.loads(raw)
    if isinstance(data, list):
        data = {"clauses": data}
    return ClauseDraftList.model_validate(data).clauses
