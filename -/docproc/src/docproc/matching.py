"""Version-matching rules. Pure Python, shared by every storage backend.

Stages (each is one LangGraph node in graphs/compare.py):
 1. exact content hash (normalized quote + audiences)  -> unchanged / moved
 2. candidates from clause number, heading, BGE-M3 cosine
 3. verification on the *actual text* and audience     -> same identity or reject
 4. one-to-one assignment; near-ties                   -> needs_review; the change judge (an LLM, or the
    rule-based FixtureJudge offline) decides whether each assigned pair changed (`decide_pair`)
 5. leftovers                                          -> added / removed (deferred if incomplete)
Embedding similarity alone never decides "unchanged": 30 -> 15 days is high-cosine but its
hash differs, so it can only ever be `changed`.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
from rapidfuzz import fuzz

from docproc.config import Settings
from docproc.llm.base import ChangeJudge, estimate_change_tokens
from docproc.models import Audience, ChangeVerdict, ClauseRecord, Status
from docproc.normalize import (
    clause_body,
    core_text,
    is_title_label,
    modalities,
    negations,
    normalize,
    numbers,
    title_of,
    words,
)

ID_NAMESPACE = uuid.UUID("6f1c2a52-9a43-4c1e-9d55-0d0c5e2b7a10")
REMOVAL_DEFERRED = "removal_deferred_incomplete_extraction"
_ORDER = {Status.unchanged: 0, Status.moved: 1, Status.changed: 2, Status.added: 3, Status.removed: 4, Status.needs_review: 5}


def new_stable_id(document_id: str, version_id: str, content_hash: str, ordinal: int) -> str:
    """Deterministic so re-running the same version yields the same IDs."""
    return str(uuid.uuid5(ID_NAMESPACE, f"{document_id}|{version_id}|{content_hash}|{ordinal}"))


@dataclass
class MatchResult:
    status: Status
    stable_id: str | None
    old: ClauseRecord | None = None
    new: ClauseRecord | None = None
    reasons: list[str] = field(default_factory=list)
    review_reason: str | None = None
    candidates: list[str] = field(default_factory=list)
    cosine: float | None = None
    lexical: float | None = None


@dataclass
class Candidate:
    old: ClauseRecord
    new: ClauseRecord
    cosine: float
    same_number: bool
    same_heading: bool
    lexical: float | None = None
    score: float = 0.0


def lexical_similarity(a: str, b: str) -> float:
    na, nb = core_text(a, None), core_text(b, None)
    return max(fuzz.ratio(na, nb), fuzz.token_sort_ratio(na, nb)) / 100.0


CONTENT_REASONS = ("numbers", "negation", "modality", "audience", "wording")

# Change judge kinds (models.ChangeKind): which ones keep a clause, and which change what the rule requires.
KEPT_KINDS = ("none", "cosmetic")
MATERIAL_KINDS = ("threshold", "negation", "modality", "actor", "condition", "order", "audience")


@dataclass
class PairDecision:
    status: Status
    reasons: list[str]
    review_reason: str | None = None


def evidence_problem(verdict: ChangeVerdict, old: ClauseRecord, new: ClauseRecord) -> str | None:
    """The judge's evidence must be words of the clause it cites (LLM output is untrusted). Pure."""
    for side, evidence, rec in (("old", verdict.old_evidence, old), ("new", verdict.new_evidence, new)):
        missing = [w for w in words(evidence) if w not in set(words(rec.quote))]
        if missing:
            return f"change judge evidence not found in the {side} clause text: {missing} (kind {verdict.kind})"
    return None


