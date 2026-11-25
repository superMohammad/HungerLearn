"""Light Arabic/English normalization, content hashing, and meaning-bearing token extraction.

Normalization is deliberately *light*: it removes presentation noise (presentation forms,
tatweel, harakat, bidi/zero-width marks, digit script, quote style, whitespace, Latin case)
but never drops words or numbers, so "30 days" and "15 days" always hash differently.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Iterable

_HARAKAT = set(range(0x064B, 0x0660)) | {0x0670} | set(range(0x06D6, 0x06EE))
_DROP = {0x0640} | {0x200B, 0x200C, 0x200D, 0xFEFF, 0x200E, 0x200F, 0x061C} | set(range(0x202A, 0x202F)) | set(
    range(0x2066, 0x206A)
)
_DIGITS = {**{0x0660 + i: str(i) for i in range(10)}, **{0x06F0 + i: str(i) for i in range(10)}}
_PUNCT = {
    "،": ",", "؛": ";", "؟": "?", "٪": "%", "٫": ".", "٬": ",",
    "«": '"', "»": '"', "“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "‚": "'",
    "–": "-", "—": "-", "−": "-", "ـ": "",
}
_ALEF = {"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا"}
_CLOSING = set(".,:;?!%)]")


def _norm_char(c: str) -> str:
    out = []
    for ch in unicodedata.normalize("NFKC", c):
        cp = ord(ch)
        if cp in _HARAKAT or cp in _DROP:
            continue
        if cp in _DIGITS:
            out.append(_DIGITS[cp])
            continue
        ch = _PUNCT.get(ch, ch)
        ch = _ALEF.get(ch, ch)
        if ch.isspace():
            out.append(" ")
            continue
        out.append(ch.casefold())
    return "".join(out)


def normalize_with_map(text: str) -> tuple[str, list[int]]:
    """Return normalized text plus, for each normalized char, the index of its source char."""
    chars: list[str] = []
    idx: list[int] = []
    for i, c in enumerate(text):
        for n in _norm_char(c):
            if n == " " and (not chars or chars[-1] == " "):
                continue  # collapse whitespace / drop leading
            chars.append(n)
            idx.append(i)
    while chars and chars[-1] == " ":
        chars.pop()
        idx.pop()
    # drop a space before closing punctuation ("word ." -> "word.")
    keep = [i for i in range(len(chars)) if not (chars[i] == " " and i + 1 < len(chars) and chars[i + 1] in _CLOSING)]
    return "".join(chars[i] for i in keep), [idx[i] for i in keep]


def normalize(text: str) -> str:
    """Light normalization used for hashing and comparison (never for stored quotes)."""
    return normalize_with_map(text)[0]


# ---------------------------------------------------------------- reading-order repair
# letters + harakat only: digits and punctuation keep their extracted order
_AR_LETTERS = "ء-ٰٟٮ-ەۺ-ۿݐ-ݿﭐ-﷿ﹰ-ﻼ"
_AR_RUN = re.compile(rf"[{_AR_LETTERS}]+(?:[   ]+[{_AR_LETTERS}]+)*")


def _looks_reversed(run: str) -> bool:
    """Visual-order Arabic shows the article "ال" at word *ends* ("لا") instead of starts."""
    ws = [w for w in run.split() if len(w) > 3]  # skip short words such as the negation "لا"
    starts = sum(w.startswith(("ال", "وال", "بال", "لل")) for w in ws)
    ends = sum(w.endswith(("لا", "لاو", "لاب")) for w in ws)
    return ends >= 1 and ends > starts


def repair_arabic_order(line: str) -> tuple[str, bool]:
    """Fix Arabic runs that a PDF text layer returned in visual (reversed) order.

    Returns (line, repaired). Runs in logical order are left untouched.
    """
    repaired = False

    def fix(m: re.Match) -> str:
        nonlocal repaired
        run = m.group(0)
        if _looks_reversed(run):
            repaired = True
            return run[::-1]
        return run

    return _AR_RUN.sub(fix, line), repaired


CLAUSE_NO = re.compile(
    r"^\s*(?P<no>(?:article|clause|المادة|البند)\s+[\w٠-٩]+|"
    r"[\d٠-٩]+(?:[.\-][\d٠-٩]+)+|[\d٠-٩]+[.)])\s*[:.\-–)]?\s*",
    re.IGNORECASE,
)


def clause_body(text: str) -> str:
    """Text without a leading clause number ("1.3", "٢-١", "Article 4", "المادة ٣").

    The clause number is position, not content: renumbering alone must not change the hash.
    """
    return CLAUSE_NO.sub("", text, count=1)


def strip_heading(text: str, heading: str | None) -> str:
    """Text without a leading copy of its own section heading.

    Table rows often hold "<heading> <rule>" in one block, so whether the extracted quote starts
    with the heading depends on layout. The heading is position, not content, like the clause number.
    """
    if not heading:
        return text
    body, head = clause_body(text), normalize(clause_body(heading))
    if head and normalize(body).startswith(head + " "):
        words = len(head.split())
        return body.split(None, words)[-1]
    return text


# A short numbered label on its own first line ("٤. قبل المغادرة" + newline), as table rows produce.
_TITLE_LINE = re.compile(r"^\s*(?:[\d٠-٩]+(?:[.\-][\d٠-٩]+)*[.)])\s*[^\n.،:؛!?؟]{1,60}\n(?=\s*\S)")
_TITLE_MAX_WORDS = 7


def strip_title_line(text: str) -> str:
    """Drops a leading numbered title line. It labels the clause (layout), it is not rule text."""
    m = _TITLE_LINE.match(text)
    if m is None or len(m.group(0).split()) > _TITLE_MAX_WORDS:
        return text
    return text[m.end():]


def core_text(quote: str, heading: str | None) -> str:
    """Normalized rule text used for identity: no title line, heading copy, or clause number."""
    return normalize(clause_body(strip_heading(strip_title_line(quote), heading)))


def content_hash(quote: str, audiences: Iterable[str], heading: str | None) -> str:
    """Hash of lightly normalized source text + sorted audience set (explicit and inherited).

    Page, position, clause number, a leading title line and a leading copy of the section
    heading are excluded so a moved or re-laid-out clause keeps its hash.
    """
    aud = ",".join(sorted(set(audiences)))
    payload = f"{core_text(quote, heading)}|aud={aud}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- meaning-bearing tokens
_NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")
_NUMBER_WORDS = {
    # English
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
    "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12", "fourteen": "14",
    "fifteen": "15", "twenty": "20", "thirty": "30", "forty": "40", "forty-five": "45",
    "sixty": "60", "ninety": "90", "hundred": "100",
    # Arabic (normalized forms, no harakat, alef unified)
    "واحد": "1", "اثنان": "2", "اثنين": "2", "ثلاثة": "3", "ثلاث": "3", "اربعة": "4", "خمسة": "5",
    "سبعة": "7", "عشرة": "10", "خمسة عشر": "15", "عشرين": "20", "عشرون": "20", "ثلاثين": "30",
    "ثلاثون": "30", "ستين": "60", "تسعين": "90",
}
_NEGATIONS = {
    "not", "no", "never", "without", "cannot", "can't", "prohibited", "forbidden", "nor",
    "لا", "ليس", "غير", "لن", "لم", "يمنع", "يحظر", "ممنوع", "محظور", "دون", "بدون",
}
_MODALS = {
    "must": "obligation", "shall": "obligation", "required": "obligation", "mandatory": "obligation",
    "should": "recommendation", "may": "permission", "can": "permission", "optional": "permission",
    "يجب": "obligation", "يتعين": "obligation", "يلزم": "obligation", "الزامي": "obligation",
    "ينبغي": "recommendation", "يجوز": "permission", "يمكن": "permission", "يحق": "permission",
}
_WORD_RE = re.compile(r"[\w'-]+", re.UNICODE)


def words(text: str) -> list[str]:
    return _WORD_RE.findall(normalize(text))


def _strip_ar_prefix(w: str) -> str:
    # Arabic conjunction/preposition clitics glued to the word (و, ف, ب, ل)
    if len(w) > 3 and w[0] in "وفبل" and not w.isascii():
        return w[1:]
    return w


def numbers(text: str) -> list[str]:
    n = normalize(clause_body(text))
    found = _NUM_RE.findall(n)
    for w in _WORD_RE.findall(n):
        w2 = _strip_ar_prefix(w)
        if w in _NUMBER_WORDS:
            found.append(_NUMBER_WORDS[w])
        elif w2 in _NUMBER_WORDS:
            found.append(_NUMBER_WORDS[w2])
    return sorted(found)


def negations(text: str) -> list[str]:
    return sorted(w for w in words(text) if w in _NEGATIONS or _strip_ar_prefix(w) in _NEGATIONS)


def modalities(text: str) -> list[str]:
    out = []
    for w in words(text):
        m = _MODALS.get(w) or _MODALS.get(_strip_ar_prefix(w))
        if m:
            out.append(m)
    return sorted(set(out))


def is_arabic_char(c: str) -> bool:
    return "؀" <= c <= "ۿ" or "ݐ" <= c <= "ݿ" or "ﭐ" <= c <= "﻿"


def script_mix(text: str) -> str:
    ar = sum(is_arabic_char(c) for c in text)
    la = sum(("a" <= c.lower() <= "z") for c in text)
    if ar and la and min(ar, la) / max(ar, la) > 0.1:
        return "mixed"
    return "ar" if ar >= la else "en"
