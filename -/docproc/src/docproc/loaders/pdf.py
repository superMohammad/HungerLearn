"""PDF loading with PyMuPDF: per-page selectable-text probe and page rendering for OCR."""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from pathlib import Path

import pymupdf as fitz  # PyMuPDF

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


def _page_text(page: "fitz.Page") -> str:
    """Extract text block by block in reading order, preserving logical Arabic order.

    PyMuPDF returns characters in content-stream (logical) order for properly encoded
    PDFs. For right-to-left blocks we sort lines top-to-bottom only, never re-ordering
    characters within a line.
    """
    lines_out: list[str] = []
    data = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP)
    blocks = [b for b in data["blocks"] if b.get("type") == 0]
    blocks.sort(key=lambda b: (round(b["bbox"][1], 1), b["bbox"][0]))
    for b in blocks:
        block_lines = []
        for line in b["lines"]:
            t = "".join(s["text"] for s in line["spans"])
            t = unicodedata.normalize("NFC", t).strip()
            if t.startswith("­"):  # bullet dash rendered as a soft-hyphen glyph
                t = "- " + t.lstrip("­").lstrip()
            block_lines.append(t)
        text = " ".join(l for l in block_lines if l)
        if text:
            lines_out.append(text)
    return "\n".join(lines_out)


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
