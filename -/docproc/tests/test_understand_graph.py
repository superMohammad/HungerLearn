import pytest
from pydantic import ValidationError

from docproc.graphs.understand import _locate_quote
from docproc.models import Audience, Block, ClauseDraft, Section


def test_docx_clauses_and_locations(make_app, fixtures_dir):
    app = make_app()
    st = app.ingest(fixtures_dir / "policy_v1.docx", "d", "v1")
    recs = st["records"]
    assert [r.clause_number for r in recs] == ["1.1", "1.2", "1.3", "1.4"]
    a = recs[0]
    assert a.location.kind == "docx" and a.location.page is None
    assert a.location.heading_path[-1].startswith("Section 1")
    assert set(a.audiences) == {Audience.employee, Audience.owner}  # multiple explicit audiences kept
    b = recs[1]
    assert "٣٠" in b.quote  # Arabic digits preserved verbatim in the stored quote


def test_pdf_pages_and_inherited_audience(make_app, fixtures_dir):
    app = make_app()
    st = app.ingest(fixtures_dir / "policy_v2.pdf", "d", "v2")
    recs = {r.clause_number: r for r in st["records"]}
    assert recs["1.1"].location.page == 1 and recs["2.1"].location.page == 2
    e = recs["2.2"]
    assert e.audiences == [Audience.partner] and e.audience_source == "inherited"
    assert e.audience_evidence == e.location.heading_path[-1] and "Partners" in e.audience_evidence
    assert len(e.steps) == 2 and e.steps[1].replace("\xa0", " ").endswith("اجتياز الاختبار النهائي")
    assert any(i.kind == "reading_order_repaired" for i in st["issues"])


def _section(text):
    blocks = [Block(text=t, index=i, page=1) for i, t in enumerate(text.split("\n"))]
    return Section(section_id="s1", heading_path=["H"], heading="H", blocks=blocks)


def test_quote_returns_exact_source_span():
    sec = _section("مقدمة\n1.2 يجب على الموظفين تقديم المطالبات خلال ٣٠ يومًا .")
    quote, *_ , block, fuzzy = _locate_quote(sec, "يجب على الموظفين تقديم المطالبات خلال 30 يوما.")
    assert quote == "يجب على الموظفين تقديم المطالبات خلال ٣٠ يومًا ."
    assert block.index == 1 and not fuzzy


def test_quote_not_found_is_recorded(make_app, fixtures_dir):
    class Hallucinating:
        name = "bad"

        def extract(self, section):
            return [ClauseDraft(quote="Employees get free cars every month.", statement="free cars")]

    st = make_app(extractor=Hallucinating()).ingest(fixtures_dir / "policy_v1.docx", "d", "v1")
    assert st["records"] == []
    assert any(i.kind == "quote_not_found" and i.blocking for i in st["issues"])


def test_llm_output_is_validated():
    with pytest.raises(ValidationError):
        ClauseDraft(quote="x must y", statement="a rule", audiences=["customer"])
    d = ClauseDraft(quote="x must y", statement="a rule", audiences=["owner", "unspecified", "owner"])
    assert d.audiences == [Audience.owner] and d.audience_source == "explicit"


def test_inherited_audience_without_heading_evidence_is_downgraded(make_app, fixtures_dir):
    class Inventing:
        name = "inv"

        def extract(self, section):
            out = []
            for b in section.blocks:
                if b.text.startswith("1.4"):
                    out.append(ClauseDraft(quote=b.text, statement="a rule", audiences=["partner"],
                                           audience_source="inherited", audience_evidence="For Partners"))
            return out

    st = make_app(extractor=Inventing()).ingest(fixtures_dir / "policy_v1.docx", "d", "v1")
    r = st["records"][0]
    assert r.audiences == [Audience.unspecified]
    assert any(i.kind == "audience_evidence_missing" for i in st["issues"])
