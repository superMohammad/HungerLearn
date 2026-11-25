"""Unit tests of the matching rules with hand-made records and controlled embeddings."""
import numpy as np

from docproc.config import Settings
from docproc.matching import match_versions
from docproc.models import ClauseRecord, SourceLocation, Status
from docproc.normalize import content_hash

S = Settings(_env_file=None)


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
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S)
    assert r.status == Status.changed and r.stable_id == "S1" and r.cosine == 1.0
    assert r.reasons[0] == "numbers: 30 -> 15"


def test_audience_change_is_changed():
    o = rec("v1", 0, "Staff must complete training.", aud=("employee",), sid="S1")
    n = rec("v2", 0, "Staff must complete training.", aud=("employee", "partner"))
    [r] = match_versions("d", "v2", [o], [n], same_vectors(o, n), S)
    assert r.status == Status.changed and any(x.startswith("audience") for x in r.reasons)


def test_high_cosine_but_unrelated_text_is_not_matched():
    o = rec("v1", 0, "Owners may approve remote work.", sid="S1")
    n = rec("v2", 0, "Partners must encrypt laptops and rotate passwords quarterly.")
    rs = match_versions("d", "v2", [o], [n], same_vectors(o, n), S)
    assert sorted(r.status for r in rs) == [Status.added, Status.removed]


def test_duplicate_text_moved_is_needs_review():
    o1 = rec("v1", 0, "Lock your screen.", heading="A", sid="S1")
    o2 = rec("v1", 1, "Lock your screen.", heading="B", sid="S2")
    n1 = rec("v2", 0, "Lock your screen.", heading="C")
    n2 = rec("v2", 1, "Lock your screen.", heading="D")
    rs = match_versions("d", "v2", [o1, o2], [n1, n2], same_vectors(o1), S)
    assert [r.status for r in rs] == [Status.needs_review, Status.needs_review]
    assert all(r.candidates == ["S1", "S2"] and r.stable_id is None for r in rs)


def test_duplicate_text_in_place_is_unchanged():
    o1 = rec("v1", 0, "Lock your screen.", heading="A", sid="S1")
    o2 = rec("v1", 1, "Lock your screen.", heading="B", sid="S2")
    n1 = rec("v2", 0, "Lock your screen.", heading="A")
    n2 = rec("v2", 1, "Lock your screen.", heading="B")
    rs = match_versions("d", "v2", [o1, o2], [n1, n2], same_vectors(o1), S)
    assert [(r.status, r.stable_id) for r in rs] == [(Status.unchanged, "S1"), (Status.unchanged, "S2")]


def test_competing_candidates_are_needs_review():
    o1 = rec("v1", 0, "Employees must submit claims within 30 days.", sid="S1")
    o2 = rec("v1", 1, "Employees must submit claims within 60 days.", sid="S2")
    n = rec("v2", 0, "Employees must submit claims within 45 days.")
    rs = match_versions("d", "v2", [o1, o2], [n], same_vectors(o1, o2, n), S)
    review = [r for r in rs if r.status == Status.needs_review]
    assert len(review) == 1 and review[0].candidates == ["S1", "S2"]
    assert not any(r.status == Status.removed for r in rs), "competing candidates are not removals"


def test_one_to_one():
    o = rec("v1", 0, "Employees must submit claims within 30 days.", number="1.2", sid="S1")
    n1 = rec("v2", 0, "Employees must submit claims within 15 days.", number="1.2")
    n2 = rec("v2", 1, "Employees must submit claims within 15 working days.", number="3.1")
    rs = match_versions("d", "v2", [o], [n1, n2], same_vectors(o, n1, n2), S)
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
