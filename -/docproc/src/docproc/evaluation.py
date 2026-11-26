"""Score stage 1 (clause extraction) and stage 6 (v1 -> v2 comparison) on the synthetic dev split.

Reads `data/synthetic_sops/manifest.json` and `dev/gold/{extraction,version_diffs}.json`, runs the
configured pipeline on a fresh SQLite database, and matches the output against the gold labels by
word coverage of the source quotes. It also scores docproc's matcher on the typed edits of
`dev/gold/change_pairs.json`, and a publication gate's decisions (when given) on
`dev/gold/publication_gates.json`. `held_out/` is never read: held-out evaluation needs a frozen
configuration and is a separate, deliberate run.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ValidationError

from docproc.config import OcrEngine
from docproc.loaders import detect_format
from docproc.config import Settings
from docproc.llm.base import ChangeJudge
from docproc.matching import MATERIAL_KINDS, PairDecision, decide_pair
from docproc.models import Audience, ClauseChange, ClauseRecord, ComparisonReport, SourceLocation, Status
from docproc.normalize import clause_body, words
from docproc.pipeline import App

DATASET_DIR = Path(__file__).resolve().parents[4] / "data" / "synthetic_sops"
SPLIT = "dev"
# A gold clause counts as found when one output quote covers this share of its words (and vice versa).
COVERAGE_THRESHOLD = 0.8

GoldChange = Literal["added", "changed", "removed", "unchanged"]
ChangeHandling = Literal["carry_forward", "refresh_text", "regenerate_and_reassess"]
# What the update flow does with a pair; needs_review = the judge could not decide (counts as not caught).
PredictedHandling = Literal["carry_forward", "refresh_text", "regenerate_and_reassess", "needs_review"]
GateDecision = Literal["allow_trainer_review", "block_publication"]
ChangeType = Literal["cosmetic", "wording", "threshold", "negation", "modality", "actor", "condition", "order"]
GATES_NOT_SCORED = ("no publication gate implementation to score yet (vGolden25's web gate); "
                    "pass its decisions with `docproc eval --gate-decisions FILE`")


class ManifestDocument(BaseModel):
    document_id: str
    path: str
    document_family: str
    version: int
    split: Literal["dev", "held_out"]
    variant: Literal["original", "scan"]


class Manifest(BaseModel):
    documents: list[ManifestDocument]


class GoldClause(BaseModel):
    clause_id: str
    quote: str


class GoldProcedure(BaseModel):
    title: str
    clause_ids: list[str]


class GoldDocument(BaseModel):
    document_id: str
    procedures: list[GoldProcedure]
    clauses: list[GoldClause]

    def title_of(self, clause_id: str) -> str:
        """Title of the procedure that holds the clause; every gold clause belongs to one."""
        titles = [p.title for p in self.procedures if clause_id in p.clause_ids]
        if len(titles) != 1:
            raise ValueError(f"{self.document_id}: clause {clause_id} is in {len(titles)} procedures, expected 1")
        return titles[0]


class GoldDiffClause(BaseModel):
    clause_id: str
    change: GoldChange


class GoldDiff(BaseModel):
    from_document_id: str
    to_document_id: str
    clauses: list[GoldDiffClause]


class GoldClauseRef(BaseModel):
    document_id: str
    clause_id: str


class GoldChangePair(BaseModel):
    """One typed edit of one gold clause (`dev/gold/change_pairs.json`)."""

    pair_id: str
    language: Literal["ar", "en"]
    role: Literal["courier", "employee", "partner"]
    base: GoldClauseRef
    before: str
    after: str
    change_type: ChangeType
    material: bool
    expected_handling: ChangeHandling


class GoldGate(BaseModel):
    """One draft claim and the gate decision it must get (`dev/gold/publication_gates.json`)."""

    gate_id: str
    role: Literal["courier", "employee", "partner"]
    language: Literal["ar", "en"]
    citation: GoldClauseRef
    claim: str
    reason_code: str
    expected_decision: GateDecision


class GateDecisionRecord(BaseModel):
    """What a publication gate decided for one gold claim: the contract a gate implementation writes."""

    gate_id: str
    decision: GateDecision
    reason_code: str


class SkippedDocument(BaseModel):
    document_id: str
    reason: str


class ExtractionScore(BaseModel):
    document_id: str
    gold_clauses: int
    extracted_clauses: int
    found_clauses: int
    supported_clauses: int
    recall: float
    precision: float
    missed_clause_ids: list[str]
    quote_not_found_issues: int
    blocking_issues: int


class DiffClauseResult(BaseModel):
    clause_id: str
    expected: GoldChange
    predicted: str


class DiffScore(BaseModel):
    from_document_id: str
    to_document_id: str
    clauses: int
    correct: int
    accuracy: float
    needs_review: int
    complete: bool
    wrong: list[DiffClauseResult]


class ChangePairResult(BaseModel):
    pair_id: str
    change_type: str
    language: str
    expected: ChangeHandling
    predicted: PredictedHandling
    reasons: list[str]
    review_reason: str | None


class GroupScore(BaseModel):
    pairs: int
    correct: int


class ChangePairScore(BaseModel):
    judge: str  # the change judge that decided (fixture = docproc's text rules; otherwise the configured LLM)
    pairs: int
    correct: int
    accuracy: float
    material_pairs: int
    material_caught: int
    material_recall: float | None  # None when no pair is material
    false_material: int  # non-material pairs that would send learners to reassessment
    needs_review: int  # pairs the judge could not decide (context too small, evidence not in the text)
    by_change_type: dict[str, GroupScore]
    by_language: dict[str, GroupScore]
    wrong: list[ChangePairResult]


class GateResult(BaseModel):
    gate_id: str
    expected: GateDecision
    predicted: GateDecision
    expected_reason: str
    predicted_reason: str


class GateScore(BaseModel):
    gates: int
    correct: int
    accuracy: float
    must_block: int
    unsafe_allows: int  # claims that must be blocked but were allowed (target 0)
    wrongly_blocked: int  # supported claims that were blocked
    reason_agreement: int  # decisions whose reason code equals the gold one
    wrong: list[GateResult]


class GateEval(BaseModel):
    status: Literal["scored", "not_scored"]
    reason: str | None
    gates: int
    score: GateScore | None


class EvalReport(BaseModel):
    split: str
    llm: str
    llm_model: str
    embedding_model: str
    coverage_threshold: float
    extraction: list[ExtractionScore]
    diffs: list[DiffScore]
    skipped: list[SkippedDocument]
    macro_recall: float
    macro_precision: float
    diff_accuracy: float
    change_pairs: ChangePairScore
    publication_gates: GateEval


def word_set(text: str) -> frozenset[str]:
    """Words of a quote without its leading clause number. Deliberately not docproc's title rules,
    so the metric cannot hide what those rules get wrong."""
    return frozenset(words(clause_body(text)))


def coverage(target: frozenset[str], source: frozenset[str]) -> float:
    """Share of the target's words that also appear in the source. Pure."""
    if not target:
        raise ValueError("coverage of an empty quote is undefined")
    return len(target & source) / len(target)


