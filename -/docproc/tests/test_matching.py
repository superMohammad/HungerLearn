"""Unit tests of the matching rules with hand-made records and controlled embeddings."""
import numpy as np

from docproc.config import Settings
from docproc.llm.fixture import FixtureJudge
from docproc.matching import match_versions
from docproc.models import ChangeVerdict, ClauseRecord, SourceLocation, Status
from docproc.normalize import content_hash

S = Settings(_env_file=None)
JUDGE = FixtureJudge()


def rec(ver, ordinal, quote, heading="H", number=None, page=1, aud=("employee",), sid=None):
    return ClauseRecord(
        record_id=f"{ver}-{ordinal}", document_id="d", version_id=ver, ordinal=ordinal, stable_id=sid,
        quote=quote, statement=quote, audiences=list(aud), audience_source="explicit", clause_number=number,
        heading=heading, location=SourceLocation(kind="pdf_page", page=page, block_index=ordinal, heading_path=[heading]),
        content_hash=content_hash(quote, aud, heading),
    )


def same_vectors(*records):
    v = np.ones(8, dtype=np.float32) / np.sqrt(8)
    return {r.content_hash: v for r in records}  # cosine = 1.0 for every pair


def test_deadline_change_is_changed_even_with_identical_embeddings():
    o = rec("v1", 0, "Employees must submit claims within 30 days.", sid="S1")
    n = rec("v2", 0, "Employees must submit claims within 15 days.")
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, JUDGE)
    assert r.status == Status.changed and r.stable_id == "S1" and r.cosine == 1.0
    assert r.reasons[0] == "threshold: 30 -> 15"


def test_audience_change_is_changed():
    o = rec("v1", 0, "Staff must complete training.", aud=("employee",), sid="S1")
    n = rec("v2", 0, "Staff must complete training.", aud=("employee", "partner"))
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, JUDGE)
    assert r.status == Status.changed and any(x.startswith("audience") for x in r.reasons)


def test_high_cosine_but_unrelated_text_is_not_matched():
    o = rec("v1", 0, "Owners may approve remote work.", sid="S1")
    n = rec("v2", 0, "Partners must encrypt laptops and rotate passwords quarterly.")
    rs = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, JUDGE)
    assert sorted(r.status for r in rs) == [Status.added, Status.removed]


def test_duplicate_text_moved_is_needs_review():
    o1 = rec("v1", 0, "Lock your screen.", heading="A", sid="S1")
    o2 = rec("v1", 1, "Lock your screen.", heading="B", sid="S2")
    n1 = rec("v2", 0, "Lock your screen.", heading="C")
    n2 = rec("v2", 1, "Lock your screen.", heading="D")
    rs = match_versions("d", "v2", [o1, o2], [n1, n2], same_vectors(o1), S, JUDGE)
    assert [r.status for r in rs] == [Status.needs_review, Status.needs_review]
    assert all(r.candidates == ["S1", "S2"] and r.stable_id is None for r in rs)


def test_duplicate_text_in_place_is_unchanged():
    o1 = rec("v1", 0, "Lock your screen.", heading="A", sid="S1")
    o2 = rec("v1", 1, "Lock your screen.", heading="B", sid="S2")
    n1 = rec("v2", 0, "Lock your screen.", heading="A")
    n2 = rec("v2", 1, "Lock your screen.", heading="B")
    rs = match_versions("d", "v2", [o1, o2], [n1, n2], same_vectors(o1), S, JUDGE)
    assert [(r.status, r.stable_id) for r in rs] == [(Status.unchanged, "S1"), (Status.unchanged, "S2")]


def test_competing_candidates_are_needs_review():
    o1 = rec("v1", 0, "Employees must submit claims within 30 days.", sid="S1")
    o2 = rec("v1", 1, "Employees must submit claims within 60 days.", sid="S2")
    n = rec("v2", 0, "Employees must submit claims within 45 days.")
    rs = match_versions("d", "v2", [o1, o2], [n], same_vectors(o1, o2, n), S, JUDGE)
    review = [r for r in rs if r.status == Status.needs_review]
    assert len(review) == 1 and review[0].candidates == ["S1", "S2"]
    assert not any(r.status == Status.removed for r in rs), "competing candidates are not removals"


