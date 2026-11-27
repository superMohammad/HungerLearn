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


def _page_text(page: "fitz.Page") -> tuple[str, int]:
    """Text block by block in reading order, and how many blocks needed right-to-left reordering.

    Left-to-right blocks keep the PDF stream order. A right-to-left block drawn right to left is rebuilt from glyph
    positions (pdf_bidi), because browser-made PDFs write right-to-left runs in visual order. It is read with
    ActualText off: Chrome wraps letters carrying a shadda or tanween in ActualText, which yields zero-width glyphs
    between placeholder spaces; the ActualText reading only supplies marks for glyphs the font cannot map.
    Right-to-left blocks on one row go right to left.
    """
    flags = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP
    blocks = _text_blocks(page, flags | fitz.TEXT_IGNORE_ACTUALTEXT)
    marks = [g for b in _text_blocks(page, flags) for line in _glyphs(b) for g in line if unicodedata.combining(g.char)]
    glyphs = [g for b in blocks for line in _glyphs(b) for g in line]
    left = min((g.x0 for g in glyphs), default=0.0)
    right = max((g.x1 for g in glyphs), default=0.0)
    entries: list[tuple[float, float, str, bool]] = []
    for b in blocks:
        top = round(b["bbox"][1], 1)
        if rebuilds(_glyphs(b), left, right):
            rows = logical_rows(restore_unmapped(_glyphs(b), marks))
            entries.append((top, -b["bbox"][2], " ".join(r for r in rows if r), True))
        else:
            entries.append((top, b["bbox"][0], " ".join(t for t in (_stream_line(line) for line in b["lines"]) if t), False))
    entries.sort(key=lambda e: (e[0], e[1]))
    return "\n".join(e[2] for e in entries if e[2]), sum(e[3] for e in entries)


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