def best_coverage(target: str, candidates: list[str]) -> tuple[int, float]:
    """Index and coverage of the candidate that covers the most of `target`; (-1, 0.0) if none. Pure."""
    t = word_set(target)
    best_index, best_value = -1, 0.0
    for i, c in enumerate(candidates):
        value = coverage(t, word_set(c))
        if value > best_value:
            best_index, best_value = i, value
    return best_index, best_value


def supported_by(quote: str, gold: GoldDocument) -> bool:
    """True if the quote, minus a gold procedure title's words, is a rule of that gold clause.

    The title words are dropped (a PDF text layer keeps the title on the rule line); a quote that is
    only a title has nothing left and is unsupported. Pure.
    """
    q = word_set(quote)
    for clause in gold.clauses:
        rule = q - word_set(gold.title_of(clause.clause_id))
        if rule and coverage(rule, word_set(clause.quote)) >= COVERAGE_THRESHOLD:
            return True
    return False


def score_extraction(gold: GoldDocument, records: list[ClauseRecord], issue_kinds: list[str],
                     blocking_issues: int) -> ExtractionScore:
    """Recall: gold clauses covered by an extracted quote. Precision: extracted quotes that are a gold rule. Pure."""
    quotes = [r.quote for r in records]
    missed = [g.clause_id for g in gold.clauses if best_coverage(g.quote, quotes)[1] < COVERAGE_THRESHOLD]
    supported = sum(1 for q in quotes if supported_by(q, gold))
    found = len(gold.clauses) - len(missed)
    return ExtractionScore(
        document_id=gold.document_id, gold_clauses=len(gold.clauses), extracted_clauses=len(records),
        found_clauses=found, supported_clauses=supported,
        recall=found / len(gold.clauses), precision=supported / len(records) if records else 0.0,
        missed_clause_ids=missed, quote_not_found_issues=issue_kinds.count("quote_not_found"),
        blocking_issues=blocking_issues,
    )


