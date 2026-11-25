"""Property-based tests for the invariants in AGENTS.md: normalization never drops words or numbers,
and the content hash ignores position (clause number, heading copy, audience order) but not content."""
from hypothesis import assume, given
from hypothesis import strategies as st

from docproc.normalize import content_hash, normalize, numbers

LATIN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
ARABIC = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي"
AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"

# Words that are not themselves number words ("sixty", "عشرة"), which numbers() rightly counts.
word = st.text(alphabet=LATIN + ARABIC, min_size=4, max_size=10).filter(lambda w: numbers(w) == [])
number = st.integers(min_value=0, max_value=100_000)
body_words = st.lists(word, min_size=2, max_size=12)
audience_sets = st.lists(st.sampled_from(["owner", "employee", "partner", "courier", "unspecified"]), max_size=5)


def _arabic_digits(n: int) -> str:
    return "".join(AR_DIGITS[int(d)] for d in str(n))


@given(st.text(max_size=200))
def test_normalize_is_idempotent(text):
    assert normalize(normalize(text)) == normalize(text)


@given(body_words, st.lists(number, min_size=1, max_size=5), st.booleans())
def test_normalize_keeps_every_number(ws, nums, arabic_script):
    tokens = ws + [_arabic_digits(n) if arabic_script else str(n) for n in nums]
    text = " ".join(tokens)
    assert sorted(numbers(text)) == sorted(str(n) for n in nums)


@given(body_words)
def test_normalize_keeps_every_word(ws):
    assert len(normalize(" ".join(ws)).split()) == len(ws)


@given(body_words, st.integers(min_value=1, max_value=99), st.integers(min_value=1, max_value=99), audience_sets)
def test_hash_ignores_clause_number(ws, major, minor, audiences):
    body = " ".join(ws)
    plain = content_hash(body, audiences, None)
    assert content_hash(f"{major}. {body}", audiences, None) == plain
    assert content_hash(f"{major}.{minor} {body}", audiences, None) == plain


@given(st.lists(word, min_size=1, max_size=3), body_words, audience_sets)
def test_hash_ignores_leading_heading_copy(heading_words, ws, audiences):
    heading, body = " ".join(heading_words), " ".join(ws)
    assume(not normalize(body).startswith(normalize(heading) + " "))  # a body that itself starts with the heading is stripped too
    assert content_hash(f"{heading} {body}", audiences, heading) == content_hash(body, audiences, heading)


@given(body_words, audience_sets, st.randoms())
def test_hash_ignores_audience_order(ws, audiences, rnd):
    shuffled = list(audiences)
    rnd.shuffle(shuffled)
    body = " ".join(ws)
    assert content_hash(body, audiences, None) == content_hash(body, shuffled, None)


@given(body_words, number, audience_sets)
def test_hash_changes_when_a_number_changes(ws, n, audiences):
    body = " ".join(ws)
    assert content_hash(f"{body} {n} days", audiences, None) != content_hash(f"{body} {n + 1} days", audiences, None)


@given(body_words, word, audience_sets)
def test_hash_changes_when_a_word_is_added(ws, extra, audiences):
    body = " ".join(ws)
    assert content_hash(body, audiences, None) != content_hash(f"{body} {extra}", audiences, None)
