"""Clause-extraction interface + the shared prompt used by real LLM backends."""
from __future__ import annotations

import json
from typing import Protocol

from docproc.models import ClauseDraft, ClauseDraftList, Section
from docproc.normalize import normalize

SYSTEM_PROMPT = """You extract policy clauses (rules and procedures) from one section of an \
Arabic, English, or mixed-language policy document.

One clause is one numbered item, one table row, or one paragraph: keep all of its sentences in one \
quote (a condition with its actions, a rule with its exception, a rule with who approves it). Split a \
paragraph only when it holds independent rules for different situations. A section whose body is a \
single paragraph is exactly one clause: quote that whole paragraph. When a short title line of the \
clause itself ("3. Message the customer", "[ ] ٢. إغلاق الأكياس") directly precedes its rule, start the \
quote with that line.

Return JSON matching the schema. For each rule or procedure in the section:
- quote: copy the clause text EXACTLY from the section, character for character. Keep Arabic \
wording, Arabic-Indic or Latin digits, punctuation, and reading order as they appear. Do not \
translate, paraphrase, fix typos, or merge text from different paragraphs unless they form one clause.
- statement: one short sentence (same language as the quote) stating the rule.
- steps: ordered steps if the clause is a procedure, otherwise [].
- audiences: any of owner, employee, partner, courier: the people who must FOLLOW the rule, not \
people the rule merely mentions (in "ask the branch employee to update the order", the employee is \
mentioned, not the audience). A rule written in the second person ("you", "لا تغادر") is for the \
document's reader, whose role is often only in the title or heading. Use unspecified when the \
follower is not stated. If several audiences explicitly must follow it, list all of them.
- audience_source: "explicit" if the clause text names the audience, "inherited" if it comes only \
from the section heading, "unspecified" otherwise.
- audience_evidence: the words naming the audience; for inherited audiences, the exact heading text.
- clause_number: the clause number as written (e.g. "2.1", "٢-١", "Article 3") or null.
- heading: the section heading as written, or null.
Skip document titles, standalone headings, introductions that only say who uses the document or when it applies, and \
text that states no rule. Never invent clauses."""


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


def merge_single_paragraph(section: Section, drafts: list[ClauseDraft]) -> list[ClauseDraft]:
    """Enforce "a section whose body is one paragraph is one clause" (see SYSTEM_PROMPT). Pure.

    Models still split such paragraphs sentence by sentence now and then, which gives the same rule a
    different shape in each version. When every draft lies inside the section's only paragraph, they
    become one draft quoting the whole paragraph; anything else is returned unchanged.
    """
    body = [b for b in section.blocks if b.kind != "heading"]
    if len(drafts) < 2 or len(body) != 1:
        return drafts
    paragraph = normalize(body[0].text)
    if not all(normalize(d.quote) in paragraph for d in drafts):
        return drafts
    sources = {d.audience_source for d in drafts}
    if sources == {"explicit"}:
        source = "explicit"
    elif sources & {"explicit", "inherited"}:
        source = "inherited"  # some sentences did not name the audience: the heading check applies
    else:
        source = "unspecified"
    return [ClauseDraft(
        quote=body[0].text,
        statement=" ".join(d.statement for d in drafts),
        steps=[s for d in drafts for s in d.steps],
        audiences=[a for d in drafts for a in d.audiences],
        audience_source=source,
        audience_evidence=next((d.audience_evidence for d in drafts if d.audience_evidence), None),
        clause_number=next((d.clause_number for d in drafts if d.clause_number), None),
        heading=next((d.heading for d in drafts if d.heading), None),
    )]
