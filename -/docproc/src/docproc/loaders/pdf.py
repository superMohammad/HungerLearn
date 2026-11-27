"""PDF loading with PyMuPDF: per-page selectable-text probe and page rendering for OCR."""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from pathlib import Path

import pymupdf as fitz  # PyMuPDF

from docproc.loaders.pdf_bidi import (
    Glyph,
    logical_rows,
    rebuilds_on_ltr_page,
    rebuilds_on_rtl_page,
    restore_unmapped,
    right_to_left_page,
)
from docproc.normalize import is_arabic_char, repair_arabic_order


@dataclass
class PdfPage:
    page: int  # 1-based
    text: str
    needs_ocr: bool
    reason: str = ""
    order_repaired_lines: int = 0


def _usable(text: str, min_chars: int, min_letter_ratio: float) -> tuple[bool, str]:
    stripped = "".join(c for c in text if not c.isspace())
    if len(stripped) < min_chars:
        return False, f"only {len(stripped)} non-space chars"
    if stripped.count("�") / len(stripped) > 0.02:
        return False, "replacement characters (broken font encoding)"
    letters = sum(c.isalpha() or c.isdigit() for c in stripped)
    if letters / len(stripped) < min_letter_ratio:
        return False, f"letter ratio {letters / len(stripped):.2f}"
    # Private-use glyphs = font without a ToUnicode map
    pua = sum(0xE000 <= ord(c) <= 0xF8FF for c in stripped)
    if pua / len(stripped) > 0.05:
        return False, "private-use glyphs"
    return True, ""


def _stream_line(line: dict) -> str:
    """One PyMuPDF line as the PDF stream gives it (the reading order for left-to-right text)."""
    t = unicodedata.normalize("NFC", "".join(c["c"] for s in line["spans"] for c in s["chars"])).strip()
    if t.startswith("\u00ad"):  # bullet dash rendered as a soft-hyphen glyph
        t = "- " + t.lstrip("\u00ad").lstrip()
    return t


def _glyphs(block: dict) -> list[list[Glyph]]:
    """Each line's glyphs in stream order, with their boxes."""
    return [[Glyph(c["c"], *c["bbox"], s["size"]) for s in line["spans"] for c in s["chars"]] for line in block["lines"]]


def _text_blocks(page: "fitz.Page", flags: int) -> list[dict]:
    return [b for b in page.get_text("rawdict", flags=flags)["blocks"] if b.get("type") == 0]


@dataclass(frozen=True)
class _Entry:
    top: float
    across: float  # horizontal sort key within a row
    text: str


Box = tuple[float, float, float, float]


def _box(block: dict) -> Box:
    return (block["bbox"][0], block["bbox"][1], block["bbox"][2], block["bbox"][3])


def _overlap(a: Box, b: Box) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0.0


def _line_box(line: list[Glyph]) -> Box:
    return (min(g.x0 for g in line), min(g.y0 for g in line), max(g.x1 for g in line), max(g.y1 for g in line))


def _assign(boxes: list[Box], plain: list[list[Glyph]]) -> list[list[list[Glyph]]]:
    """Each ActualText-off line goes to the one block it overlaps most, so no text is lost or read twice even when
    the two readings split blocks differently (a letter carrying a mark is wider without ActualText)."""
    out: list[list[list[Glyph]]] = [[] for _ in boxes]
    for line in plain:
        lb = _line_box(line)
        best = max(range(len(boxes)), key=lambda k: _overlap(boxes[k], lb), default=None)
        if best is not None and _overlap(boxes[best], lb) > 0:
            out[best].append(line)
    return out


def _rebuilt(lines: list[list[Glyph]], marks: list[Glyph]) -> str:
    """A right-to-left block in logical order, from its ActualText-off lines."""
    if any(g.char == "\ufffd" for line in lines for g in line):
        lines = restore_unmapped(lines, marks)
    return " ".join(r for r in logical_rows(lines) if r)


def _page_text(page: "fitz.Page") -> str:
    """Text block by block in reading order.

    Left-to-right blocks keep the PDF stream order, and a page without a right-to-left block reads exactly as the
    stream gives it. A right-to-left block drawn right to left is rebuilt from glyph positions (pdf_bidi), because
    browser-made PDFs write right-to-left runs in visual order. Its glyphs come from a reading with ActualText off:
    Chrome wraps letters carrying a shadda or tanween in ActualText, which yields zero-width glyphs between
    placeholder spaces; the ActualText reading only supplies marks for glyphs the font cannot map. On such a page,
    blocks on one row go right to left.
    """
    flags = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP
    blocks = _text_blocks(page, flags)
    glyphs = [_glyphs(b) for b in blocks]
    rebuilds = rebuilds_on_rtl_page if right_to_left_page(glyphs) else rebuilds_on_ltr_page
    rtl = [rebuilds(g) for g in glyphs]
    plain = [line for b in _text_blocks(page, flags | fitz.TEXT_IGNORE_ACTUALTEXT) for line in _glyphs(b) if line] if any(rtl) else []
    assigned = _assign([_box(b) for b in blocks], plain)
    marks = [g for lines in glyphs for line in lines for g in line if unicodedata.combining(g.char)]
    entries: list[_Entry] = []
    for b, is_rtl, lines in zip(blocks, rtl, assigned):
        box = _box(b)
        across = -box[2] if any(rtl) else box[0]
        if is_rtl:
            text = _rebuilt(lines, marks)
        else:
            text = " ".join(s for s in (_stream_line(line) for line in b["lines"]) if s)
        entries.append(_Entry(round(box[1], 1), across, text))
    entries.sort(key=lambda e: (e.top, e.across))
    return "\n".join(e.text for e in entries if e.text)


def probe_pdf(path: str | Path, min_chars: int = 40, min_letter_ratio: float = 0.5) -> list[PdfPage]:
    pages: list[PdfPage] = []
    with fitz.open(str(path)) as doc:
        for i, page in enumerate(doc, start=1):
            text = _page_text(page)
            lines, fixed = [], 0
            for line in text.splitlines():
                line, rep = repair_arabic_order(line)
                lines.append(line)
                fixed += rep
            text = "\n".join(lines)
            ok, reason = _usable(text, min_chars, min_letter_ratio)
            pages.append(PdfPage(page=i, text=text if ok else "", needs_ocr=not ok, reason=reason, order_repaired_lines=fixed))
    return pages


def render_page_png(path: str | Path, page_no: int, out_path: str | Path, dpi: int = 200) -> Path:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with fitz.open(str(path)) as doc:
        pix = doc[page_no - 1].get_pixmap(dpi=dpi)
        pix.save(str(out))
    return out


def arabic_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    return sum(is_arabic_char(c) for c in letters) / len(letters) if letters else 0.0
