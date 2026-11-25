import pytest

from hlmedia.overlay import split_mark
from hlmedia.tashkeel import pausal, strip_tashkeel
from hlmedia.timing import shot_duration, slowdown


def test_shot_stretches_for_long_narration_only():
    assert shot_duration(5.0, 3.0) == 5.0
    assert shot_duration(4.0, 6.0) == pytest.approx(6.4)
    assert slowdown(4.0, 5.0) == 1.25
    assert slowdown(3.0, 9.0) == 1.5  # capped; the rest is a held last frame
    assert slowdown(8.0, 5.0) == 1.0  # long clips are trimmed, never sped up
    with pytest.raises(ValueError):
        slowdown(0.0, 5.0)


def test_split_mark_reads_do_dont_emoji():
    assert split_mark("❌ كيس مفتوح بدون ملصق") == ("dont", "كيس مفتوح بدون ملصق")
    assert split_mark("✅ Show the code first") == ("do", "Show the code first")
    assert split_mark("1. Close the lid") == (None, "1. Close the lid")


def test_pausal_drops_only_word_final_harakat():
    assert pausal("الْفَرْعَ حَتَّى") == "الْفَرْع حَتَّى"
    assert strip_tashkeel("لَا تُغَادِرْ") == "لا تغادر"
