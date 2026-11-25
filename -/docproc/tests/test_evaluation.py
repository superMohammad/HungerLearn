from __future__ import annotations

import json

import pytest

from docproc.evaluation import (
    DATASET_DIR,
    GoldClause,
    GoldDiff,
    GoldDiffClause,
    GoldDocument,
    best_coverage,
    coverage,
    run_eval,
    score_extraction,
    word_set,
)
from docproc.models import ClauseRecord, SourceLocation


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
    gold = GoldDocument(document_id="d", clauses=[
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
    assert report.llm == "fixture" and len(report.diffs) == 1
    assert 0.0 <= report.macro_recall <= 1.0 and 0.0 <= report.diff_accuracy <= 1.0
