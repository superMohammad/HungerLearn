"""OCR failure must never produce a false removal."""
from docproc.matching import REMOVAL_DEFERRED
from docproc.models import Status
from docproc.ocr import JsonImportOCR, NullOCR
from tests.conftest import run_pair


def _check_deferred(r1, r2):
    v1_ids = {c.new.clause_number: c.stable_id for c in r1.clauses}
    assert r2.complete is False
    assert any("pages [2]" in s for s in r2.incomplete_reasons)
    assert r2.summary["removed"] == 0, "missing OCR text must not be reported as removed"
    deferred = {c.stable_id: c for c in r2.needs_review if c.review_reason == REMOVAL_DEFERRED}
    # C (moved onto the failed page) and D (really removed) are both deferred, not removed
    assert set(deferred) == {v1_ids["1.3"], v1_ids["1.4"]}
    assert all(c.old is not None and c.new is None for c in deferred.values())
    # clauses on the readable page are still compared normally
    statuses = {c.stable_id: c.status for c in r2.clauses}
    assert statuses[v1_ids["1.1"]] == Status.unchanged
    assert statuses[v1_ids["1.2"]] == Status.changed
    # deferred removals never reach lesson regeneration
    assert {x.status for x in r2.lesson_regeneration} == {Status.changed}
    assert any(i.kind == "ocr_failed" and i.page == 2 for i in r2.issues)


def test_failed_page_in_ocr_json_defers_removals(make_app, fixtures_dir):
    ocr = JsonImportOCR(fixtures_dir / "ocr_v2_missing_page.json")
    r1, r2 = run_pair(make_app(), fixtures_dir / "policy_v1.pdf", fixtures_dir / "policy_v2_scanned.pdf",
                      v2_id="v2-scan", ocr=ocr)
    _check_deferred(r1, r2)


def test_no_ocr_available_defers_removals(make_app, fixtures_dir):
    r1, r2 = run_pair(make_app(), fixtures_dir / "policy_v1.pdf", fixtures_dir / "policy_v2_scanned.pdf",
                      v2_id="v2-scan", ocr=NullOCR())
    _check_deferred(r1, r2)


def test_rerun_with_ocr_resolves_the_comparison(make_app, fixtures_dir):
    app = make_app()
    run_pair(app, fixtures_dir / "policy_v1.pdf", fixtures_dir / "policy_v2_scanned.pdf", v2_id="v2-scan", ocr=NullOCR())
    app.ingest(fixtures_dir / "policy_v2_scanned.pdf", "doc-1", "v2-scan", ocr=JsonImportOCR(fixtures_dir / "ocr_v2_scanned.json"))
    r = app.compare("doc-1", "v2-scan")
    assert r.complete and r.summary["removed"] == 1 and r.summary["moved"] == 1 and r.summary["needs_review"] == 0