def test_one_to_one():
    o = rec("v1", 0, "Employees must submit claims within 30 days.", number="1.2", sid="S1")
    n1 = rec("v2", 0, "Employees must submit claims within 15 days.", number="1.2")
    n2 = rec("v2", 1, "Employees must submit claims within 15 working days.", number="3.1")
    rs = match_versions("d", "v2", [o], [n1, n2], same_vectors(o, n1, n2), S, JUDGE)
    st = {r.new.record_id: (r.status, r.stable_id) for r in rs if r.new}
    assert st["v2-0"] == (Status.changed, "S1")
    assert st["v2-1"][0] == Status.added and st["v2-1"][1] != "S1"


def test_audience_label_drift_on_identical_text_is_not_a_change():
    from docproc.matching import change_reasons, status_for

    old = rec("v1", 0, "Do not leave the branch before dispatch says so.", aud=("courier",)).model_copy(
        update={"audience_source": "unspecified"})
    new = rec("v2", 0, "Do not leave the branch before dispatch says so.", aud=("employee",))
    assert status_for(change_reasons(old, new)) is Status.unchanged
    # Both sides name the audience in the text: that is a real change.
    explicit_old = old.model_copy(update={"audience_source": "explicit"})
    assert status_for(change_reasons(explicit_old, new)) is Status.changed


class ScriptedJudge:
    """Returns a fixed verdict and records every pair it was asked about."""

    name = "scripted"
    max_output_tokens = 512

    def __init__(self, kind: str, old_evidence: str = "", new_evidence: str = ""):
        self.verdict = ChangeVerdict(kind=kind, old_evidence=old_evidence, new_evidence=new_evidence,
                                     explanation="scripted")
        self.calls: list[tuple[str, str]] = []

    def judge(self, old: ClauseRecord, new: ClauseRecord) -> ChangeVerdict:
        self.calls.append((old.quote, new.quote))
        return self.verdict


def _actor_pair():
    o = rec("v1", 0, "The courier calls the customer before leaving.", sid="S1")
    n = rec("v2", 0, "The dispatcher calls the customer before leaving.")
    return o, n


def test_the_judge_decides_a_material_change_the_rules_cannot_see():
    o, n = _actor_pair()
    judge = ScriptedJudge("actor", "courier", "dispatcher")
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, judge)
    assert judge.calls == [(o.quote, n.quote)]
    assert r.status == Status.changed and r.stable_id == "S1"
    assert r.reasons == ["actor: courier -> dispatcher"]


def test_a_cosmetic_verdict_keeps_the_clause_unchanged():
    o = rec("v1", 0, "Call the customer.", sid="S1")
    n = rec("v2", 0, "Call the customer!")
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, ScriptedJudge("cosmetic"))
    assert r.status == Status.unchanged and r.stable_id == "S1"


def test_identical_text_never_reaches_the_judge():
    o = rec("v1", 0, "Staff must complete training.", aud=("employee",), sid="S1")
    n = rec("v2", 0, "Staff must complete training.", aud=("employee", "partner"))
    judge = ScriptedJudge("actor", "x", "y")
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, judge)
    assert judge.calls == []
    assert r.status == Status.changed and r.reasons == ["audience: employee -> employee, partner"]


def test_evidence_missing_from_the_clause_text_goes_to_review():
    o, n = _actor_pair()
    judge = ScriptedJudge("actor", "courier", "supervisor")  # "supervisor" is not in the new quote
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, judge)
    assert r.status == Status.needs_review and r.stable_id == "S1"
    assert "evidence" in (r.review_reason or "") and "supervisor" in (r.review_reason or "")


def test_a_pair_too_long_for_the_context_window_goes_to_review_without_a_call():
    o, n = _actor_pair()
    judge = ScriptedJudge("actor", "courier", "dispatcher")
    tiny = S.model_copy(update={"llm_context_tokens": 600})
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), tiny, judge)
    assert judge.calls == []
    assert r.status == Status.needs_review and "context" in (r.review_reason or "")
    assert "600" in (r.review_reason or "")