def decide_pair(old: ClauseRecord, new: ClauseRecord, judge: ChangeJudge, settings: Settings) -> PairDecision:
    """Status and reasons for a verified pair. The change judge decides; identical text never reaches it.

    Only a pair whose rule text differs is sent, and only if it fits the model's context window: a pair that
    would not fit is sent to review instead of being truncated by the server.
    """
    location = ["location changed"] if old.location.position_key() != new.location.position_key() else []
    if _body(old) == _body(new) or same_but_title(old, new):
        reasons = change_reasons(old, new)  # same text: only an explicit audience or the location can differ
        return PairDecision(status_for(reasons), reasons)
    need = estimate_change_tokens(old, new) + settings.change_max_output_tokens
    if need > settings.llm_context_tokens:
        return PairDecision(Status.needs_review, location, review_reason=(
            f"clause pair (~{need} tokens incl. {settings.change_max_output_tokens} for the answer) does not fit "
            f"the model context ({settings.llm_context_tokens}); raise DOCPROC_LLM_CONTEXT_TOKENS if the server allows"))
    verdict = judge.judge(old, new)
    problem = evidence_problem(verdict, old, new)
    if problem:
        return PairDecision(Status.needs_review, location, review_reason=problem)
    if verdict.kind in KEPT_KINDS:
        return PairDecision(Status.moved if location else Status.unchanged, location)
    return PairDecision(Status.changed,
                        [f"{verdict.kind}: {verdict.old_evidence or '-'} -> {verdict.new_evidence or '-'}", *location])


def _body(r: ClauseRecord) -> str:
    """Normalized clause text without clause number or a leading copy of its heading."""
    return core_text(r.quote, r.heading)


def same_but_title(old: ClauseRecord, new: ClauseRecord) -> bool:
    """True if one version's text is the other's plus a leading label that the other shows as its title.

    PDF text layers put a procedure's title on the rule line ("1. Open the delay case When ..."), and
    Word list numbering is not in the DOCX text ("عند الوصول" vs "١. عند الوصول"). The label counts as
    layout only with evidence: it equals the other record's title line or heading. A bare leading
    condition or role ("Before leaving ...", "Supervisors ...") has no such evidence and stays content.
    """
    a, b = _body(old), _body(new)
    if a == b:
        return False
    (longer, short_rec), shorter = ((a, new), b) if len(a) > len(b) else ((b, old), a)
    if not shorter or not longer.endswith(" " + shorter):
        return False
    label = longer[: -len(shorter)].strip()
    evidence = {title_of(short_rec.quote), normalize(clause_body(short_rec.heading or "")).strip() or None}
    return is_title_label(label) and label in evidence


def status_for(reasons: list[str]) -> Status:
    """A verified pair is `changed` only if its content differs; otherwise layout moved it."""
    if any(r.startswith(CONTENT_REASONS) for r in reasons):
        return Status.changed
    return Status.moved if "location changed" in reasons else Status.unchanged


def change_reasons(old: ClauseRecord, new: ClauseRecord) -> list[str]:
    reasons = []
    no, nn = numbers(old.quote), numbers(new.quote)
    if no != nn:
        reasons.append(f"numbers: {', '.join(no) or '-'} -> {', '.join(nn) or '-'}")
    if negations(old.quote) != negations(new.quote):
        reasons.append("negation changed")
    mo, mn = modalities(old.quote), modalities(new.quote)
    if mo != mn:
        reasons.append(f"modality: {', '.join(mo) or '-'} -> {', '.join(mn) or '-'}")
    ao, an = sorted(a.value for a in old.audiences), sorted(a.value for a in new.audiences)
    # Only audiences the text itself names are evidence of a change; an inherited or unspecified
    # audience is an extraction label, and label drift on identical text is not a policy change.
    if ao != an and old.audience_source == "explicit" and new.audience_source == "explicit":
        reasons.append(f"audience: {', '.join(ao)} -> {', '.join(an)}")
    if _body(old) != _body(new) and not same_but_title(old, new) and not any(r.startswith(("numbers", "negation", "modality")) for r in reasons):
        reasons.append("wording changed")
    if old.location.position_key() != new.location.position_key():
        reasons.append("location changed")
    return reasons


