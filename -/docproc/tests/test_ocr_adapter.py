"""Scanned-page path: page 2 of policy_v2_scanned.pdf has no text layer and goes through OCR."""
from pathlib import Path

from docproc.models import Status
from docproc.ocr import JsonImportOCR, OCRPageRequest
from docproc.ocr.null import NullOCR
from tests.conftest import find, run_pair


def test_json_import_lookup(fixtures_dir):
    ocr = JsonImportOCR(fixtures_dir / "ocr_v2_scanned.json")
    ok = ocr.ocr_page(OCRPageRequest("d", "v2-scan", 2, Path("x.pdf")))
    assert ok.ok and "Section 2" in ok.text and "OvisOCR3" in ok.engine
    by_name = ocr.ocr_page(OCRPageRequest("d", "img-1", 1, Path("page2_scan.png"), image_name="page2_scan.png"))
    assert by_name.ok
    missing = ocr.ocr_page(OCRPageRequest("d", "v2-scan", 9, Path("x.pdf")))
    assert not missing.ok and "page=9" in missing.error


def test_scanned_page_is_ocred_and_compared(make_app, fixtures_dir):
    app = make_app()
    ocr = JsonImportOCR(fixtures_dir / "ocr_v2_scanned.json")
    _, r2 = run_pair(app, fixtures_dir / "policy_v1.pdf", fixtures_dir / "policy_v2_scanned.pdf", v2_id="v2-scan", ocr=ocr)
    assert r2.complete
    assert r2.summary == {"unchanged": 1, "moved": 1, "changed": 1, "added": 1, "removed": 1, "needs_review": 0}
    c = find(r2, "customer data confidential")
    assert c.status == Status.moved
    assert c.new.location.text_source == "ocr" and c.new.location.page == 2
    assert c.old.location.text_source == "text_layer" and c.old.location.page == 1
    assert find(r2, "leave requests").new.location.text_source == "text_layer"


def test_standalone_image_records_filename(make_app, fixtures_dir):
    app = make_app()
    st = app.ingest(fixtures_dir / "page2_scan.png", "img-doc", "img-1",
                    ocr=JsonImportOCR(fixtures_dir / "ocr_v2_scanned.json"))
    assert st["failed_pages"] == []
    locs = [r.location for r in st["records"]]
    assert locs and all(l.kind == "image" and l.image_name == "page2_scan.png" and l.image_index == 1 for l in locs)


def test_null_ocr_error_text_is_what_the_web_app_matches():
    """web/src/lib/docproc-issues.ts recognises a missing OCR engine by this exact text."""
    result = NullOCR().ocr_page(OCRPageRequest(document_id="d", version_id="v1", page=1, source_file=Path("scan.pdf")))
    assert result.ok is False and result.error == "OCR not configured"