def test_a_kept_verdict_on_a_changed_number_or_prohibition_goes_to_review():
    for kind, old_q, new_q in (("none", "Wait 15 minutes, then call.", "Wait 10 minutes, then call."),
                               ("cosmetic", "انتظر ١٥ دقيقة ثم اتصل.", "انتظر 10 دقائق ثم اتصل."),
                               ("none", "Do not cancel the order.", "Cancel the order.")):
        o, n = rec("v1", 0, old_q, sid="S1"), rec("v2", 0, new_q)
        [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, ScriptedJudge(kind))
        assert r.status == Status.needs_review and r.stable_id == "S1"
        assert kind in (r.review_reason or "")


def test_a_wording_verdict_on_a_changed_number_or_prohibition_goes_to_review():
    # "wording" also claims the meaning is the same (text refresh only), so it gets the same check as a kept verdict.
    for old_q, new_q in (("Wait 15 minutes, then call the dispatcher.", "Wait 10 minutes, then call the dispatcher."),
                         ("انتظر ١٥ دقيقة ثم اتصل بمركز التوزيع.", "انتظر 10 دقائق ثم اتصل بمركز التوزيع."),
                         ("لا تلغِ الطلب قبل الاتصال بالعميل.", "ألغِ الطلب قبل الاتصال بالعميل.")):
        o, n = rec("v1", 0, old_q, sid="S1"), rec("v2", 0, new_q)
        [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, ScriptedJudge("wording"))
        assert r.status == Status.needs_review and r.stable_id == "S1", (old_q, r)
        assert "wording" in (r.review_reason or "")


def test_a_wording_verdict_with_the_same_numbers_and_prohibitions_is_a_text_change():
    o = rec("v1", 0, "Do not leave before 10 minutes; call the dispatcher.", sid="S1")
    n = rec("v2", 0, "Do not leave before 10 minutes; phone the dispatcher.")
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, ScriptedJudge("wording", "call", "phone"))
    assert r.status == Status.changed and r.stable_id == "S1"
    assert r.reasons == ["wording: call -> phone"]


def test_a_material_verdict_needs_evidence_that_actually_differs():
    o, n = _actor_pair()
    for judge in (ScriptedJudge("actor"),                               # no evidence at all
                  ScriptedJudge("actor", "calls the customer", "calls")):  # words present in both clauses
        [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, judge)
        assert r.status == Status.needs_review and "evidence" in (r.review_reason or "")
    # step order: the same words in a new order are legitimate evidence-free changes
    o2 = rec("v1", 0, "Seal the bag, then label it.", sid="S1")
    n2 = rec("v2", 0, "Label the bag, then seal it.")
    [r] = match_versions("d", "v2", [o2], [n2], same_vectors(o2, n2), S, ScriptedJudge("order"))
    assert r.status == Status.changed and r.reasons == ["order: - -> -"]


def test_an_explicit_audience_change_is_kept_when_the_text_also_changed():
    o = rec("v1", 0, "Staff must complete the training this week.", aud=("employee",), sid="S1")
    n = rec("v2", 0, "Staff must complete the training this week!", aud=("employee", "partner"))
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, ScriptedJudge("cosmetic"))
    assert r.status == Status.changed and r.reasons == ["audience: employee -> employee, partner"]


class FailingJudge:
    name = "failing"
    max_output_tokens = 512

    def judge(self, old, new):
        raise RuntimeError("change judge (gemma4) failed after 3 attempts: request failed: timed out")


def test_a_failed_judge_call_sends_only_that_pair_to_review():
    o, n = _actor_pair()
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S, FailingJudge())
    assert r.status == Status.needs_review and r.stable_id == "S1"
    assert "timed out" in (r.review_reason or "")


def test_the_context_guard_reserves_the_judge_s_own_answer_budget():
    o, n = _actor_pair()
    big = ScriptedJudge("actor", "courier", "dispatcher")
    big.max_output_tokens = 4096
    small = S.model_copy(update={"llm_context_tokens": 4096})  # a teammate's smaller server
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), small, big)  # no room for 4096 out
    assert big.calls == [] and r.status == Status.needs_review and "4096" in (r.review_reason or "")
