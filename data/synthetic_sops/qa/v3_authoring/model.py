"""Typed structure of a v3 SOP. One bilingual record per family renders to PDF, DOCX and TXT in both languages
and produces the gold labels, so the uploads and the labels cannot drift apart.

Every visible string is a `Text` pair (Arabic, English), written natively in each language rather than translated
word by word. Only `Rule` text is normative: it becomes a gold clause. Context, examples, mistakes, tables and
appendices are descriptive, as in a real SOP, and are not labelled.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Union

Language = Literal["ar", "en"]
LANGUAGES: tuple[Language, ...] = ("ar", "en")


@dataclass(frozen=True)
class Text:
    ar: str
    en: str

    def get(self, language: Language) -> str:
        return self.ar if language == "ar" else self.en


@dataclass(frozen=True)
class Rule:
    """One gold clause. `text` is the exact quote; the renderer prints it after its rule number (6.1, ٦.١)."""
    clause_id: str
    text: Text


@dataclass(frozen=True)
class Rules:
    rules: tuple[Rule, ...]


@dataclass(frozen=True)
class Paragraph:
    text: Text


@dataclass(frozen=True)
class Subheading:
    """A bold label inside a section ("What to do", «القواعد»). Never a document heading."""
    text: Text


@dataclass(frozen=True)
class Bullets:
    items: tuple[Text, ...]


@dataclass(frozen=True)
class Table:
    caption: Text
    header: tuple[Text, ...]
    rows: tuple[tuple[Text, ...], ...]


@dataclass(frozen=True)
class Figure:
    """A chart or photo, always an image so its labels never enter the extracted text. `image` names a chart in
    `FamilyV3.charts` (`localized`: drawn per language) or a photo in web/public/brand/photos/."""
    image: str
    localized: bool
    caption: Text


@dataclass(frozen=True)
class Callout:
    title: Text
    text: Text


Block = Union[Paragraph, Subheading, Bullets, Table, Figure, Callout, Rules]


@dataclass(frozen=True)
class Section:
    """A numbered document section. `kind` decides the heading word: «القسم» / "Section" or «الملحق» / "Appendix".
    A procedure section is one gold procedure; its rules are the procedure's clauses in order."""
    title: Text
    kind: Literal["section", "appendix"]
    procedure: bool
    blocks: tuple[Block, ...]


@dataclass(frozen=True)
class Cover:
    """`organization` and `branch` are printed in each language. In the family's own language they must equal v2's
    names; an English upload prints the manifest's English names."""
    title: Text
    organization: Text
    branch: Text
    subtitle: Text
    scope_quote: Text
    document_number: str
    effective_date: str
    photo: str


@dataclass(frozen=True)
class ClauseChange:
    """How a v3 clause relates to the v2 clause with the same ID. `reason` is written for the diff gold."""
    change: Literal["unchanged", "changed", "added"]
    reason: str


@dataclass(frozen=True)
class FlowChart:
    """Stages left to right (right to left in Arabic), each with a short note under it."""
    steps: tuple[tuple[Text, Text], ...]


@dataclass(frozen=True)
class TimelineChart:
    """Minutes on one axis, with a labelled marker at each step."""
    axis_label: Text
    end: int
    points: tuple[tuple[int, Text], ...]


@dataclass(frozen=True)
class BarChart:
    """One series of values over categories, with an optional target line (illustrative data)."""
    unit: Text
    categories: tuple[Text, ...]
    values: tuple[float, ...]
    target: float
    target_label: Text


Chart = Union[FlowChart, TimelineChart, BarChart]


@dataclass(frozen=True)
class FamilyV3:
    family: str
    original_language: Language
    original_format: Literal["pdf", "docx", "txt"]
    cover: Cover
    sections: tuple[Section, ...]
    facts: dict[str, dict[str, object]]
    changes: dict[str, ClauseChange]
    removed: dict[str, str]
    charts: dict[str, Chart]

    def procedures(self) -> list[tuple[int, Section]]:
        """(section number, section) of every procedure, in document order."""
        return [(n, s) for n, s in self.numbered() if s.procedure]

    def numbered(self) -> list[tuple[int, Section]]:
        """Sections numbered 1.. and appendices numbered 1.. (rendered as A, B, C / أ، ب، ج)."""
        out: list[tuple[int, Section]] = []
        counters = {"section": 0, "appendix": 0}
        for s in self.sections:
            counters[s.kind] += 1
            out.append((counters[s.kind], s))
        return out
