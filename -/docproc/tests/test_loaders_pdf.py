"""Reading order of real text PDFs: Chrome/Skia Arabic PDFs come out in logical order, other PDFs unchanged."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import pymupdf as fitz
import pytest

from docproc.loaders.pdf import probe_pdf

DATASET = Path(__file__).resolve().parents[3] / "data" / "synthetic_sops"
FIX = Path(__file__).parent / "fixtures"
ARABIC_PDFS = ("courier-pickup-wait", "employee-delayed-order", "partner-packing-sealing")
HEADING = re.compile(r"^القسم [٠-٩]+: ")


def _gold() -> dict[str, dict]:
    rows = json.loads((DATASET / "dev" / "gold" / "extraction.json").read_text(encoding="utf-8"))
    return {r["document_id"]: r for r in rows}


def _flat(text: str) -> str:
    return " ".join(text.split())


@pytest.mark.parametrize("family", ARABIC_PDFS)
def test_every_gold_rule_of_an_arabic_chrome_pdf_is_on_its_page_in_logical_order(family: str) -> None:
    pages = probe_pdf(DATASET / "dev" / "uploads" / f"{family}-v3-ar.pdf")
    clauses = _gold()[f"{family}-v3-ar-pdf"]["clauses"]
    missing = [(c["clause_id"], c["locator"]["page"]) for c in clauses
               if _flat(c["quote"]) not in _flat(pages[c["locator"]["page"] - 1].text)]
    assert missing == []


@pytest.mark.parametrize("family", ARABIC_PDFS)
def test_every_section_heading_of_an_arabic_chrome_pdf_is_a_line_of_its_own(family: str) -> None:
    pages = probe_pdf(DATASET / "dev" / "uploads" / f"{family}-v3-ar.pdf")
    found = {line for p in pages for line in p.text.splitlines() if HEADING.match(line)}
    sections = {c["locator"]["section"] for c in _gold()[f"{family}-v3-ar-pdf"]["clauses"]}
    assert sections <= found


def test_left_to_right_pdfs_read_exactly_as_before() -> None:
    """Page-text hashes produced by origin/main's loaders/pdf.py (745adb3) before this change: the English dataset
    PDFs, the bilingual fixtures (Arabic quoted in left-to-right lines, letter-reversed Arabic) and the scan fixture."""
    expected: dict[str, list[str]] = json.loads((FIX / "ltr_pdf_page_hashes.json").read_text(encoding="utf-8"))
    for rel, hashes in expected.items():
        path = Path(__file__).parent.parent / rel if rel.startswith("tests/") else DATASET / rel
        got = [hashlib.sha256(p.text.encode()).hexdigest() for p in probe_pdf(path)]
        assert got == hashes, rel


def test_letter_reversed_arabic_is_still_repaired_by_normalize() -> None:
    pages = probe_pdf(FIX / "policy_v2.pdf")
    assert sum(p.order_repaired_lines for p in pages) > 0
    assert "اجتياز الاختبار النهائي" in " ".join(p.text.replace("\xa0", " ") for p in pages)


def test_a_left_to_right_page_keeps_the_text_its_actualtext_gives(tmp_path: Path) -> None:
    """Ligature or unmapped glyphs whose real text is only in /ActualText still read through it."""
    doc = fitz.open()
    page = doc.new_page()
    actual = "Wear fine gloves before you open the bag of any order for the customer."
    page.insert_text((72, 72), actual.replace("fine", "xne"), fontname="helv")  # drawn glyphs differ from the text
    xref = page.get_contents()[0]
    stream = doc.xref_stream(xref).decode("latin-1")
    stream = stream.replace("BT", f"/Span <</ActualText ({actual})>> BDC BT", 1).replace("ET", "ET EMC", 1)
    doc.update_stream(xref, stream.encode("latin-1"))
    path = tmp_path / "actualtext.pdf"
    doc.save(path)
    text = probe_pdf(path)[0].text
    assert "xne" not in text and text.replace(" ", "") == actual.replace(" ", "")  # read through ActualText


def test_an_arabic_table_row_reads_its_cells_right_to_left() -> None:
    lines = probe_pdf(DATASET / "dev" / "uploads" / "courier-pickup-wait-v3-ar.pdf")[1].text.splitlines()
    assert "الإصدار التاريخ ملخص التعديل" in lines
    assert "1 2026-03-01 الإصدار الأول." in lines
    assert "رقم الوثيقة MF-OPS-017" in lines


# Words whose tanween the PDF text layer does not carry anywhere near them (only as a stray copy elsewhere).
KNOWN_TANWEEN_LOSSES = {
    "courier-pickup-wait": {"أولاً"},
    "employee-delayed-order": {"فريقاً"},
    "partner-packing-sealing": set(),
}


def _txt_lines(path: Path) -> list[str]:
    """Every line and table cell of a dataset TXT upload, without its Markdown-like markers."""
    out: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = re.sub(r"^#+\s*|^\s*[-*]\s+|\*\*", "", line).strip()
        if not line or set(line) <= set("|-: =") or line.startswith("["):
            continue
        out += [c.strip() for c in line.strip("|").split("|")] if line.startswith("|") else [line]
    return [c for c in out if c]


@pytest.mark.parametrize("family", ARABIC_PDFS)
def test_an_arabic_chrome_pdf_reads_like_its_txt_copy(family: str) -> None:
    """Every line of the TXT copy of the same document (scenarios, tables, captions, footers included) appears in the
    PDF text, except words whose tanween the PDF does not carry."""
    uploads = DATASET / "dev" / "uploads"
    pdf = _flat(" ".join(p.text for p in probe_pdf(uploads / f"{family}-v3-ar.pdf")))
    missing = [line for line in _txt_lines(uploads / f"{family}-v3-ar.txt") if _flat(line) not in pdf]
    unexplained = [line for line in missing
                   if not any(_flat(line.replace(w, w[:-1])) in pdf for w in KNOWN_TANWEEN_LOSSES[family])]
    assert unexplained == []
