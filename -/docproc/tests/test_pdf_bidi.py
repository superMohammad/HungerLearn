"""pdf_bidi on synthetic glyphs: each case is a pattern measured in Chrome/Skia Arabic PDFs."""
from __future__ import annotations

from docproc.loaders.pdf_bidi import (
    Glyph,
    logical_rows,
    rebuilds_on_ltr_page,
    rebuilds_on_rtl_page,
    restore_unmapped,
    right_to_left_page,
)

SIZE = 11.0
W = 5.0  # glyph width
SPACE = 2.5


def rtl(text: str, right: float, y: float = 100.0) -> list[Glyph]:
    """Glyphs in logical order, drawn leftwards from `right`."""
    out, x = [], right
    for c in text:
        w = SPACE if c == " " else W
        out.append(Glyph(c, x - w, y, x, y + SIZE, SIZE))
        x -= w
    return out


def ltr(text: str, left: float, y: float = 100.0) -> list[Glyph]:
    """Glyphs drawn rightwards from `left`."""
    out, x = [], left
    for c in text:
        w = SPACE if c == " " else W
        out.append(Glyph(c, x, y, x + w, y + SIZE, SIZE))
        x += w
    return out


def test_runs_written_out_of_order_are_read_right_to_left() -> None:
    # Chrome writes the heading «القسم ١: التحكم» as: التحكم, ":", "١", القسم (left to right on the page)
    words = rtl("القسم", 500.0)
    digit = rtl("١", words[-1].x0 - SPACE)
    colon = rtl(":", digit[-1].x0)
    rest = rtl("التحكم", colon[-1].x0 - SPACE)
    assert logical_rows([rest + colon + digit + words]) == ["القسم ١: التحكم"]


def test_a_sentence_final_full_stop_written_first_ends_the_sentence() -> None:
    body = rtl("اركن الدراجة", 500.0)
    stop = Glyph(".", body[-1].x0 - 2.0, 100.0, body[-1].x0, 100.0 + SIZE, SIZE)
    assert logical_rows([[stop, *body]]) == ["اركن الدراجة."]


def test_a_span_that_wraps_onto_the_next_row_gives_two_rows() -> None:
    first = rtl("السطر الأول", 500.0, y=100.0)
    second = rtl("السطر الثاني", 500.0, y=116.0)
    assert logical_rows([first + second]) == ["السطر الأول", "السطر الثاني"]


def test_latin_codes_dates_and_arabic_indic_numbers_read_left_to_right() -> None:
    lead = rtl("مثل", 500.0)
    code = ltr("TF-418", lead[-1].x0 - SPACE - 6 * W)
    rule_no = [Glyph("١", 535.0, 100.0, 540.0, 100.0 + SIZE, SIZE), Glyph(".", 532.0, 100.0, 535.0, 100.0 + SIZE, SIZE),
               Glyph("٦", 527.0, 100.0, 532.0, 100.0 + SIZE, SIZE)]  # stream order right to left, as Chrome writes it
    assert logical_rows([rule_no + lead + code]) == ["٦.١ مثل TF-418"]


def test_a_lam_alef_ligature_written_alef_first_is_read_lam_first() -> None:
    ighain = rtl("إغ", 500.0)
    lam = Glyph("ل", ighain[-1].x0 - W, 100.0, ighain[-1].x0, 100.0 + SIZE, SIZE)
    alef = Glyph("ا", lam.x1, 100.0, lam.x1, 100.0 + SIZE, SIZE)  # zero width at the lam's right edge
    qaf = Glyph("ق", lam.x0 - W, 100.0, lam.x0, 100.0 + SIZE, SIZE)
    assert logical_rows([[*ighain, alef, lam, qaf]]) == ["إغلاق"]


def test_a_lam_alef_ligature_already_lam_first_is_kept() -> None:
    khalal = rtl("خل", 500.0)
    alef = Glyph("ا", khalal[-1].x0, 100.0, khalal[-1].x0, 100.0 + SIZE, SIZE)  # at the previous lam's left edge
    lam = Glyph("ل", khalal[-1].x0 - W, 100.0, khalal[-1].x0, 100.0 + SIZE, SIZE)
    assert logical_rows([[*khalal, alef, lam]]) == ["خلال"]


def test_guillemets_drawn_in_right_to_left_text_are_unmirrored() -> None:
    open_q = rtl("»", 500.0)  # the PDF stores the shape drawn at the right: »
    word = rtl("وصلت", open_q[-1].x0)
    close_q = rtl("«", word[-1].x0)
    assert logical_rows([open_q + word + close_q]) == ["«وصلت»"]


def test_a_glyph_the_font_cannot_map_takes_the_actualtext_marks_at_its_spot() -> None:
    lam = rtl("ل", 500.0)
    unmapped = Glyph("�", lam[-1].x0, 100.0, lam[-1].x0, 100.0 + SIZE, SIZE)
    marks = [Glyph("ّ", unmapped.x0, 100.0, unmapped.x0, 100.0 + SIZE, SIZE),
             Glyph("َ", unmapped.x0, 100.0, unmapped.x0, 100.0 + SIZE, SIZE)]
    assert logical_rows(restore_unmapped([[*lam, unmapped]], marks)) == ["لَّ"]


def g(char: str, x0: float, x1: float) -> Glyph:
    return Glyph(char, x0, 100.0, x1, 100.0 + SIZE, SIZE)


