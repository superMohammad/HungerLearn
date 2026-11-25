"""Pydantic models: LLM output validation and the JSON contract shared with the team."""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

CONTRACT_VERSION = "1.1"  # 1.1: location kind "text", text_source "text", file_format "txt"


class Audience(str, Enum):
    owner = "owner"
    courier = "courier"
    employee = "employee"
    partner = "partner"
    unspecified = "unspecified"


class Status(str, Enum):
    unchanged = "unchanged"
    moved = "moved"
    changed = "changed"
    added = "added"
    removed = "removed"
    needs_review = "needs_review"


# ----------------------------------------------------------------------------- extraction
class SourceLocation(BaseModel):
    """Where a clause came from. Never part of the content hash."""

    kind: Literal["pdf_page", "docx", "text", "image"]
    page: int | None = Field(None, description="1-based PDF page number")
    image_name: str | None = None
    image_index: int | None = None
    block_index: int = Field(..., description="Position of the first source block in the document")
    heading_path: list[str] = Field(default_factory=list)
    text_source: Literal["text_layer", "docx", "text", "ocr"] = "text_layer"

    def position_key(self) -> tuple:
        """Coarse position used for unchanged-vs-moved: page/image + section path."""
        from docproc.normalize import normalize

        return (self.page, self.image_name, self.image_index, tuple(normalize(h) for h in self.heading_path))


class Block(BaseModel):
    """A paragraph / heading / list item from a parsed document."""

    text: str
    kind: Literal["heading", "paragraph", "list_item"] = "paragraph"
    level: int = 0
    index: int
    page: int | None = None
    image_name: str | None = None
    image_index: int | None = None
    text_source: Literal["text_layer", "docx", "text", "ocr"] = "text_layer"


class Section(BaseModel):
    section_id: str
    heading_path: list[str]
    heading: str | None
    blocks: list[Block]

    @property
    def text(self) -> str:
        return "\n".join(b.text for b in self.blocks)


class ClauseDraft(BaseModel):
    """What the LLM must return for each clause (validated strictly)."""

    quote: str = Field(..., min_length=3, description="Exact source text of the clause, verbatim")
    statement: str = Field(..., min_length=3, description="Short normalized statement of the rule")
    steps: list[str] = Field(default_factory=list, description="Ordered steps if it is a procedure")
    audiences: list[Audience] = Field(default_factory=lambda: [Audience.unspecified])
    audience_source: Literal["explicit", "inherited", "unspecified"] = "unspecified"
    audience_evidence: str | None = Field(
        None, description="Text that names the audience; the section heading when inherited"
    )
    clause_number: str | None = None
    heading: str | None = None

    @field_validator("audiences")
    @classmethod
    def _dedupe_audiences(cls, v: list[Audience]) -> list[Audience]:
        v = sorted(set(v), key=lambda a: a.value)
        if len(v) > 1 and Audience.unspecified in v:
            v = [a for a in v if a != Audience.unspecified]
        return v or [Audience.unspecified]

    @model_validator(mode="after")
    def _check_audience_source(self) -> "ClauseDraft":
        if self.audiences == [Audience.unspecified]:
            self.audience_source = "unspecified"
        elif self.audience_source == "unspecified":
            self.audience_source = "explicit"
        return self


class ClauseDraftList(BaseModel):
    clauses: list[ClauseDraft]


class ClauseRecord(BaseModel):
    """Version-specific clause record. `stable_id` is the cross-version identity."""

    record_id: str
    document_id: str
    version_id: str
    ordinal: int
    stable_id: str | None = None
    quote: str
    statement: str
    steps: list[str] = Field(default_factory=list)
    audiences: list[Audience]
    audience_source: Literal["explicit", "inherited", "unspecified"]
    audience_evidence: str | None = None
    clause_number: str | None = None
    heading: str | None = None
    location: SourceLocation
    content_hash: str


class ExtractionIssue(BaseModel):
    kind: Literal[
        "page_failed", "ocr_failed", "invalid_extraction", "quote_not_found",
        "quote_fuzzy_matched", "audience_evidence_missing", "llm_error", "duplicate_hash",
        "reading_order_repaired",
    ]
    detail: str
    page: int | None = None
    section_id: str | None = None
    blocking: bool = Field(True, description="True if text may be missing (comparison incomplete)")


class VersionInfo(BaseModel):
    document_id: str
    version_id: str
    source_file: str
    file_format: Literal["pdf", "docx", "txt", "image"]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    page_count: int | None = None
    failed_pages: list[int] = Field(default_factory=list)
    issues: list[ExtractionIssue] = Field(default_factory=list)

    @property
    def complete(self) -> bool:
        return not self.failed_pages and not any(i.blocking for i in self.issues)


# ----------------------------------------------------------------------------- report
class ClauseSide(BaseModel):
    record_id: str
    quote: str
    statement: str
    steps: list[str]
    audiences: list[Audience]
    audience_source: str
    audience_evidence: str | None
    clause_number: str | None
    heading: str | None
    location: SourceLocation
    content_hash: str


class ClauseChange(BaseModel):
    status: Status
    stable_id: str | None = Field(None, description="Null only for needs_review when identity is unclear")
    old: ClauseSide | None = None
    new: ClauseSide | None = None
    affected_audiences: list[Audience] = Field(default_factory=list)
    change_reasons: list[str] = Field(default_factory=list)
    review_reason: str | None = None
    candidate_stable_ids: list[str] = Field(default_factory=list)
    cosine: float | None = None
    lexical: float | None = None
    lesson_ids: list[str] = Field(default_factory=list)
    badge_ids: list[str] = Field(default_factory=list)


class RegenerationItem(BaseModel):
    stable_id: str
    status: Status
    affected_audiences: list[Audience]
    lesson_ids: list[str]
    badge_ids: list[str]


class ComparisonReport(BaseModel):
    contract_version: str = CONTRACT_VERSION
    document_id: str
    old_version_id: str | None
    new_version_id: str
    complete: bool
    incomplete_reasons: list[str] = Field(default_factory=list)
    embedding_model: str
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    summary: dict[str, int]
    clauses: list[ClauseChange]
    lesson_regeneration: list[RegenerationItem] = Field(
        description="changed/added/removed only; unchanged and moved never appear here"
    )
    needs_review: list[ClauseChange]
    issues: list[ExtractionIssue]
