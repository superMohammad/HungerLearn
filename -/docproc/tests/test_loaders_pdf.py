"""Reading order of real text PDFs: Chrome/Skia Arabic PDFs come out in logical order, English PDFs unchanged."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

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


def test_english_pdfs_read_exactly_as_before() -> None:
    expected: dict[str, list[str]] = json.loads((FIX / "en_pdf_page_hashes.json").read_text(encoding="utf-8"))
    for rel, hashes in expected.items():
        path = Path(__file__).parent.parent / rel if rel.startswith("tests/") else DATASET / rel
        got = [hashlib.sha256(p.text.encode()).hexdigest() for p in probe_pdf(path)]
        assert got == hashes, rel
