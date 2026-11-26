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


def test_fuzzy_quote_span_never_starts_mid_word():
    from docproc.graphs.understand import _snap_to_words

    text = "٢. تأخر التجهيز" + chr(10) + "إذا بقي الطلب قيد التجهيز بعد 10 دقائق"
    start = text.index("يز" + chr(10))  # fuzzy alignment landed inside "التجهيز"
    s, e = _snap_to_words(text, start, len(text))
    assert text[s:e] == "إذا بقي الطلب قيد التجهيز بعد 10 دقائق"


def test_a_numbered_title_line_right_above_the_quote_joins_the_span_without_changing_the_hash():
    """The LLM may leave "1. Open the delay case" out of the quote; the stored span keeps it, so the
    other version's inline title has its evidence (matching.same_but_title) whatever the model returns."""
    from docproc.graphs.understand import _with_numbered_title_line
    from docproc.normalize import content_hash

    for title, gap in (("1. Open the delay case", ""), ("١. فتح حالة التأخير", ""), ("  2) Reuse an open case", " \t")):
        rule = "When the estimate is 12 minutes past, open a Delay case."
        text = f"{title}\n{gap}{rule}"
        start = text.index(rule)
        widened = _with_numbered_title_line(text, start, len(text), [(start, len(text))])
        assert text[widened:] == f"{title.strip()}\n{gap}{rule}", title
        assert content_hash(text[widened:], ["employee"], None) == content_hash(rule, ["employee"], None)


def test_a_line_above_the_quote_stays_out_unless_strip_title_line_would_drop_it():
    from docproc.graphs.understand import _with_numbered_title_line

    rule = "Wash hands before packing."
    for before in ("Wear gloves", "1. Wait 15 minutes", "2. Never leave the branch", "3. Staff must sign",
                   "1.2 Open the case", "1. Receiving:", "Article 4 Receiving", "4. Open, then check"):
        text = f"{before}\n{rule}"
        start = text.index(rule)
        assert _with_numbered_title_line(text, start, len(text), [(start, len(text))]) == start, before


def test_a_numbered_line_that_another_draft_quotes_is_its_own_clause_not_a_title():
    from docproc.graphs.understand import _with_numbered_title_line

    text = "3. Wear gloves\nWash hands before packing."
    start = text.index("Wash")
    assert _with_numbered_title_line(text, start, len(text), [(0, 14), (start, len(text))]) == start


def test_the_ingested_record_keeps_the_title_line_the_model_left_out(make_app, tmp_path):
    class DropsTitles:
        name = "drops-titles"

        def extract(self, section):
            return [ClauseDraft(quote=b.text, statement="a rule") for b in section.blocks if b.text.startswith("When")]

    src = tmp_path / "v2.txt"
    src.write_text("Delay handling\n\n1. Open the delay case\nWhen the estimate is 12 minutes past, open a Delay case.\n",
                   encoding="utf-8")
    st = make_app(extractor=DropsTitles()).ingest(src, "d", "v2")
    assert [r.quote for r in st["records"]] == ["1. Open the delay case\nWhen the estimate is 12 minutes past, open a Delay case."]


def test_a_quote_that_already_starts_with_its_title_line_is_not_widened_over_a_second_one():
    """Two stacked title lines: core_text strips only one, so taking the upper one would change the hash."""
    from docproc.graphs.understand import _with_numbered_title_line

    text = "1. Delay handling\n1.1. Open the case\nWhen the estimate is 12 minutes past, open a Delay case."
    start = text.index("1.1.")
    assert _with_numbered_title_line(text, start, len(text), [(start, len(text))]) == start