def predicted_change(change: ClauseChange | None) -> str:
    """Gold has no `moved`: a moved clause is unchanged in content. Unmatched clauses are `missing`. Pure."""
    if change is None:
        return "missing"
    return "unchanged" if change.status == Status.moved else change.status.value


def find_change(report: ComparisonReport, quote: str, side: Literal["old", "new"]) -> ClauseChange | None:
    """The report entry whose quote on `side` best covers `quote`, if it reaches the threshold. Pure."""
    entries = [c for c in report.clauses if getattr(c, side) is not None]
    index, value = best_coverage(quote, [getattr(c, side).quote for c in entries])
    return entries[index] if value >= COVERAGE_THRESHOLD else None


def score_diff(gold: GoldDiff, before: GoldDocument, after: GoldDocument, report: ComparisonReport) -> DiffScore:
    """Compare each gold clause's expected change with the status docproc gave the matching clause. Pure."""
    before_quotes = {c.clause_id: c.quote for c in before.clauses}
    after_quotes = {c.clause_id: c.quote for c in after.clauses}
    results: list[DiffClauseResult] = []
    for clause in gold.clauses:
        if clause.change == "added":
            change = find_change(report, after_quotes[clause.clause_id], "new")
        else:
            change = find_change(report, before_quotes[clause.clause_id], "old")
        results.append(DiffClauseResult(clause_id=clause.clause_id, expected=clause.change,
                                        predicted=predicted_change(change)))
    wrong = [r for r in results if r.predicted != r.expected]
    return DiffScore(
        from_document_id=gold.from_document_id, to_document_id=gold.to_document_id, clauses=len(results),
        correct=len(results) - len(wrong), accuracy=(len(results) - len(wrong)) / len(results),
        needs_review=report.summary.get(Status.needs_review.value, 0), complete=report.complete, wrong=wrong,
    )


def predicted_handling(decision: PairDecision) -> PredictedHandling:
    """What the update flow would do with a clause given the matcher's decision for the pair. Pure."""
    if decision.status == Status.needs_review:
        return "needs_review"
    if decision.status != Status.changed:
        return "carry_forward"
    kinds = [r.split(":", 1)[0] for r in decision.reasons]
    return "regenerate_and_reassess" if any(k in MATERIAL_KINDS for k in kinds) else "refresh_text"


def _pair_record(text: str, pair: GoldChangePair, side: Literal["before", "after"]) -> ClauseRecord:
    """A clause record that differs from its pair partner only in text, so only the edit is judged."""
    return ClauseRecord(
        record_id=f"{pair.pair_id}:{side}", document_id=pair.base.document_id, version_id=side, ordinal=0,
        quote=text, statement=text, audiences=[Audience(pair.role)], audience_source="inherited",
        location=SourceLocation(kind="text", block_index=0), content_hash=f"{pair.pair_id}:{side}",
    )


def _group(results: list[ChangePairResult], key: str) -> dict[str, GroupScore]:
    groups: dict[str, GroupScore] = {}
    for r in results:
        g = groups.setdefault(getattr(r, key), GroupScore(pairs=0, correct=0))
        g.pairs += 1
        g.correct += r.predicted == r.expected
    return dict(sorted(groups.items()))


