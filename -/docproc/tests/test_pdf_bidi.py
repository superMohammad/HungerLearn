"""pdf_bidi on synthetic glyphs: each case is a pattern measured in Chrome/Skia Arabic PDFs."""
from __future__ import annotations

from docproc.loaders.pdf_bidi import Glyph, logical_rows, rebuilds, restore_unmapped

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


def test_which_blocks_are_rebuilt_is_decided_from_the_block_alone() -> None:
    chrome = [rtl("يجب على الموظفين", 540.0)]
    table_cell_on_the_left = [rtl("يجب على الموظفين", 200.0)]  # far from the right margin, still right to left
    ltr_paragraph = [ltr("1.2 ", 41.0) + rtl("يجب على الموظفين", 300.0)]  # an LTR paragraph quoting Arabic
    drawn_left_to_right = [ltr("يجب على الموظفين", 300.0)]  # a generator that does not shape Arabic
    english = [ltr("Wear gloves", 41.0)]
    assert rebuilds(chrome) and rebuilds(table_cell_on_the_left)
    assert not rebuilds(ltr_paragraph)
    assert not rebuilds(drawn_left_to_right)
    assert not rebuilds(english)


def test_an_arabic_paragraph_that_opens_with_a_latin_code_is_rebuilt() -> None:
    words = rtl("يجب الالتزام", 400.0)
    code = ltr("SOP-12", words[0].x1 + SPACE)  # at the row's right end, where a right-to-left paragraph starts
    assert rebuilds([code + words])
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
