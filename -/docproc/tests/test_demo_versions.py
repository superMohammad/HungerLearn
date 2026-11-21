"""The bilingual v1 -> v2 demo: unchanged, moved, changed deadline, added, removed."""
import pytest

from docproc.models import Status
from tests.conftest import find, run_pair


@pytest.mark.parametrize("fmt", ["docx", "pdf"])
def test_v1_to_v2(make_app, fixtures_dir, fmt):
    app = make_app()
    r1, r2 = run_pair(app, fixtures_dir / f"policy_v1.{fmt}", fixtures_dir / f"policy_v2.{fmt}")
    assert r1.old_version_id is None and r1.summary["added"] == 4
    v1_ids = {(c.new.clause_number): c.stable_id for c in r1.clauses}

    assert r2.old_version_id == "v1" and r2.new_version_id == "v2" and r2.complete
    assert r2.summary == {"unchanged": 1, "moved": 1, "changed": 1, "added": 1, "removed": 1, "needs_review": 0}

    a = find(r2, "leave requests")
    assert a.status == Status.unchanged and a.stable_id == v1_ids["1.1"]

    c = find(r2, "customer data confidential")
    assert c.status == Status.moved
    assert c.stable_id == v1_ids["1.3"], "moved clause must keep its stable ID"
    assert c.old.location.heading_path != c.new.location.heading_path
    assert c.old.clause_number == "1.3" and c.new.clause_number == "2.1"

    b = find(r2, "مطالبات المصروفات")
    assert b.status == Status.changed
    assert b.stable_id == v1_ids["1.2"], "edited clause must keep its stable ID"
    assert b.cosine > 0.9, "embeddings are highly similar, yet the text check reports a change"
    assert any("30 -> 15" in reason for reason in b.change_reasons)
    assert b.lesson_ids == ["lesson-expenses-201"] and b.badge_ids == ["badge-finance"]

    d = find(r2, "remote work")
    assert d.status == Status.removed and d.stable_id == v1_ids["1.4"] and d.new is None

    e = find(r2, "security training")
    assert e.status == Status.added and e.stable_id not in v1_ids.values()
    assert e.new.audience_source == "inherited"

    regen = {x.stable_id: x.status for x in r2.lesson_regeneration}
    assert regen == {b.stable_id: Status.changed, e.stable_id: Status.added, d.stable_id: Status.removed}
    assert a.stable_id not in regen and c.stable_id not in regen

    # the historical record of the removed clause is still there
    hist = app.repo.clause_history(d.stable_id)
    assert [h.version_id for h in hist] == ["v1"]
    # both versions remain accessible
    assert app.repo.list_versions("doc-1") == ["v1", "v2"]
    assert len(app.repo.get_records("doc-1", "v1")) == 4


def test_report_is_json_contract(make_app, fixtures_dir):
    from docproc.models import ComparisonReport

    _, r2 = run_pair(make_app(), fixtures_dir / "policy_v1.docx", fixtures_dir / "policy_v2.docx")
    again = ComparisonReport.model_validate_json(r2.model_dump_json())
    assert again.summary == r2.summary
    assert all(c.stable_id for c in again.clauses)