def score_change_pairs(pairs: list[GoldChangePair], judge: ChangeJudge, settings: Settings) -> ChangePairScore:
    """Decide each typed edit exactly as the matcher does (`matching.decide_pair`: identical text, context
    guard, change judge, evidence check) and score the resulting handling.

    This judges how an edit is classified once the two versions are correctly paired. It skips candidate
    search and one-to-one assignment, so a large rewrite that a full run would split into removed + added
    (or needs_review) still counts here as a paired edit; the v1 -> v2 diff score covers pairing.
    """
    if not pairs:
        raise ValueError("no change pairs to score")
    results = []
    for p in pairs:
        d = decide_pair(_pair_record(p.before, p, "before"), _pair_record(p.after, p, "after"), judge, settings)
        results.append(ChangePairResult(pair_id=p.pair_id, change_type=p.change_type, language=p.language,
                                        expected=p.expected_handling, predicted=predicted_handling(d),
                                        reasons=d.reasons, review_reason=d.review_reason))
    material = [r for r, p in zip(results, pairs, strict=True) if p.material]
    caught = sum(1 for r in material if r.predicted == "regenerate_and_reassess")
    false_material = sum(1 for r, p in zip(results, pairs, strict=True)
                         if not p.material and r.predicted == "regenerate_and_reassess")
    wrong = [r for r in results if r.predicted != r.expected]
    return ChangePairScore(
        judge=judge.name, pairs=len(results), correct=len(results) - len(wrong), accuracy=(len(results) - len(wrong)) / len(results),
        material_pairs=len(material), material_caught=caught,
        material_recall=caught / len(material) if material else None, false_material=false_material,
        needs_review=sum(1 for r in results if r.predicted == "needs_review"),
        by_change_type=_group(results, "change_type"), by_language=_group(results, "language"), wrong=wrong,
    )


def score_gates(gold: list[GoldGate], decisions: list[GateDecisionRecord]) -> GateScore:
    """Score a gate's decisions against the gold claims; each gold claim needs exactly one decision. Pure."""
    by_id: dict[str, GateDecisionRecord] = {}
    for d in decisions:
        if d.gate_id in by_id:
            raise ValueError(f"gate decisions: {d.gate_id} is decided more than once")
        by_id[d.gate_id] = d
    gold_ids = {g.gate_id for g in gold}
    missing = sorted(gold_ids - by_id.keys())
    unknown = sorted(by_id.keys() - gold_ids)
    if missing or unknown:
        raise ValueError(f"gate decisions do not match the gold claims: missing {missing}, unknown {unknown}")
    results = [GateResult(gate_id=g.gate_id, expected=g.expected_decision, predicted=by_id[g.gate_id].decision,
                          expected_reason=g.reason_code, predicted_reason=by_id[g.gate_id].reason_code) for g in gold]
    wrong = [r for r in results if r.predicted != r.expected]
    return GateScore(
        gates=len(results), correct=len(results) - len(wrong), accuracy=(len(results) - len(wrong)) / len(results),
        must_block=sum(1 for r in results if r.expected == "block_publication"),
        unsafe_allows=sum(1 for r in wrong if r.expected == "block_publication"),
        wrongly_blocked=sum(1 for r in wrong if r.expected == "allow_trainer_review"),
        reason_agreement=sum(1 for r in results if r.predicted_reason == r.expected_reason), wrong=wrong,
    )


def load_gate_decisions(path: Path) -> list[GateDecisionRecord]:
    """Read a gate implementation's decisions file: a JSON list of {gate_id, decision, reason_code}."""
    data = _load_json(path)
    if not isinstance(data, list):
        raise ValueError(f"{path}: expected a JSON list of gate decisions, got {type(data).__name__}")
    records = []
    for i, x in enumerate(data):
        try:
            records.append(GateDecisionRecord.model_validate(x))
        except ValidationError as e:
            raise ValueError(f"{path} [{i}]: invalid gate decision: {e}") from e
    return records


def gate_eval_for(gates: list[GoldGate], decisions_file: Path | None) -> GateEval:
    """Score a decisions file against the gold claims, or report the gates as not scored. Errors name the file."""
    if decisions_file is None:
        return GateEval(status="not_scored", reason=GATES_NOT_SCORED, gates=len(gates), score=None)
    decisions = load_gate_decisions(decisions_file)
    try:
        score = score_gates(gates, decisions)
    except ValueError as e:
        raise ValueError(f"{decisions_file}: {e}") from e
    return GateEval(status="scored", reason=None, gates=len(gates), score=score)


