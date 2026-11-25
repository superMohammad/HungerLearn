"""Workflow 1 - understand a document version and store its clauses."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import ValidationError
from rapidfuzz import fuzz

from docproc.loaders import detect_format
from docproc.loaders.docx import load_docx
from docproc.loaders.pdf import probe_pdf, render_page_png
from docproc.loaders.text import load_text
from docproc.loaders.text_blocks import text_to_blocks
from docproc.llm.base import ClauseExtractor, merge_single_paragraph
from docproc.matching import ID_NAMESPACE
from docproc.models import (
    Audience, Block, ClauseDraft, ClauseRecord, ExtractionIssue, Section, SourceLocation, VersionInfo,
)
from docproc.normalize import content_hash, normalize, normalize_with_map
from docproc.ocr.base import OCRAdapter, OCRPageRequest
from docproc.storage.base import SqlRepository


class UnderstandState(TypedDict, total=False):
    document_id: str
    version_id: str
    file_path: str
    file_format: str
    page_count: int | None
    page_blocks: dict[int, list[Block]]      # PDF page / image index -> blocks (docx: key 0)
    pages_to_ocr: list[dict[str, Any]]       # {"page", "image_path", "image_name"}
    failed_pages: list[int]
    issues: list[ExtractionIssue]
    sections: list[Section]
    drafts: list[tuple[str, ClauseDraft]]    # (section_id, draft)
    records: list[ClauseRecord]


# file_format -> SourceLocation.kind
LOCATION_KIND: dict[str, str] = {"pdf": "pdf_page", "docx": "docx", "txt": "text", "image": "image"}

@dataclass
class UnderstandDeps:
    repo: SqlRepository
    extractor: ClauseExtractor
    ocr: OCRAdapter
    work_dir: Path = Path("data/pages")
    min_page_chars: int = 40
    min_letter_ratio: float = 0.5


def build_understand_graph(deps: UnderstandDeps):
    # ------------------------------------------------------------------ nodes
    def load_input(state: UnderstandState) -> UnderstandState:
        path = Path(state["file_path"])
        if not path.is_file():
            raise FileNotFoundError(path)
        if not state.get("document_id") or not state.get("version_id"):
            raise ValueError("document_id and version_id are required")
        return {"file_format": detect_format(path), "issues": [], "failed_pages": [], "page_blocks": {}, "pages_to_ocr": []}

    def parse_native(state: UnderstandState) -> UnderstandState:
        fmt, path = state["file_format"], Path(state["file_path"])
        page_blocks: dict[int, list[Block]] = {}
        to_ocr: list[dict[str, Any]] = []
        page_count = None
        if fmt == "docx":
            blocks, _warnings = load_docx(path)
            page_blocks[0] = blocks
        elif fmt == "txt":
            page_blocks[0] = load_text(path)
        elif fmt == "pdf":
            pages = probe_pdf(path, deps.min_page_chars, deps.min_letter_ratio)
            page_count = len(pages)
            issues = list(state.get("issues", []))
            for p in pages:
                if p.order_repaired_lines:
                    issues.append(ExtractionIssue(
                        kind="reading_order_repaired", page=p.page, blocking=False,
                        detail=f"{p.order_repaired_lines} line(s) had Arabic in visual order; restored logical order",
                    ))
                if p.needs_ocr:
                    img = deps.work_dir / state["document_id"] / state["version_id"] / f"page_{p.page:04d}.png"
                    render_page_png(path, p.page, img)
                    to_ocr.append({"page": p.page, "image_path": str(img), "image_name": None, "reason": p.reason})
                else:
                    page_blocks[p.page] = text_to_blocks(p.text, 0, page=p.page)
        else:  # standalone image: index 1, keep the filename
            page_count = 1
            to_ocr.append({"page": 1, "image_path": str(path), "image_name": path.name, "reason": "image"})
        out: UnderstandState = {"page_blocks": page_blocks, "pages_to_ocr": to_ocr, "page_count": page_count}
        if fmt == "pdf":
            out["issues"] = issues
        return out

    def ocr_pages(state: UnderstandState) -> UnderstandState:
        page_blocks = dict(state["page_blocks"])
        failed = list(state.get("failed_pages", []))
        issues = list(state.get("issues", []))
        is_image = state["file_format"] == "image"
        for item in state["pages_to_ocr"]:  # one page at a time keeps memory flat
            req = OCRPageRequest(
                document_id=state["document_id"], version_id=state["version_id"], page=item["page"],
                source_file=Path(state["file_path"]), image_path=Path(item["image_path"]), image_name=item["image_name"],
            )
            res = deps.ocr.ocr_page(req)
            if res.ok:
                page_blocks[item["page"]] = text_to_blocks(
                    res.text, 0, page=None if is_image else item["page"],
                    image_name=item["image_name"], image_index=item["page"] if is_image else None, text_source="ocr",
                )
            else:
                failed.append(item["page"])
                issues.append(ExtractionIssue(kind="ocr_failed", page=item["page"], detail=f"{res.engine}: {res.error}"))
        return {"page_blocks": page_blocks, "failed_pages": sorted(failed), "issues": issues}

    def segment_sections(state: UnderstandState) -> UnderstandState:
        blocks: list[Block] = []
        for key in sorted(state["page_blocks"]):
            for b in state["page_blocks"][key]:
                blocks.append(b.model_copy(update={"index": len(blocks)}))
        sections: list[Section] = []
        stack: list[tuple[int, str]] = []
        current: list[Block] = []

        def flush():
            if current:
                path = [t for _, t in stack]
                sections.append(Section(section_id=f"s{len(sections) + 1}", heading_path=path,
                                        heading=path[-1] if path else None, blocks=list(current)))

        for b in blocks:
            if b.kind == "heading":
                flush()
                current = []
                level = b.level or 1
                while stack and stack[-1][0] >= level:
                    stack.pop()
                stack.append((level, b.text))
            else:
                current.append(b)
        flush()
        return {"sections": sections}

    def extract_clauses(state: UnderstandState) -> UnderstandState:
        drafts: list[tuple[str, ClauseDraft]] = []
        issues = list(state.get("issues", []))
        for sec in state["sections"]:
            try:
                for d in merge_single_paragraph(sec, deps.extractor.extract(sec)):
                    drafts.append((sec.section_id, d))
            except (ValidationError, ValueError, RuntimeError) as e:
                issues.append(ExtractionIssue(kind="llm_error", section_id=sec.section_id,
                                              page=sec.blocks[0].page if sec.blocks else None, detail=str(e)[:500]))
        return {"drafts": drafts, "issues": issues}

    def validate_clauses(state: UnderstandState) -> UnderstandState:
        sections = {s.section_id: s for s in state["sections"]}
        issues = list(state.get("issues", []))
        records: list[ClauseRecord] = []
        seen_spans: set[tuple[str, int, int]] = set()
        for section_id, d in state["drafts"]:
            sec = sections[section_id]
            located = _locate_quote(sec, d.quote)
            if located is None:
                issues.append(ExtractionIssue(kind="quote_not_found", section_id=section_id,
                                              page=sec.blocks[0].page if sec.blocks else None,
                                              detail=f"quote not found in source text: {d.quote[:120]!r}"))
                continue
            quote, start, end, block, fuzzy = located
            if fuzzy:
                issues.append(ExtractionIssue(kind="quote_fuzzy_matched", section_id=section_id, page=block.page, blocking=False,
                                              detail="LLM quote differed slightly; stored exact source span instead"))
            if (section_id, start, end) in seen_spans:
                continue
            seen_spans.add((section_id, start, end))

            audiences, source, evidence = list(d.audiences), d.audience_source, d.audience_evidence
            if source == "inherited":
                heading_hit = next((h for h in reversed(sec.heading_path) if evidence and normalize(evidence) in normalize(h)), None)
                if heading_hit is None:
                    from docproc.llm.fixture import detect_audiences
                    heading_hit = next((h for h in reversed(sec.heading_path) if set(detect_audiences(h)) & set(audiences)), None)
                if heading_hit is None:
                    issues.append(ExtractionIssue(kind="audience_evidence_missing", section_id=section_id, page=block.page,
                                                  blocking=False, detail=f"inherited audience without heading evidence: {quote[:80]!r}"))
                    audiences, source, evidence = [Audience.unspecified], "unspecified", None
                else:
                    evidence = heading_hit
            loc = SourceLocation(
                kind=LOCATION_KIND[state["file_format"]],
                page=block.page, image_name=block.image_name, image_index=block.image_index,
                block_index=block.index, heading_path=sec.heading_path, text_source=block.text_source,
            )
            h = content_hash(quote, [a.value for a in audiences], d.heading or sec.heading)
            ordinal = len(records)
            records.append(ClauseRecord(
                record_id=str(uuid.uuid5(ID_NAMESPACE, f"rec|{state['document_id']}|{state['version_id']}|{ordinal}|{h}")),
                document_id=state["document_id"], version_id=state["version_id"], ordinal=ordinal,
                quote=quote, statement=d.statement, steps=d.steps, audiences=audiences, audience_source=source,
                audience_evidence=evidence, clause_number=d.clause_number, heading=d.heading or sec.heading,
                location=loc, content_hash=h,
            ))
        dup = {}
        for r in records:
            dup.setdefault(r.content_hash, []).append(r.ordinal)
        for hsh, ords in dup.items():
            if len(ords) > 1:
                issues.append(ExtractionIssue(kind="duplicate_hash", blocking=False,
                                              detail=f"identical clause text appears {len(ords)} times (ordinals {ords})"))
        return {"records": records, "issues": issues}

    def hash_and_persist(state: UnderstandState) -> UnderstandState:
        info = VersionInfo(
            document_id=state["document_id"], version_id=state["version_id"], source_file=str(state["file_path"]),
            file_format=state["file_format"], page_count=state.get("page_count"),  # type: ignore[arg-type]
            failed_pages=state.get("failed_pages", []), issues=state.get("issues", []),
        )
        deps.repo.upsert_version(info, state["records"])
        return {}

    def route_after_parse(state: UnderstandState) -> str:
        return "ocr_pages" if state.get("pages_to_ocr") else "segment_sections"

    # ------------------------------------------------------------------ graph
    g = StateGraph(UnderstandState)
    g.add_node("load_input", load_input)
    g.add_node("parse_native", parse_native)
    g.add_node("ocr_pages", ocr_pages)
    g.add_node("segment_sections", segment_sections)
    g.add_node("extract_clauses", extract_clauses)
    g.add_node("validate_clauses", validate_clauses)
    g.add_node("hash_and_persist", hash_and_persist)
    g.add_edge(START, "load_input")
    g.add_edge("load_input", "parse_native")
    g.add_conditional_edges("parse_native", route_after_parse, ["ocr_pages", "segment_sections"])
    g.add_edge("ocr_pages", "segment_sections")
    g.add_edge("segment_sections", "extract_clauses")
    g.add_edge("extract_clauses", "validate_clauses")
    g.add_edge("validate_clauses", "hash_and_persist")
    g.add_edge("hash_and_persist", END)
    return g.compile()


def _snap_to_words(text: str, start: int, end: int) -> tuple[int, int]:
    """Shrinks a fuzzy span so it never starts or ends inside a word (e.g. the tail of a heading)."""
    while start < end and start > 0 and text[start - 1].isalnum() and text[start].isalnum():
        start += 1
    while start < end and text[start].isspace():
        start += 1
    while end > start and end < len(text) and text[end - 1].isalnum() and text[end].isalnum():
        end -= 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def _locate_quote(sec: Section, quote: str) -> tuple[str, int, int, Block, bool] | None:
    """Find the quote in the section text; return the exact *source* span and its block."""
    text = sec.text
    offsets, pos = [], 0
    for b in sec.blocks:
        offsets.append((pos, b))
        pos += len(b.text) + 1
    norm_text, idx = normalize_with_map(text)
    norm_quote = normalize_with_map(quote)[0]
    if not norm_quote:
        return None
    fuzzy = False
    i = norm_text.find(norm_quote)
    if i >= 0:
        j = i + len(norm_quote)
    else:
        al = fuzz.partial_ratio_alignment(norm_quote, norm_text)
        if al is None or al.score < 95 or (al.dest_end - al.dest_start) < 0.9 * len(norm_quote):
            return None
        i, j, fuzzy = al.dest_start, al.dest_end, True
    start, end = idx[i], idx[j - 1] + 1
    if fuzzy:
        start, end = _snap_to_words(text, start, end)
    block = next(b for off, b in reversed(offsets) if off <= start)
    return text[start:end], start, end, block, fuzzy