def _same_number(a: ClauseRecord, b: ClauseRecord) -> bool:
    return bool(a.clause_number and b.clause_number and normalize(a.clause_number) == normalize(b.clause_number))


def _same_heading(a: ClauseRecord, b: ClauseRecord) -> bool:
    return bool(a.heading and b.heading and normalize(a.heading) == normalize(b.heading))


class Matcher:
    """Holds matching state between stages. Identity decisions are deterministic; whether a verified pair
    changed (and how) is the change judge's verdict, checked against the clause text."""

    def __init__(self, document_id: str, new_version_id: str, old: list[ClauseRecord], new: list[ClauseRecord],
                 settings: Settings, judge: ChangeJudge):
        self.document_id, self.new_version_id = document_id, new_version_id
        self.old, self.new, self.s, self.judge = old, new, settings, judge
        self.results: list[MatchResult] = []
        self.used_old: set[str] = set()
        self.used_new: set[str] = set()
        self.reserved_old: set[str] = set()  # old clauses tied up in a needs_review decision
        self.candidates: list[Candidate] = []
        self.verified: list[Candidate] = []

    def sid_for(self, o: ClauseRecord) -> str:
        return o.stable_id or new_stable_id(self.document_id, o.version_id, o.content_hash, o.ordinal)

    def unmatched_old(self) -> list[ClauseRecord]:
        return [o for o in self.old if o.record_id not in self.used_old and o.record_id not in self.reserved_old]

    def unmatched_new(self) -> list[ClauseRecord]:
        return [n for n in self.new if n.record_id not in self.used_new]

    def _take(self, r: MatchResult) -> None:
        self.results.append(r)
        if r.old:
            self.used_old.add(r.old.record_id)
        if r.new:
            self.used_new.add(r.new.record_id)

    # ---- stage 1 ------------------------------------------------------------------------
    def exact_hash(self) -> None:
        by_old: dict[str, list[ClauseRecord]] = defaultdict(list)
        by_new: dict[str, list[ClauseRecord]] = defaultdict(list)
        for r in self.old:
            by_old[r.content_hash].append(r)
        for r in self.new:
            by_new[r.content_hash].append(r)
        for h, news in by_new.items():
            olds = list(by_old.get(h, []))
            if not olds:
                continue
            news = list(news)
            # identical text at the identical position pairs unambiguously, even if duplicated
            for n in list(news):
                same_pos = [o for o in olds if o.location.position_key() == n.location.position_key()]
                if same_pos:
                    o = same_pos[0]
                    self._take(MatchResult(Status.unchanged, self.sid_for(o), o, n, cosine=1.0, lexical=1.0))
                    olds.remove(o)
                    news.remove(n)
            if len(olds) == 1 and len(news) == 1:
                o, n = olds[0], news[0]
                self._take(MatchResult(Status.moved, self.sid_for(o), o, n, reasons=["location changed"], cosine=1.0, lexical=1.0))
            elif olds and news:
                for n in news:
                    self._take(MatchResult(
                        Status.needs_review, None, None, n,
                        review_reason="duplicate text: identical clauses moved, identity unclear",
                        candidates=sorted(self.sid_for(o) for o in olds), cosine=1.0, lexical=1.0,
                    ))
                self.reserved_old.update(o.record_id for o in olds)

    # ---- stage 2 ------------------------------------------------------------------------
    def generate_candidates(self, vectors: dict[str, np.ndarray]) -> None:
        self.candidates = []
        olds = self.unmatched_old()
        for n in self.unmatched_new():
            vn = vectors.get(n.content_hash)
            found = []
            for o in olds:
                vo = vectors.get(o.content_hash)
                cos = float(np.dot(vn, vo)) if vn is not None and vo is not None else 0.0
                num, head = _same_number(o, n), _same_heading(o, n)
                if num or cos >= self.s.cosine_candidate or (head and cos >= self.s.cosine_candidate - 0.1):
                    found.append(Candidate(o, n, cos, num, head))
            found.sort(key=lambda c: (-(c.cosine + (0.2 if c.same_number else 0)), c.old.ordinal))
            self.candidates.extend(found[: self.s.top_k])

    # ---- stage 3 ------------------------------------------------------------------------
    def verify(self) -> None:
        """Compare the actual text and audience before accepting a candidate identity."""
        self.verified = []
        for c in self.candidates:
            c.lexical = lexical_similarity(c.old.quote, c.new.quote)
            if c.same_number:
                ok = c.lexical >= self.s.anchored_lexical_min
            else:
                ok = c.lexical >= self.s.lexical_same_identity and c.cosine >= self.s.cosine_candidate - (0.1 if c.same_heading else 0.0)
            if ok:
                c.score = 0.5 * c.cosine + 0.4 * c.lexical + (0.1 if c.same_number else 0.0) + (0.05 if c.same_heading else 0.0)
                self.verified.append(c)

    # ---- stage 4 ------------------------------------------------------------------------
    def assign(self) -> None:
        pairs = sorted(self.verified, key=lambda p: (-p.score, p.new.ordinal, p.old.ordinal))

        def free(q: Candidate) -> bool:
            return (q.old.record_id not in self.used_old and q.old.record_id not in self.reserved_old
                    and q.new.record_id not in self.used_new)

        for p in pairs:
            if not free(p):
                continue
            rivals = [q for q in pairs if q is not p and free(q)
                      and (q.new.record_id == p.new.record_id or q.old.record_id == p.old.record_id)]
            close = [q for q in rivals if p.score - q.score < self.s.ambiguity_margin]
            if close:
                same_new = [q for q in close if q.new.record_id == p.new.record_id]
                self._take(MatchResult(
                    Status.needs_review, None, None, p.new,
                    review_reason="competing matches with near-equal scores",
                    candidates=sorted({self.sid_for(p.old)} | {self.sid_for(q.old) for q in same_new}),
                    cosine=round(p.cosine, 4), lexical=round(p.lexical or 0, 4),
                ))
                self.reserved_old.add(p.old.record_id)
                self.reserved_old.update(q.old.record_id for q in same_new)
                continue
            d = decide_pair(p.old, p.new, self.judge, self.s)
            self._take(MatchResult(
                d.status, self.sid_for(p.old), p.old, p.new, reasons=d.reasons, review_reason=d.review_reason,
                cosine=round(p.cosine, 4), lexical=round(p.lexical or 0, 4),
            ))

    # ---- stage 5 ------------------------------------------------------------------------
    def finalize(self, complete: bool) -> list[MatchResult]:
        for n in self.unmatched_new():
            self._take(MatchResult(Status.added, new_stable_id(self.document_id, self.new_version_id, n.content_hash, n.ordinal), None, n))
        for o in self.unmatched_old():
            if complete:
                self._take(MatchResult(Status.removed, self.sid_for(o), o, None))
            else:
                self._take(MatchResult(
                    Status.needs_review, self.sid_for(o), o, None, review_reason=REMOVAL_DEFERRED,
                    reasons=["not found in the new version, but the new version has failed pages or extractions"],
                ))
        self.results.sort(key=lambda r: (_ORDER[r.status], (r.new or r.old).ordinal))  # type: ignore[union-attr]
        return self.results


def match_versions(document_id, new_version_id, old, new, vectors, settings, judge, complete=True) -> list[MatchResult]:
    m = Matcher(document_id, new_version_id, old, new, settings, judge)
    m.exact_hash()
    m.generate_candidates(vectors)
    m.verify()
    m.assign()
    return m.finalize(complete)


def affected_audiences(r: MatchResult) -> list[Audience]:
    s: set[Audience] = set()
    for rec in (r.old, r.new):
        if rec:
            s.update(rec.audiences)
    if len(s) > 1:
        s.discard(Audience.unspecified)
    return sorted(s, key=lambda a: a.value)
