from __future__ import annotations

import json

import pytest

from docproc.embeddings import FixtureEmbedder
from docproc.evaluation import (
    DATASET_DIR,
    GateDecisionRecord,
    GoldChangePair,
    GoldClause,
    GoldDiff,
    GoldDiffClause,
    GoldDocument,
    GoldGate,
    GoldProcedure,
    Manifest,
    ManifestDocument,
    best_coverage,
    coverage,
    load_gate_decisions,
    predicted_handling,
    run_eval,
    score_change_pairs,
    score_extraction,
    score_gates,
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
    assert report.llm == "fixture" and len(report.diffs) == 3
    assert {"employee-delayed-order-v2", "partner-item-substitution-v1", "partner-packing-sealing-v2"} <= {
        e.document_id for e in report.extraction}  # .txt uploads
    assert all(s.document_id.endswith("-scan") for s in report.skipped)
    assert 0.0 <= report.macro_recall <= 1.0 and 0.0 <= report.diff_accuracy <= 1.0
    gold_pairs = json.loads((DATASET_DIR / "dev" / "gold" / "change_pairs.json").read_text(encoding="utf-8"))
    assert report.change_pairs.pairs == len(gold_pairs) == 82
    assert sum(t.pairs for t in report.change_pairs.by_change_type.values()) == 82
    assert report.publication_gates.status == "not_scored" and report.publication_gates.gates == 8
    assert report.publication_gates.score is None and "gate" in (report.publication_gates.reason or "")


def _pair(pair_id: str, before: str, after: str, change_type: str, handling: str, language: str = "en") -> GoldChangePair:
    return GoldChangePair.model_validate({
        "pair_id": pair_id, "language": language, "role": "courier",
        "base": {"document_id": "d-v1", "clause_id": "C-01"}, "before": before, "after": after,
        "change_type": change_type, "material": handling == "regenerate_and_reassess", "expected_handling": handling,
    })


def test_predicted_handling_maps_matcher_reasons():
    assert predicted_handling([]) == "carry_forward"
    assert predicted_handling(["location changed"]) == "carry_forward"
    assert predicted_handling(["wording changed"]) == "refresh_text"
    for reason in ("numbers: 15 -> 20", "negation changed", "modality: obligation -> permission",
                   "audience: courier -> employee"):
        assert predicted_handling([reason, "location changed"]) == "regenerate_and_reassess"


def test_score_change_pairs_on_hand_made_arabic_and_english_cases():
    pairs = [
        _pair("same", "Wait 10 minutes after check-in.", "Wait 10 minutes after check-in.", "cosmetic", "carry_forward"),
        _pair("digits", "انتظر ١٠ دقائق.", "انتظر 10 دقائق.", "cosmetic", "carry_forward", "ar"),
        _pair("threshold", "انتظر ١٥ دقيقة بعد تسجيل الوصول.", "انتظر ٢٠ دقيقة بعد تسجيل الوصول.", "threshold",
              "regenerate_and_reassess", "ar"),
        _pair("negation", "أرسل البلاغ إلى مسؤول التوزيع.", "لا ترسل البلاغ إلى مسؤول التوزيع.", "negation",
              "regenerate_and_reassess", "ar"),
        # The matcher has no actor rule: a changed actor reads as wording only, so this material change is missed.
        _pair("actor", "The courier calls the customer.", "The dispatcher calls the customer.", "actor",
              "regenerate_and_reassess"),
        # Punctuation-only edit: the matcher sees wording, so a cosmetic change is over-handled (not material, though).
        _pair("punct", "Call the customer.", "Call the customer", "cosmetic", "carry_forward"),
    ]
    score = score_change_pairs(pairs)
    assert (score.pairs, score.correct) == (6, 4)
    assert score.accuracy == pytest.approx(4 / 6)
    assert (score.material_pairs, score.material_caught, score.material_recall) == (3, 2, pytest.approx(2 / 3))
    assert score.false_material == 0
    assert {(w.pair_id, w.expected, w.predicted) for w in score.wrong} == {
        ("actor", "regenerate_and_reassess", "refresh_text"), ("punct", "carry_forward", "refresh_text")}
    assert (score.by_change_type["cosmetic"].pairs, score.by_change_type["cosmetic"].correct) == (3, 2)
    assert (score.by_language["ar"].pairs, score.by_language["ar"].correct) == (3, 3)


def test_score_change_pairs_counts_non_material_pairs_sent_to_reassessment():
    pairs = [_pair("num", "Wait 10 minutes.", "Wait 12 minutes.", "wording", "refresh_text")]
    score = score_change_pairs(pairs)
    assert (score.material_pairs, score.material_recall, score.false_material) == (0, None, 1)
    with pytest.raises(ValueError):
        score_change_pairs([])


def _gate(gate_id: str, expected: str, reason_code: str) -> GoldGate:
    return GoldGate.model_validate({
        "gate_id": gate_id, "role": "courier", "language": "en",
        "citation": {"document_id": "courier-pickup-wait-v2", "clause_id": "CW-02"}, "claim": "claim",
        "reason_code": reason_code, "expected_decision": expected,
    })


_GATES = [_gate("G-1", "allow_trainer_review", "supported"), _gate("G-2", "block_publication", "threshold_mismatch"),
          _gate("G-3", "block_publication", "superseded_version")]


def test_score_gates_all_correct():
    decisions = [GateDecisionRecord(gate_id=g.gate_id, decision=g.expected_decision, reason_code=g.reason_code)
                 for g in _GATES]
    score = score_gates(_GATES, decisions)
    assert (score.gates, score.correct, score.accuracy) == (3, 3, 1.0)
    assert (score.must_block, score.unsafe_allows, score.wrongly_blocked, score.reason_agreement) == (2, 0, 0, 3)
    assert score.wrong == []


def test_score_gates_counts_unsafe_allows_and_wrongly_blocked_claims():
    decisions = [
        GateDecisionRecord(gate_id="G-1", decision="block_publication", reason_code="threshold_mismatch"),
        GateDecisionRecord(gate_id="G-2", decision="allow_trainer_review", reason_code="supported"),
        GateDecisionRecord(gate_id="G-3", decision="block_publication", reason_code="operator_mismatch"),
    ]
    score = score_gates(_GATES, decisions)
    assert (score.correct, score.unsafe_allows, score.wrongly_blocked, score.reason_agreement) == (1, 1, 1, 0)
    assert {w.gate_id for w in score.wrong} == {"G-1", "G-2"}


def test_score_gates_rejects_missing_duplicate_or_unknown_decisions():
    one = GateDecisionRecord(gate_id="G-1", decision="allow_trainer_review", reason_code="supported")
    with pytest.raises(ValueError, match="G-2"):
        score_gates(_GATES, [one])
    with pytest.raises(ValueError, match="G-1"):
        score_gates(_GATES[:1], [one, one])
    with pytest.raises(ValueError, match="G-9"):
        score_gates(_GATES[:1], [one, GateDecisionRecord(gate_id="G-9", decision="block_publication",
                                                         reason_code="supported")])


def test_run_eval_scores_a_gate_decisions_file(make_app, tmp_path):
    gold = json.loads((DATASET_DIR / "dev" / "gold" / "publication_gates.json").read_text(encoding="utf-8"))
    decisions = [{"gate_id": g["gate_id"], "decision": g["expected_decision"], "reason_code": g["reason_code"]}
                 for g in gold]
    path = tmp_path / "decisions.json"
    path.write_text(json.dumps(decisions), encoding="utf-8")
    assert len(load_gate_decisions(path)) == 8
    report = run_eval(make_app(), DATASET_DIR, tmp_path / "pages", gate_decisions=path)
    gates = report.publication_gates
    assert gates.status == "scored" and gates.score is not None
    assert (gates.score.accuracy, gates.score.unsafe_allows) == (1.0, 0)


def test_gold_models_parse_every_dev_change_pair_and_gate():
    pairs = json.loads((DATASET_DIR / "dev" / "gold" / "change_pairs.json").read_text(encoding="utf-8"))
    gates = json.loads((DATASET_DIR / "dev" / "gold" / "publication_gates.json").read_text(encoding="utf-8"))
    parsed = [GoldChangePair.model_validate(x) for x in pairs]
    assert all(p.material == (p.expected_handling == "regenerate_and_reassess") for p in parsed)
    assert len([GoldGate.model_validate(x) for x in gates]) == 8


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
