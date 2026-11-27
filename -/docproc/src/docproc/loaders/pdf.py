"""PDF loading with PyMuPDF: per-page selectable-text probe and page rendering for OCR."""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from pathlib import Path

import pymupdf as fitz  # PyMuPDF

from docproc.loaders.pdf_bidi import Glyph, logical_rows, rebuilds, restore_unmapped
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
    reordered_rows: int


def _inside(g: Glyph, bbox: tuple[float, float, float, float]) -> bool:
    cx = (g.x0 + g.x1) / 2
    return bbox[0] - 1 <= cx <= bbox[2] + 1 and bbox[1] - 1 <= g.cy <= bbox[3] + 1


def _rebuilt(bbox: tuple[float, float, float, float], plain: list[list[Glyph]], marks: list[Glyph]) -> tuple[str, int]:
    """A right-to-left block in logical order, from the ActualText-off glyphs inside its box, and how many of its
    rows differ from the stream order."""
    lines = [[g for g in line if _inside(g, bbox)] for line in plain]
    lines = [line for line in lines if line]
    if any(g.char == "\ufffd" for line in lines for g in line):
        lines = restore_unmapped(lines, marks)
    rows = [r for r in logical_rows(lines) if r]
    stream = {unicodedata.normalize("NFC", " ".join("".join(g.char for g in line).split())) for line in lines}
    return " ".join(rows), sum(r not in stream for r in rows)


def _page_text(page: "fitz.Page") -> tuple[str, int]:
    """Text block by block in reading order, and how many right-to-left rows were reordered.

    Left-to-right blocks keep the PDF stream order, and a page without a right-to-left block reads exactly as the
    stream gives it. A right-to-left block drawn right to left (pdf_bidi.rebuilds) is rebuilt from glyph positions,
    because browser-made PDFs write right-to-left runs in visual order. Its glyphs come from a reading with ActualText
    off: Chrome wraps letters carrying a shadda or tanween in ActualText, which yields zero-width glyphs between
    placeholder spaces; the ActualText reading only supplies marks for glyphs the font cannot map. On such a page,
    blocks on one row go right to left.
    """
    flags = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP
    blocks = _text_blocks(page, flags)
    glyphs = [_glyphs(b) for b in blocks]
    rtl = [rebuilds(g) for g in glyphs]
    plain = [line for b in _text_blocks(page, flags | fitz.TEXT_IGNORE_ACTUALTEXT) for line in _glyphs(b)] if any(rtl) else []
    marks = [g for lines in glyphs for line in lines for g in line if unicodedata.combining(g.char)]
    entries: list[_Entry] = []
    for b, is_rtl in zip(blocks, rtl):
        bbox = (b["bbox"][0], b["bbox"][1], b["bbox"][2], b["bbox"][3])
        across = -bbox[2] if any(rtl) else bbox[0]
        if is_rtl:
            text, reordered = _rebuilt(bbox, plain, marks)
        else:
            text, reordered = " ".join(s for s in (_stream_line(line) for line in b["lines"]) if s), 0
        entries.append(_Entry(round(bbox[1], 1), across, text, reordered))
    entries.sort(key=lambda e: (e.top, e.across))
    return "\n".join(e.text for e in entries if e.text), sum(e.reordered_rows for e in entries)


def probe_pdf(path: str | Path, min_chars: int = 40, min_letter_ratio: float = 0.5) -> list[PdfPage]:
    pages: list[PdfPage] = []
    with fitz.open(str(path)) as doc:
        for i, page in enumerate(doc, start=1):
            text, fixed = _page_text(page)
            lines = []
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
