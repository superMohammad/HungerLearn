"""Build the bilingual fixture documents in tests/fixtures/.

    python scripts/make_fixtures.py [--font C:\\Windows\\Fonts\\arial.ttf]

The generated files are committed, so you only need to re-run this after editing CONTENT.
Requires the dev extra (python-docx). The PDF font must contain Arabic glyphs (Arial,
Tahoma, Segoe UI, Noto Naskh Arabic, ...).

What the two versions demonstrate (v1 -> v2):
  A 1.1  employees+owners, leave 7 days            unchanged (same page, same section)
  B 1.2  Arabic expense claims ٣٠ -> ١٥ days        changed   (stable ID kept)
  C 1.3  partner confidentiality (mixed AR/EN)     moved     Section 1 -> Section 2 (stable ID kept)
  D 1.4  owners approve remote work                removed
  E 2.2  annual security training, steps,          added     (audience inherited from heading)
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

import pymupdf as fitz
from docx import Document

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures"

TITLE = "Leave and Expense Policy / سياسة الإجازات والمصروفات"
S1 = "Section 1: General Provisions / القسم ١: أحكام عامة"
S2 = "Section 2: For Partners / القسم ٢: للشركاء"
A = "1.1 Employees and owners must record leave requests in the HR system at least 7 days before the leave starts."
B_V1 = "1.2 يجب على الموظفين تقديم مطالبات المصروفات خلال ٣٠ يومًا من تاريخ الشراء."
B_V2 = "1.2 يجب على الموظفين تقديم مطالبات المصروفات خلال ١٥ يومًا من تاريخ الشراء."
C_BODY = "Partners must keep all customer data confidential / يجب على الشركاء الحفاظ على سرية بيانات العملاء."
D = "1.4 Owners may approve remote work for up to 10 days per month."
INTRO = "This section applies to all partners. / ينطبق هذا القسم على جميع الشركاء."
E = "2.2 Complete the information security training every year / إكمال تدريب أمن المعلومات سنويًا:"
E_STEPS = ["Enrol through the learning portal / التسجيل عبر بوابة التعلم", "Pass the final quiz / اجتياز الاختبار النهائي"]

# pages -> list of (kind, text); kind in title|heading|p|li
V1 = [
    [("title", TITLE), ("heading", S1), ("p", A), ("p", B_V1), ("p", "1.3 " + C_BODY), ("p", D)],
    [("heading", S2), ("p", INTRO)],
]
V2 = [
    [("title", TITLE), ("heading", S1), ("p", A), ("p", B_V2)],
    [("heading", S2), ("p", INTRO), ("p", "2.1 " + C_BODY), ("p", E)] + [("li", s) for s in E_STEPS],
]


def write_docx(pages, path: Path) -> None:
    doc = Document()
    for page in pages:
        for kind, text in page:
            if kind == "title":
                doc.add_heading(text, level=1)
            elif kind == "heading":
                doc.add_heading(text, level=2)
            elif kind == "li":
                doc.add_paragraph(text, style="List Bullet")
            else:
                doc.add_paragraph(text)
    doc.save(path)


def _html(page) -> str:
    parts = []
    for kind, text in page:
        t = html.escape(text)
        if kind == "title":
            parts.append(f"<h1>{t}</h1>")
        elif kind == "heading":
            parts.append(f"<h2>{t}</h2>")
        elif kind == "li":
            parts.append(f"<p>- {t}</p>")
        else:
            parts.append(f"<p>{t}</p>")
    return "\n".join(parts)


def write_pdf(pages, path: Path, font: str) -> None:
    css = f"@font-face {{font-family: base; src: url({Path(font).name});}} * {{font-family: base; font-size: 11pt;}}"
    archive = fitz.Archive(str(Path(font).parent))
    doc = fitz.open()
    for page in pages:
        p = doc.new_page(width=595, height=842)
        p.insert_htmlbox(fitz.Rect(40, 40, 555, 800), _html(page), css=css, archive=archive)
    doc.save(path)


def page_text(pdf: Path, page_no: int) -> str:
    from docproc.loaders.pdf import _page_text

    with fitz.open(str(pdf)) as d:
        return _page_text(d[page_no - 1])


def write_scanned(text_pdf: Path, scanned_pdf: Path, png: Path, scan_page: int = 2, dpi: int = 150) -> None:
    """Copy of text_pdf where `scan_page` is replaced by an image only (no text layer)."""
    src = fitz.open(str(text_pdf))
    pix = src[scan_page - 1].get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
    pix.save(str(png))
    out = fitz.open()
    for i in range(len(src)):
        if i == scan_page - 1:
            pg = out.new_page(width=src[i].rect.width, height=src[i].rect.height)
            pg.insert_image(pg.rect, filename=str(png))
        else:
            out.insert_pdf(src, from_page=i, to_page=i)
    out.save(str(scanned_pdf))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default=r"C:\Windows\Fonts\arial.ttf")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    write_docx(V1, OUT / "policy_v1.docx")
    write_docx(V2, OUT / "policy_v2.docx")
    write_pdf(V1, OUT / "policy_v1.pdf", args.font)
    write_pdf(V2, OUT / "policy_v2.pdf", args.font)
    write_scanned(OUT / "policy_v2.pdf", OUT / "policy_v2_scanned.pdf", OUT / "page2_scan.png")

    # Simulated OvisOCR3 output for the scanned page (what the Colab runner would export).
    # Text is in logical reading order, one paragraph per line, headings as plain lines.
    ocr_text = "\n".join(
        (f"- {t}" if k == "li" else t) for k, t in V2[1]
    )
    ocr = {
        "format": "docproc-ocr/1",
        "engine": "ATH-MaaS/OvisOCR3 (fixture)",
        "versions": {
            "v2-scan": {"pages": {"2": {"status": "ok", "text": ocr_text}}},
            "img-1": {"pages": {"page2_scan.png": {"status": "ok", "text": ocr_text}}},
        },
    }
    (OUT / "ocr_v2_scanned.json").write_text(json.dumps(ocr, ensure_ascii=False, indent=2), encoding="utf-8")
    failed = {
        "format": "docproc-ocr/1",
        "engine": "ATH-MaaS/OvisOCR3 (fixture)",
        "versions": {"v2-scan": {"pages": {"2": {"status": "failed", "error": "CUDA out of memory"}}}},
    }
    (OUT / "ocr_v2_missing_page.json").write_text(json.dumps(failed, ensure_ascii=False, indent=2), encoding="utf-8")

    links = {
        "_comment": "Keys are stable IDs or '@<version_id>#<clause_number>' selectors resolved at compare time.",
        "@v1#1.1": {"lesson_ids": ["lesson-leave-101"], "badge_ids": ["badge-hr-basics"]},
        "@v1#1.2": {"lesson_ids": ["lesson-expenses-201"], "badge_ids": ["badge-finance"]},
        "@v1#1.3": {"lesson_ids": ["lesson-partner-privacy"], "badge_ids": []},
        "@v1#1.4": {"lesson_ids": ["lesson-remote-work"], "badge_ids": ["badge-remote"]},
    }
    (OUT / "links.json").write_text(json.dumps(links, ensure_ascii=False, indent=2), encoding="utf-8")

    for n in (1, 2):
        print(f"--- policy_v2.pdf page {n} text layer ---\n{page_text(OUT / 'policy_v2.pdf', n)}")
    print(f"fixtures written to {OUT}")


if __name__ == "__main__":
    main()
