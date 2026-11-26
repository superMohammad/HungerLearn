"""Deterministic, rule-based clause extractor for tests and demos (no API key needed).

It produces the same ClauseDraft schema a real LLM returns. Each numbered paragraph
(or each paragraph with an obligation/permission word) becomes one clause; following list
items become its ordered steps. Audiences come from bilingual keyword lists, or are
inherited from the section heading.
"""
from __future__ import annotations

import re

from docproc.loaders.text_blocks import CLAUSE_NO
from docproc.models import Audience, ChangeVerdict, ClauseDraft, ClauseRecord, Section
from docproc.normalize import modalities, normalize, words

_AUDIENCE_WORDS: dict[Audience, list[str]] = {
    Audience.owner: ["owner", "owners", "business owner", "المالك", "الملاك", "للملاك", "صاحب العمل", "أصحاب العمل"],
    Audience.employee: ["employee", "employees", "staff", "الموظف", "الموظفين", "الموظفون", "للموظفين", "العاملين"],
    Audience.partner: ["partner", "partners", "الشريك", "الشركاء", "للشركاء"],
    Audience.courier: ["courier", "couriers", "rider", "riders", "المندوب", "المناديب", "مندوب التوصيل", "السائق"],
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


# matching.change_reasons prefix -> the change kind a model would report
_RULE_KINDS = (("numbers", "threshold"), ("negation", "negation"), ("modality", "modality"),
               ("audience", "audience"), ("wording", "wording"))


def _only_in(a: str, b: str) -> str:
    """Words of `a` (in order, once each) that `b` does not contain."""
    other, seen, out = set(words(b)), set(), []
    for w in words(a):
        if w not in other and w not in seen:
            seen.add(w)
            out.append(w)
    return " ".join(out)


class FixtureJudge:
    """Deterministic stand-in for the change judge (tests, demos, `docproc eval` without --real).

    It reports docproc's fixed text rules (`matching.change_reasons`) as a verdict, so offline runs keep
    their rule-based results; with a real LLM configured, the model decides instead.
    """

    name = "fixture"

    def judge(self, old: ClauseRecord, new: ClauseRecord) -> ChangeVerdict:
        from docproc.matching import change_reasons  # matching imports the judge protocol from docproc.llm

        reasons = change_reasons(old, new)
        kind = next((k for prefix, k in _RULE_KINDS if any(r.startswith(prefix) for r in reasons)), "none")
        if kind == "none":
            return ChangeVerdict(kind="none", old_evidence="", new_evidence="", explanation="rules: no content change")
        return ChangeVerdict(kind=kind, old_evidence=_only_in(old.quote, new.quote),
                             new_evidence=_only_in(new.quote, old.quote), explanation=f"rules: {'; '.join(reasons)}")
