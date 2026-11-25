from docproc.normalize import (
    clause_body, content_hash, modalities, negations, normalize, numbers, repair_arabic_order,
)


def test_arabic_digits_and_latin_digits_hash_equal():
    assert content_hash("خلال ٣٠ يومًا", ["employee"], None) == content_hash("خلال 30 يومًا", ["employee"], None)
    assert content_hash("خلال ۳۰ يومًا", ["employee"], None) == content_hash("خلال 30 يومًا", ["employee"], None)


def test_numbers_change_the_hash():
    assert content_hash("within 30 days", ["employee"], None) != content_hash("within 15 days", ["employee"], None)
    assert content_hash("خلال ٣٠ يومًا", ["employee"], None) != content_hash("خلال ١٥ يومًا", ["employee"], None)


def test_negation_changes_the_hash():
    assert content_hash("Partners may share data", ["partner"], None) != content_hash("Partners may not share data", ["partner"], None)


def test_light_noise_is_ignored():
    plain = "يجب على الموظفين تقديم الطلب."
    noisy = "يـجـب عَلَى  الموظفين‏ تقديم الطلب ."  # tatweel, harakat, double space, RLM, space before dot
    assert normalize(plain) == normalize(noisy)
    assert content_hash(plain, ["employee"], None) == content_hash(noisy, ["employee"], None)


def test_presentation_forms_fold():
    assert normalize("ﻻ") == normalize("لا")  # lam-alef ligature


def test_audience_is_part_of_hash_and_order_free():
    assert content_hash("x must y", ["owner", "employee"], None) == content_hash("x must y", ["employee", "owner"], None)
    assert content_hash("x must y", ["owner"], None) != content_hash("x must y", ["employee"], None)


def test_clause_number_is_position_not_content():
    assert clause_body("1.3 Partners must keep data") == "Partners must keep data"
    assert clause_body("٢-١ يجب على الشركاء") == "يجب على الشركاء"
    assert content_hash("1.3 Partners must keep data", ["partner"], None) == content_hash("2.1 Partners must keep data", ["partner"], None)
    assert numbers("1.2 within ٣٠ days") == ["30"]


def test_meaning_tokens():
    assert numbers("within thirty days") == ["30"]
    assert "obligation" in modalities("يجب على الموظفين")
    assert negations("لا يجوز للشركاء") == ["لا"]


def test_reading_order_repair():
    fixed, rep = repair_arabic_order("Pass the final quiz / يئاهنلا رابتخالا زايتجا")
    assert rep and fixed.endswith("اجتياز الاختبار النهائي")
    same, rep2 = repair_arabic_order("لا يجوز للموظفين مشاركة البيانات")
    assert not rep2 and same == "لا يجوز للموظفين مشاركة البيانات"
    nb, rep3 = repair_arabic_order("x / ملعتلا ةباوب ربع ليجستلا")
    assert rep3 and nb.endswith("التسجيل عبر بوابة التعلم")


def test_leading_section_heading_is_not_content():
    # Table rows put "<heading> <rule>" in one block; layout must not change the hash.
    with_heading = content_hash("١. عند الوصول ابدأ حساب الانتظار", ["courier"], "١. عند الوصول")
    without = content_hash("ابدأ حساب الانتظار", ["courier"], "عند الوصول")
    assert with_heading == without
    # A heading that is not a prefix leaves the text untouched.
    assert content_hash("ابدأ حساب الانتظار", ["courier"], "قبل المغادرة") == without


def test_leading_numbered_title_line_is_layout_not_content():
    nl = chr(10)
    in_table_row = content_hash("٤. قبل المغادرة" + nl + "لا تغادر الفرع حتى يوجّهك مسؤول التوزيع.", ["courier"], "خطوات التنفيذ")
    under_heading = content_hash("لا تغادر الفرع حتى يوجّهك مسؤول التوزيع.", ["courier"], "٤. إنهاء الانتظار")
    assert in_table_row == under_heading
    # A numbered first line that is a full sentence is rule text and stays.
    rule = "1. Couriers must wait 10 minutes." + nl + "Then call dispatch."
    assert content_hash(rule, ["courier"], None) != content_hash("Then call dispatch.", ["courier"], None)


def test_short_unnumbered_rule_lines_stay_in_the_hash():
    nl = chr(10)
    for rule_line in ("Do not leave", "Wait 5 minutes", "Staff must wear gloves"):
        assert content_hash(rule_line + nl + "Then call dispatch.", ["courier"], None) != content_hash(
            "Then call dispatch.", ["courier"], None)