def test_which_blocks_are_rebuilt_is_decided_from_the_block_and_the_page() -> None:
    chrome = [rtl("يجب على الموظفين", 540.0)]
    table_cell_on_the_left = [rtl("يجب على الموظفين", 200.0)]  # far from the right margin, still right to left
    ltr_paragraph = [ltr("1.2 ", 41.0) + rtl("يجب على الموظفين", 300.0)]  # an LTR paragraph quoting Arabic
    drawn_left_to_right = [ltr("يجب على الموظفين", 300.0)]  # a generator that does not shape Arabic
    english = [ltr("Wear gloves", 41.0)]
    assert rebuilds_on_ltr_page(chrome) and rebuilds_on_ltr_page(table_cell_on_the_left)
    assert not rebuilds_on_ltr_page(ltr_paragraph) and not rebuilds_on_ltr_page(drawn_left_to_right)
    assert not rebuilds_on_ltr_page(english) and not rebuilds_on_rtl_page(english)
    assert right_to_left_page([chrome, table_cell_on_the_left]) and not right_to_left_page([english, english])


def test_on_an_arabic_page_a_sentence_ending_in_a_time_is_rebuilt() -> None:
    words = rtl("وصلت الساعة", 400.0)
    time = ltr("1:15", words[-1].x0 - SPACE - 4 * W)  # the stream opens with the time, at the row's left end
    assert rebuilds_on_rtl_page([time + words]) and not rebuilds_on_ltr_page([time + words])
    assert logical_rows([time + words]) == ["وصلت الساعة 1:15"]


def test_an_arabic_paragraph_that_opens_with_a_latin_code_is_rebuilt() -> None:
    words = rtl("يجب الالتزام", 400.0)
    code = ltr("SOP-12", words[0].x1 + SPACE)  # at the row's right end, where a right-to-left paragraph starts
    assert rebuilds_on_ltr_page([code + words])
    assert logical_rows([code + words]) == ["SOP-12 يجب الالتزام"]


def test_punctuation_between_latin_words_stays_inside_the_latin_stretch() -> None:
    lead = rtl("راسل", 500.0)
    email = ltr("ops@hl.sa", 380.0)
    amp = ltr("A & B", 300.0)
    assert logical_rows([lead + email]) == ["راسل ops@hl.sa"]
    assert logical_rows([lead + amp]) == ["راسل A & B"]


def test_a_date_inside_arabic_reads_left_to_right() -> None:
    lead = rtl("تاريخ السريان", 500.0)
    date = ltr("2026-12-01", 300.0)
    assert logical_rows([date + lead]) == ["تاريخ السريان 2026-12-01"]


def test_a_mark_written_after_the_full_stop_joins_its_letter() -> None:
    word = rtl("فورا", 500.0)
    stop = Glyph(".", word[-1].x0 - 2.0, 100.0, word[-1].x0, 100.0 + SIZE, SIZE)
    tanween = Glyph("\u064b", word[-1].x0, 100.0, word[-1].x0, 100.0 + SIZE, SIZE)
    assert logical_rows([[*word, stop, tanween]]) == ["فوراً."]


def test_a_date_right_after_arabic_words_keeps_its_logical_order() -> None:
    lead = rtl("تاريخ السريان:", 500.0)
    date = ltr("01-12-2026", lead[-1].x0 - SPACE - 10 * W)  # bidi rule W2 draws it day first, left to right
    assert logical_rows([lead + date]) == ["تاريخ السريان: 2026-12-01"]


def test_a_percent_sign_stays_with_its_number() -> None:
    lead = rtl("النسبة", 500.0)
    pct = ltr("95٪", lead[-1].x0 - SPACE - 3 * W)
    assert logical_rows([lead + pct]) == ["النسبة 95٪"]


def test_digits_after_latin_count_as_latin_between_two_codes() -> None:
    codes = ltr("ZN-401، ZN-404", 178.0)
    assert logical_rows([rtl("الحاويات", 400.0) + codes]) == ["الحاويات ZN-401، ZN-404"]


def test_a_number_and_the_arabic_word_after_it_are_separate_runs() -> None:
    # Chrome writes «من ١٥ دقيقة» with the number and the next word in one touching run, the digits right to left
    stream = [g("٥", 205.0, 210.0), g("١", 200.0, 205.0), g(" ", 197.5, 200.0), *rtl("دقيقة", 197.5)]
    assert logical_rows([rtl("من", 222.5) + stream]) == ["من ١٥ دقيقة"]


def test_the_allah_ligature_is_read_in_order() -> None:
    # the font writes «الله» as alef, then «ه» and «ل» with zero width at the right edge of the final lam glyph
    abd = rtl("عبد", 309.6 + 3 * W)
    stream = [*abd, g("ا", 307.0, 309.6), g("ه", 307.0, 307.0), g("ل", 307.0, 307.0), g("ل", 296.5, 307.0)]
    assert logical_rows([stream]) == ["عبدالله"]


def test_a_placeholder_space_lying_on_a_letter_is_dropped() -> None:
    word = rtl("تجه", 362.3)
    he = word[-1]
    stream = [*word, g("\u0651", he.x0 + 1.6, he.x0 + 1.6), g("\u064e", he.x0 + 1.6, he.x0 + 1.6),
              g(" ", he.x0, he.x0 + 1.6), g("ز", he.x0 - 4.0, he.x0)]
    assert logical_rows([stream]) == ["تجهَّز"]


def test_a_stray_mark_far_from_its_letter_is_dropped() -> None:
    word = rtl("الأخطاء", 120.0)
    stray = g("\u064b", 541.3, 541.3)
    assert logical_rows([[*word, stray]]) == ["الأخطاء"]
