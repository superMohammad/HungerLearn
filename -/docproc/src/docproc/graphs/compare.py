"""Workflow 2 - compare the incoming version with the previous version of the same document."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import TypedDict

import numpy as np
from langgraph.graph import END, START, StateGraph

from docproc.config import Settings
from docproc.embeddings import Embedder
from docproc.llm.base import ChangeJudge
from docproc.matching import REMOVAL_DEFERRED, Matcher, MatchResult, affected_audiences
from docproc.models import (
    ClauseChange, ClauseRecord, ClauseSide, ComparisonReport, ExtractionIssue, RegenerationItem, Status,
)
from docproc.storage.base import SqlRepository


class CompareState(TypedDict, total=False):
    document_id: str
    version_id: str
    old_version_id: str | None
    old_records: list[ClauseRecord]
    new_records: list[ClauseRecord]
    complete: bool
    new_complete: bool
    incomplete_reasons: list[str]
    issues: list[ExtractionIssue]
    vectors: dict[str, np.ndarray]
    links: dict[str, dict[str, list[str]]]
    results: list[MatchResult]
    report: ComparisonReport


@dataclass
class CompareDeps:
    repo: SqlRepository
    embedder: Embedder
    settings: Settings
    judge: ChangeJudge
    links: dict[str, dict[str, list[str]]] = field(default_factory=dict)


def build_compare_graph(deps: CompareDeps):
    s = deps.settings
    holder: dict[str, Matcher] = {}  # the Matcher object carries state between matching nodes

    def load_versions(state: CompareState) -> CompareState:
        doc, ver = state["document_id"], state["version_id"]
        info = deps.repo.get_version(doc, ver)
        if info is None:
            raise ValueError(f"version {ver} of {doc} has not been ingested")
        prev = deps.repo.previous_version(doc, ver)
        old = deps.repo.get_records(doc, prev) if prev else []
        new = deps.repo.get_records(doc, ver)
        reasons, issues = [], list(info.issues)
        if info.failed_pages:
            reasons.append(f"new version {ver}: OCR/text failed on pages {info.failed_pages}")
        if any(i.blocking and i.kind != "ocr_failed" for i in info.issues):
            reasons.append(f"new version {ver}: {sum(i.blocking and i.kind != 'ocr_failed' for i in info.issues)} invalid extraction(s)")
        new_complete = not reasons
        if prev:
            pinfo = deps.repo.get_version(doc, prev)
            if pinfo and not pinfo.complete:
                reasons.append(f"previous version {prev} was incomplete; some 'added' clauses may have existed before")
        holder["m"] = Matcher(doc, ver, old, new, s, deps.judge)
        return {"old_version_id": prev, "old_records": old, "new_records": new, "new_complete": new_complete,
                "complete": not reasons, "incomplete_reasons": reasons, "issues": issues}

    def exact_hash_match(state: CompareState) -> CompareState:
        holder["m"].exact_hash()
        return {}

    def embed_unmatched(state: CompareState) -> CompareState:
        """Reuse cached vectors by content hash; embed only what is missing, in small CPU batches."""
        m = holder["m"]
        need = {r.content_hash: r.quote for r in m.unmatched_old() + m.unmatched_new()}
        # exact matches reuse the old clause's embedding: make sure the hash has a vector stored
        need.update({r.new.content_hash: r.new.quote for r in m.results if r.new is not None})
        cached = deps.repo.get_embeddings(deps.embedder.model_id, list(need))
        missing = [h for h in need if h not in cached]
        if missing:
            vecs = deps.embedder.embed([need[h] for h in missing])
            fresh = {h: vecs[i] for i, h in enumerate(missing)}
            deps.repo.put_embeddings(deps.embedder.model_id, fresh)
            cached.update(fresh)
        return {"vectors": cached}

    def generate_candidates(state: CompareState) -> CompareState:
        holder["m"].generate_candidates(state.get("vectors", {}))
        return {}

    def verify_candidates(state: CompareState) -> CompareState:
        holder["m"].verify()
        return {}

    def assign_one_to_one(state: CompareState) -> CompareState:
        holder["m"].assign()
        return {}

    def apply_incompleteness(state: CompareState) -> CompareState:
        # Removals are deferred only when the *new* version may be missing text.
        return {"results": holder["m"].finalize(complete=state["new_complete"])}

    def persist_and_report(state: CompareState) -> CompareState:
        doc, ver = state["document_id"], state["version_id"]
        results = state["results"]
        register: dict[str, str] = {}        # stable_id -> first version
        backfill: dict[str, str] = {}        # old record without an ID -> its (new) stable_id
        assignments: dict[str, str | None] = {}
        removed_ids: list[str] = []
        for r in results:
            if r.status == Status.added and r.stable_id:
                register[r.stable_id] = ver
            if r.old is not None and r.old.stable_id is None and r.stable_id:
                register.setdefault(r.stable_id, r.old.version_id)
                backfill[r.old.record_id] = r.stable_id
            if r.new is not None:
                assignments[r.new.record_id] = r.stable_id  # None for unclear identity (needs_review)
            if r.status == Status.removed and r.stable_id:
                removed_ids.append(r.stable_id)
        deps.repo.register_clauses(doc, register)            # identities first (FK)
        deps.repo.set_record_stable_ids(backfill)
        deps.repo.assign_identities(doc, ver, assignments, removed_ids)

        if deps.links:
            deps.repo.set_links(deps.links)
        links = deps.repo.get_links([r.stable_id for r in results if r.stable_id] + [c for r in results for c in r.candidates])

        changes = [_to_change(r, links) for r in results]
        counts = Counter(c.status.value for c in changes)
        report = ComparisonReport(
            document_id=doc, old_version_id=state.get("old_version_id"), new_version_id=ver,
            complete=state["complete"], incomplete_reasons=state.get("incomplete_reasons", []),
            embedding_model=deps.embedder.model_id,
            summary={st.value: counts.get(st.value, 0) for st in Status},
            clauses=changes,
            lesson_regeneration=[
                RegenerationItem(stable_id=c.stable_id, status=c.status, affected_audiences=c.affected_audiences,
                                 lesson_ids=c.lesson_ids, badge_ids=c.badge_ids)
                for c in changes if c.status in (Status.changed, Status.added, Status.removed) and c.stable_id
            ],
            needs_review=[c for c in changes if c.status == Status.needs_review],
            issues=state.get("issues", []),
        )
        deps.repo.save_report(report)
        return {"report": report}

    g = StateGraph(CompareState)
    for name, fn in [
        ("load_versions", load_versions), ("exact_hash_match", exact_hash_match), ("embed_unmatched", embed_unmatched),
        ("generate_candidates", generate_candidates), ("verify_candidates", verify_candidates),
        ("assign_one_to_one", assign_one_to_one), ("apply_incompleteness", apply_incompleteness),
        ("persist_and_report", persist_and_report),
    ]:
        g.add_node(name, fn)
    g.add_edge(START, "load_versions")
    g.add_edge("load_versions", "exact_hash_match")
    g.add_edge("exact_hash_match", "embed_unmatched")
    g.add_edge("embed_unmatched", "generate_candidates")
    g.add_edge("generate_candidates", "verify_candidates")
    g.add_edge("verify_candidates", "assign_one_to_one")
    g.add_edge("assign_one_to_one", "apply_incompleteness")
    g.add_edge("apply_incompleteness", "persist_and_report")
    g.add_edge("persist_and_report", END)
    return g.compile()


def _side(r: ClauseRecord | None) -> ClauseSide | None:
    if r is None:
        return None
    return ClauseSide(
        record_id=r.record_id, quote=r.quote, statement=r.statement, steps=r.steps, audiences=r.audiences,
        audience_source=r.audience_source, audience_evidence=r.audience_evidence, clause_number=r.clause_number,
        heading=r.heading, location=r.location, content_hash=r.content_hash,
    )


def _to_change(r: MatchResult, links: dict[str, dict[str, list[str]]]) -> ClauseChange:
    ids = [r.stable_id] if r.stable_id else list(r.candidates)
    lessons = sorted({x for i in ids for x in links.get(i, {}).get("lesson_ids", [])})
    badges = sorted({x for i in ids for x in links.get(i, {}).get("badge_ids", [])})
    return ClauseChange(
        status=r.status, stable_id=r.stable_id, old=_side(r.old), new=_side(r.new),
        affected_audiences=affected_audiences(r), change_reasons=r.reasons, review_reason=r.review_reason,
        candidate_stable_ids=r.candidates, cosine=r.cosine, lexical=r.lexical, lesson_ids=lessons, badge_ids=badges,
    )


__all__ = ["build_compare_graph", "CompareDeps", "REMOVAL_DEFERRED"]
