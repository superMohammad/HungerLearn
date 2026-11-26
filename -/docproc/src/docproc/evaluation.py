"""Score stage 1 (clause extraction) and stage 6 (v1 -> v2 comparison) on the synthetic dev split.

Reads `data/synthetic_sops/manifest.json` and `dev/gold/{extraction,version_diffs}.json`, runs the
configured pipeline on a fresh SQLite database, and matches the output against the gold labels by
word coverage of the source quotes. `held_out/` is never read: held-out evaluation needs a frozen
configuration and is a separate, deliberate run.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from docproc.config import OcrEngine
from docproc.loaders import detect_format
from docproc.models import ClauseChange, ClauseRecord, ComparisonReport, Status
from docproc.normalize import clause_body, words
from docproc.pipeline import App

DATASET_DIR = Path(__file__).resolve().parents[4] / "data" / "synthetic_sops"
SPLIT = "dev"
# A gold clause counts as found when one output quote covers this share of its words (and vice versa).
COVERAGE_THRESHOLD = 0.8

GoldChange = Literal["added", "changed", "removed", "unchanged"]


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


def run_eval(app: App, dataset_dir: Path, work_dir: Path) -> EvalReport:
    """Ingest every scorable dev upload as `<family>/v<version>` (scans as `<family>-scan`), compare v2 with v1, and score both stages."""
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
    )
