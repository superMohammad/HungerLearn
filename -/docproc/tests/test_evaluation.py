from __future__ import annotations

import json

import pytest

from docproc.embeddings import FixtureEmbedder
from docproc.evaluation import (
    DATASET_DIR,
    GoldClause,
    GoldDiff,
    GoldDiffClause,
    GoldDocument,
    GoldProcedure,
    Manifest,
    ManifestDocument,
    best_coverage,
    coverage,
    ingest_key,
    run_eval,
    score_extraction,
    skip_reason,
    word_set,
)
from docproc.llm.fixture import FixtureExtractor
from docproc.models import ClauseRecord, SourceLocation
from docproc.ocr.base import OCRPageRequest, OCRPageResult
from docproc.pipeline import App
from docproc.storage.sqlite import SqliteRepository


def _record(quote: str, ordinal: int) -> ClauseRecord:
    return ClauseRecord(
        record_id=f"r{ordinal}", document_id="d", version_id="v1", ordinal=ordinal, quote=quote, statement=quote,
        audiences=["unspecified"], audience_source="unspecified",
        location=SourceLocation(kind="docx", block_index=ordinal), content_hash=f"h{ordinal}",
    )


def test_coverage_counts_target_words_found_in_source():
    assert coverage(word_set("wait 15 minutes then call"), word_set("wait 15 minutes then call support")) == 1.0
    assert coverage(word_set("wait 15 minutes"), word_set("wait 10 minutes")) == pytest.approx(2 / 3)
    with pytest.raises(ValueError):
        coverage(frozenset(), word_set("x"))


def test_best_coverage_folds_arabic_indic_digits():
    index, value = best_coverage("انتظر ١٥ دقيقة", ["اتصل بالدعم", "انتظر 15 دقيقة ثم اتصل"])
    assert (index, value) == (1, 1.0)


def test_score_extraction_recall_and_precision():
    gold = GoldDocument(document_id="d", procedures=[GoldProcedure(title="Open the case", clause_ids=["A", "B"])], clauses=[
        GoldClause(clause_id="A", quote="Record the order ID and the check-in time."),
        GoldClause(clause_id="B", quote="Report a delay after fifteen minutes of waiting."),
    ])
    records = [_record("1. Record the order ID and the check-in time.", 0), _record("Synthetic training data", 1)]
    score = score_extraction(gold, records, ["quote_not_found"], 1)
    assert (score.found_clauses, score.supported_clauses) == (1, 1)
    assert score.missed_clause_ids == ["B"]
    assert (score.recall, score.precision, score.quote_not_found_issues) == (0.5, 0.5, 1)


def test_gold_models_parse_every_dev_label():
    extraction = json.loads((DATASET_DIR / "dev" / "gold" / "extraction.json").read_text(encoding="utf-8"))
    diffs = json.loads((DATASET_DIR / "dev" / "gold" / "version_diffs.json").read_text(encoding="utf-8"))
    assert all(GoldDocument.model_validate(x).clauses for x in extraction)
    assert all(GoldDiff.model_validate(x).clauses for x in diffs)
    assert GoldDiffClause(clause_id="X", change="added").change == "added"


def test_run_eval_offline_scores_dev_and_never_reads_held_out(make_app, tmp_path):
    report = run_eval(make_app(), DATASET_DIR, tmp_path / "pages")
    scored = {e.document_id for e in report.extraction} | {s.document_id for s in report.skipped}
    assert scored and all("held_out" not in d and not d.startswith(("courier-damaged", "employee-complaint",
                                                                      "partner-counter")) for d in scored)
    gold_diffs = json.loads((DATASET_DIR / "dev" / "gold" / "version_diffs.json").read_text(encoding="utf-8"))
    assert report.llm == "fixture" and len(report.diffs) == len(gold_diffs)
    assert {"employee-delayed-order-v2", "partner-item-substitution-v1", "partner-packing-sealing-v2"} <= {
        e.document_id for e in report.extraction}  # .txt uploads
    assert all(s.document_id.endswith("-scan") for s in report.skipped)
    assert 0.0 <= report.macro_recall <= 1.0 and 0.0 <= report.diff_accuracy <= 1.0


class _LiveOCR:
    """Stands in for OvisOCR on a GPU: every page reads as the same short procedure."""

    name = "ovis"

    def ocr_page(self, req: OCRPageRequest) -> OCRPageResult:
        return OCRPageResult(ok=True, text="# Waiting\n\n1. Wait 15 minutes, then call the dispatcher.", engine="test")


def _dev_scans() -> list[ManifestDocument]:
    manifest = Manifest.model_validate(json.loads((DATASET_DIR / "manifest.json").read_text(encoding="utf-8")))
    return [d for d in manifest.documents if d.split == "dev" and d.variant == "scan"]


def test_skip_reason_skips_scans_only_without_live_ocr():
    scans = _dev_scans()
    assert len(scans) == 3
    for scan in scans:
        for engine in ("null", "json_import"):
            reason = skip_reason(scan, DATASET_DIR, engine)
            assert reason is not None and "DOCPROC_OCR=ovis" in reason
        assert skip_reason(scan, DATASET_DIR, "ovis") is None


def test_run_eval_with_live_ocr_scores_scans_apart_from_their_originals(make_app, settings, tmp_path):
    without_ocr = run_eval(make_app(), DATASET_DIR, tmp_path / "pages-null")
    repo = SqliteRepository(str(tmp_path / "live.sqlite3"))
    repo.init_schema()
    live = App(settings.model_copy(update={"ocr": "ovis"}), repo=repo, extractor=FixtureExtractor(),
               ocr=_LiveOCR(), embedder=FixtureEmbedder())
    with_ocr = run_eval(live, DATASET_DIR, tmp_path / "pages-live")
    scan_ids = {d.document_id for d in _dev_scans()}
    assert with_ocr.skipped == []
    assert scan_ids <= {e.document_id for e in with_ocr.extraction}
    # A scan shares family and version with its original v1; scoring it must not overwrite that original.
    originals = [e for e in with_ocr.extraction if e.document_id not in scan_ids]
    assert originals == without_ocr.extraction
    assert with_ocr.diffs == without_ocr.diffs


def _manifest() -> Manifest:
    return Manifest.model_validate(json.loads((DATASET_DIR / "manifest.json").read_text(encoding="utf-8")))


def test_ingest_key_gives_every_v3_copy_its_own_document():
    v3 = [d for d in _manifest().documents if d.version == 3]
    assert v3, "the dev set has v3 uploads"
    originals = [d for d in v3 if d.variant == "original"]
    copies = [d for d in v3 if d.variant != "original"]
    assert all(ingest_key(d) == d.document_family for d in originals)
    # A copy or translation shares family and version with its original; scoring it must not replace that version.
    keys = [ingest_key(d) for d in copies]
    assert len(set(keys)) == len(copies) and not set(keys) & {d.document_family for d in originals}


def test_run_eval_scores_every_v3_upload_and_compares_v3_with_v2(make_app, tmp_path):
    report = run_eval(make_app(), DATASET_DIR, tmp_path / "pages")
    v3_ids = {d.document_id for d in _manifest().documents if d.version == 3}
    assert v3_ids <= {e.document_id for e in report.extraction}
    assert any(d.from_document_id.endswith("-v2") and d.to_document_id.endswith("-v3") for d in report.diffs)
