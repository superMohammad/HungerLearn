from __future__ import annotations

from docproc.llm.base import merge_single_paragraph
from docproc.matching import change_reasons, same_but_title, status_for
from docproc.models import Block, ClauseDraft, ClauseRecord, Section, SourceLocation, Status
from docproc.normalize import clause_body, content_hash

PARAGRAPH = "طابق رقم الطلب والمبلغ والعملة في سجل المدفوعات. لا تعتبر العمليتين خصماً مكرراً إذا اختلف رقم الطلب."


def _section(*paragraphs: str) -> Section:
    blocks = [Block(text="١. التحقق من العمليتين", kind="heading", level=1, index=0)]
    blocks += [Block(text=p, index=i + 1) for i, p in enumerate(paragraphs)]
    return Section(section_id="s1", heading_path=["١. التحقق من العمليتين"], heading="١. التحقق من العمليتين", blocks=blocks)


def _rec(version: str, quote: str, heading: str) -> ClauseRecord:
    return ClauseRecord(
        record_id=version, document_id="d", version_id=version, ordinal=0, quote=quote, statement=quote,
        audiences=["courier"], audience_source="inherited", heading=heading,
        location=SourceLocation(kind="text", block_index=0), content_hash=content_hash(quote, ["courier"], heading),
    )


def _draft(quote: str) -> ClauseDraft:
    return ClauseDraft(quote=quote, statement=quote, audiences=["employee"], audience_source="inherited")


def test_a_split_single_paragraph_becomes_one_clause():
    first, second = PARAGRAPH.split(". ", 1)
    merged = merge_single_paragraph(_section(PARAGRAPH), [_draft(first + "."), _draft(second)])
    assert [d.quote for d in merged] == [PARAGRAPH]
    assert merged[0].audience_source == "inherited"


def test_drafts_are_kept_when_the_section_has_several_paragraphs_or_one_draft():
    drafts = [_draft("طابق رقم الطلب."), _draft("لا تعتبر العمليتين.")]
    assert merge_single_paragraph(_section("طابق رقم الطلب.", "لا تعتبر العمليتين."), drafts) == drafts
    one = [_draft(PARAGRAPH)]
    assert merge_single_paragraph(_section(PARAGRAPH), one) == one


def test_a_label_counts_as_a_title_only_when_the_other_version_shows_it_as_one():
    nl = chr(10)
    rule = "When the estimate is 12 minutes past, open a Delay case."
    pdf = _rec("v1", "1. Open the delay case " + rule, "Delayed order support triage")
    txt = _rec("v2", "[ ] 1. Open the delay case" + nl + rule, "Delayed order support triage")
    assert same_but_title(pdf, txt) and same_but_title(txt, pdf)
    assert status_for(change_reasons(pdf, txt)) is Status.unchanged
    # Word list numbering is not in the DOCX text: bare title in v1, numbered title in v2.
    body = "ابدأ حساب الانتظار عند اختيار «وصلت إلى الفرع» في التطبيق."
    assert same_but_title(_rec("v1", "عند الوصول" + nl + body, "انتظار"), _rec("v2", "١. عند الوصول" + nl + body, "الإجراء"))


def test_a_leading_condition_or_role_without_title_evidence_is_a_wording_change():
    for old, new in (("Before leaving the store check the seal.", "check the seal."),
                     ("Supervisors approve the refund.", "approve the refund."),
                     ("عند التأخير أرسل بلاغاً.", "أرسل بلاغاً.")):
        a, b = _rec("v1", old, "H"), _rec("v2", new, "H")
        assert not same_but_title(a, b)
        assert status_for(change_reasons(a, b)) is Status.changed


def test_a_short_unnumbered_rule_line_is_content():
    nl = chr(10)
    assert content_hash("Wear gloves" + nl + "Then call dispatch.", ["courier"], None) != content_hash(
        "Wear a hairnet" + nl + "Then call dispatch.", ["courier"], None)
    assert content_hash("1. Wait 10 minutes" + nl + "Then call.", ["courier"], None) != content_hash(
        "1. Wait 15 minutes" + nl + "Then call.", ["courier"], None)


def test_a_merged_paragraph_is_explicit_only_if_every_part_named_the_audience():
    first, second = PARAGRAPH.split(". ", 1)
    explicit = ClauseDraft(quote=first + ".", statement=first, audiences=["employee"], audience_source="explicit")
    merged = merge_single_paragraph(_section(PARAGRAPH), [explicit, _draft(second)])
    assert merged[0].audience_source == "inherited"


def test_checklist_boxes_are_layout():
    nl = chr(10)
    assert clause_body("[ ] ١. مطابقة الملصق") == "مطابقة الملصق"
    boxed = content_hash("[ ] ١. مطابقة الملصق" + nl + "طابق رقم الطلب.", ["partner"], None)
    assert boxed == content_hash("طابق رقم الطلب.", ["partner"], None)