def skip_reason(doc: ManifestDocument, dataset_dir: Path, ocr_engine: OcrEngine) -> str | None:
    """Why docproc cannot score this upload in an eval run, or None. Pure apart from reading the suffix.

    Scans are scored only with a live OCR engine (`ovis`); `json_import` has no per-run JSON here.
    """
    if doc.variant == "scan" and ocr_engine != "ovis":
        return f"scan: needs a live OCR engine (DOCPROC_OCR=ovis on a GPU machine); this run's OCR is {ocr_engine}"
    try:
        detect_format(dataset_dir / doc.path)
    except ValueError as e:
        return str(e)
    return None


def ingest_key(doc: ManifestDocument) -> str:
    """docproc document ID for an upload: a scan shares family and version with its original, so it gets its own."""
    return f"{doc.document_family}-scan" if doc.variant == "scan" else doc.document_family


def _load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def run_eval(app: App, dataset_dir: Path, work_dir: Path, gate_decisions: Path | None = None) -> EvalReport:
    """Ingest every scorable dev upload as `<family>/v<version>` (scans as `<family>-scan`), compare v2 with v1, and
    score extraction and the diffs; then score docproc's matcher on the change pairs and a gate's decisions.

    The gold and the gate decisions file are read and checked first, so a bad file fails before a long run.
    """
    gold_dir = dataset_dir / SPLIT / "gold"
    pairs = [GoldChangePair.model_validate(x) for x in _load_json(gold_dir / "change_pairs.json")]
    gates = [GoldGate.model_validate(x) for x in _load_json(gold_dir / "publication_gates.json")]
    gate_eval = gate_eval_for(gates, gate_decisions)
    manifest = Manifest.model_validate(_load_json(dataset_dir / "manifest.json"))
    gold_docs = {g.document_id: g for g in
                 (GoldDocument.model_validate(x) for x in _load_json(dataset_dir / SPLIT / "gold" / "extraction.json"))}
    gold_diffs = [GoldDiff.model_validate(x) for x in _load_json(dataset_dir / SPLIT / "gold" / "version_diffs.json")]
    docs = sorted((d for d in manifest.documents if d.split == SPLIT), key=lambda d: (d.document_family, d.version))

    skipped: list[SkippedDocument] = []
    extraction: list[ExtractionScore] = []
    ingested: set[str] = set()
    for doc in docs:
        reason = skip_reason(doc, dataset_dir, app.settings.ocr)
        if reason is not None:
            skipped.append(SkippedDocument(document_id=doc.document_id, reason=reason))
            continue
        key, version_id = ingest_key(doc), f"v{doc.version}"
        app.ingest(dataset_dir / doc.path, key, version_id, work_dir=work_dir)
        info = app.repo.get_version(key, version_id)
        if info is None:
            raise RuntimeError(f"docproc stored no version for {doc.document_id} ({key} {version_id})")
        if doc.version == 1:
            app.compare(key, version_id)
        records = app.repo.get_records(key, version_id)
        extraction.append(score_extraction(gold_docs[doc.document_id], records, [i.kind for i in info.issues],
                                           sum(1 for i in info.issues if i.blocking)))
        ingested.add(doc.document_id)

    by_id = {d.document_id: d for d in docs}
    diffs: list[DiffScore] = []
    for gold in gold_diffs:
        if gold.from_document_id not in ingested or gold.to_document_id not in ingested:
            continue
        after = by_id[gold.to_document_id]
        report = app.compare(ingest_key(after), f"v{after.version}")
        diffs.append(score_diff(gold, gold_docs[gold.from_document_id], gold_docs[gold.to_document_id], report))

    if not extraction:
        raise RuntimeError(f"no {SPLIT} upload could be scored; skipped: {[s.model_dump() for s in skipped]}")
    total_diff_clauses = sum(d.clauses for d in diffs)
    return EvalReport(
        split=SPLIT, llm=app.settings.llm, llm_model=app.settings.llm_model, embedding_model=app.embedder.model_id,
        coverage_threshold=COVERAGE_THRESHOLD, extraction=extraction, diffs=diffs, skipped=skipped,
        macro_recall=sum(e.recall for e in extraction) / len(extraction),
        macro_precision=sum(e.precision for e in extraction) / len(extraction),
        diff_accuracy=sum(d.correct for d in diffs) / total_diff_clauses if total_diff_clauses else 0.0,
        change_pairs=score_change_pairs(pairs, app.change_judge, app.settings), publication_gates=gate_eval,
    )
