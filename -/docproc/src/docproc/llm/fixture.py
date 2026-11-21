"""Deterministic, rule-based clause extractor for tests and demos (no API key needed).

It produces the same ClauseDraft schema a real LLM returns. Each numbered paragraph
(or each paragraph with an obligation/permission word) becomes one clause; following list
items become its ordered steps. Audiences come from bilingual keyword lists, or are
inherited from the section heading.
"""
from __future__ import annotations

import re

from docproc.loaders.text_blocks import CLAUSE_NO
from docproc.models import Audience, ClauseDraft, Section
from docproc.normalize import modalities, normalize

_AUDIENCE_WORDS: dict[Audience, list[str]] = {
    Audience.owner: ["owner", "owners", "business owner", "المالك", "الملاك", "للملاك", "صاحب العمل", "أصحاب العمل"],
    Audience.employee: ["employee", "employees", "staff", "الموظف", "الموظفين", "الموظفون", "للموظفين", "العاملين"],
    Audience.partner: ["partner", "partners", "الشريك", "الشركاء", "للشركاء"],
}
_LIST_PREFIX = re.compile(r"^\s*(?:[-•*▪]|\(?[a-zأ-ي\d٠-٩]\))\s+")


def detect_audiences(text: str) -> list[Audience]:
    n = normalize(text)
    found = []
    for aud, kws in _AUDIENCE_WORDS.items():
        for kw in kws:
            k = normalize(kw)
            if re.search(rf"(?<![\w]){re.escape(k)}(?![\w])", n) or (not k.isascii() and k in n):
                found.append(aud)
                break
    return found


class FixtureExtractor:
    name = "fixture"

    def extract(self, section: Section) -> list[ClauseDraft]:
        drafts: list[ClauseDraft] = []
        heading = section.heading
        inherited = detect_audiences(" ".join(section.heading_path)) if section.heading_path else []
        current: dict | None = None

        def flush():
            nonlocal current
            if current:
                drafts.append(self._make(current, heading, inherited))
            current = None

        for b in section.blocks:
            if b.kind == "heading":
                continue
            if b.kind == "list_item" and current is not None:
                current["steps"].append(_LIST_PREFIX.sub("", b.text).strip())
                current["quote_parts"].append(b.text)
                continue
            m = CLAUSE_NO.match(b.text)
            if m or modalities(b.text):
                flush()
                current = {
                    "quote_parts": [b.text],
                    "number": m.group("no").strip() if m else None,
                    "body": b.text[m.end():].strip() if m else b.text,
                    "steps": [],
                }
            elif current is not None:
                current["quote_parts"].append(b.text)
        flush()
        return drafts

    @staticmethod
    def _make(c: dict, heading: str | None, inherited: list[Audience]) -> ClauseDraft:
        body = c["body"]
        explicit = detect_audiences(body)
        if explicit:
            audiences, source, evidence = explicit, "explicit", body
        elif inherited:
            audiences, source, evidence = inherited, "inherited", heading
        else:
            audiences, source, evidence = [Audience.unspecified], "unspecified", None
        statement = body.split(":")[0] if len(body) > 160 else body
        return ClauseDraft(
            quote="\n".join(c["quote_parts"]),
            statement=statement,
            steps=c["steps"],
            audiences=audiences,
            audience_source=source,  # type: ignore[arg-type]
            audience_evidence=evidence,
            clause_number=c["number"],
            heading=heading,
        )
