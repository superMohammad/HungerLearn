from docproc.normalize import (
    clause_body, content_hash, modalities, negations, normalize, numbers, repair_arabic_order,
)


def test_arabic_digits_and_latin_digits_hash_equal():
    assert content_hash("خلال ٣٠ يومًا", ["employee"]) == content_hash("خلال 30 يومًا", ["employee"])
    assert content_hash("خلال ۳۰ يومًا", ["employee"]) == content_hash("خلال 30 يومًا", ["employee"])


def test_numbers_change_the_hash():
    assert content_hash("within 30 days", ["employee"]) != content_hash("within 15 days", ["employee"])
    assert content_hash("خلال ٣٠ يومًا", ["employee"]) != content_hash("خلال ١٥ يومًا", ["employee"])


def test_negation_changes_the_hash():
    assert content_hash("Partners may share data", ["partner"]) != content_hash("Partners may not share data", ["partner"])


def test_light_noise_is_ignored():
    plain = "يجب على الموظفين تقديم الطلب."
    noisy = "يـجـب عَلَى  الموظفين‏ تقديم الطلب ."  # tatweel, harakat, double space, RLM, space before dot
    assert normalize(plain) == normalize(noisy)
    assert content_hash(plain, ["employee"]) == content_hash(noisy, ["employee"])


def test_presentation_forms_fold():
    assert normalize("ﻻ") == normalize("لا")  # lam-alef ligature


def test_audience_is_part_of_hash_and_order_free():
    assert content_hash("x must y", ["owner", "employee"]) == content_hash("x must y", ["employee", "owner"])
    assert content_hash("x must y", ["owner"]) != content_hash("x must y", ["employee"])


def test_clause_number_is_position_not_content():
    assert clause_body("1.3 Partners must keep data") == "Partners must keep data"
    assert clause_body("٢-١ يجب على الشركاء") == "يجب على الشركاء"
    assert content_hash("1.3 Partners must keep data", ["partner"]) == content_hash("2.1 Partners must keep data", ["partner"])
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
