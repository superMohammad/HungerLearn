"""Logical reading order for right-to-left PDF text, rebuilt from glyph positions.

Browsers (Chrome/Skia) write each run of Arabic glyphs in logical order but emit the runs themselves in visual
order: a heading comes out as «التحكم في الوثيقة:١ القسم», the sentence-final full stop first, «٦.١» digit-reversed.
Read the glyphs without the PDF's /ActualText replacements (PyMuPDF TEXT_IGNORE_ACTUALTEXT): Chrome wraps a
letter with a shadda or tanween in ActualText, which turns it into a zero-width glyph between placeholder spaces.

Glyph positions are the ground truth, so a right-to-left block drawn right to left is rebuilt here: split into units of glyphs that touch on the page, group units into rows, order each row right
to left while keeping left-to-right stretches (digits, Latin, the separators between them) left to right, and take
the spaces between units from real gaps. Every other block is left to the caller unchanged.
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass

RTL_CLASSES = frozenset({"R", "AL"})
LTR_CLASSES = frozenset({"L", "EN", "AN"})
# a separator stays inside a left-to-right stretch only when the stretch continues after it ("2026-12-01", "٦.١")
SEPARATOR_CLASSES = frozenset({"CS", "ES", "ET"})
TOUCH = 0.35  # glyphs closer than this × font size belong to one unit
SPACE_GAP = 0.15  # a gap between units wider than this × font size is a space
SAME_ROW = 0.5  # vertical centres closer than this × font size are one row
ZERO_WIDTH = 0.5  # points
LEFT_ANCHORED = 0.1  # a block this much (× text width) closer to the left margin than to the right one is left-to-right
ALEFS = frozenset("اأإآ")
# A PDF stores the shape it draws, so a bracket or guillemet inside right-to-left text comes out mirrored.
MIRROR = str.maketrans("()[]{}<>«»‹›", ")(][}{><»«›‹")


@dataclass(frozen=True)
class Glyph:
    char: str
    x0: float
    y0: float
    x1: float
    y1: float
    size: float

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def zero_width(self) -> bool:
        return self.x1 - self.x0 < ZERO_WIDTH


@dataclass(frozen=True)
class Unit:
    """Glyphs that touch on the page, in the order they are read."""
    glyphs: tuple[Glyph, ...]
    text: str
    kind: str  # "rtl" | "ltr" | "separator" | "neutral"

    @property
    def x0(self) -> float:
        return min(g.x0 for g in self.glyphs)

    @property
    def x1(self) -> float:
        return max(g.x1 for g in self.glyphs)

    @property
    def size(self) -> float:
        return max(g.size for g in self.glyphs)

    @property
    def cy(self) -> float:
        return self.glyphs[0].cy


def _first_strong_is_rtl(lines: list[list[Glyph]]) -> bool:
    """Unicode bidi rules P2 and P3: the first strong letter in stream order sets the base direction."""
    for line in lines:
        for g in line:
            cls = unicodedata.bidirectional(g.char)
            if cls in RTL_CLASSES:
                return True
            if cls == "L":
                return False
    return False


def _drawn_right_to_left(lines: list[list[Glyph]]) -> bool:
    """Consecutive Arabic glyphs step leftwards. A generator that lays Arabic out left to right (unshaped or
    letter-reversed text) is handled by normalize.repair_arabic_order instead."""
    left = right = 0
    for line in lines:
        for prev, cur in zip(line, line[1:]):
            if {unicodedata.bidirectional(prev.char), unicodedata.bidirectional(cur.char)} <= RTL_CLASSES:
                left += cur.x1 <= prev.x0 + ZERO_WIDTH
                right += cur.x0 >= prev.x1 - ZERO_WIDTH
    return left > right


def rebuilds(lines: list[list[Glyph]], text_left: float, text_right: float) -> bool:
    """Whether a block needs rebuilding: right-to-left text, drawn right to left, not clearly anchored at the left margin.

    `text_left` and `text_right` are the page's text margins. A left-anchored block that starts with Arabic is a
    left-to-right paragraph quoting Arabic («1.2 يجب …» at the left margin), whose stream is already in order.
    """
    glyphs = [g for line in lines for g in line]
    if not glyphs or not (_first_strong_is_rtl(lines) and _drawn_right_to_left(lines)):
        return False
    right_gap, left_gap = text_right - max(g.x1 for g in glyphs), min(g.x0 for g in glyphs) - text_left
    return right_gap - left_gap <= LEFT_ANCHORED * (text_right - text_left)


def restore_unmapped(lines: list[list[Glyph]], marks: list[Glyph]) -> list[list[Glyph]]:
    """A glyph the font cannot map (U+FFFD, e.g. shadda with fatha drawn as one) takes the marks that the PDF's
    ActualText puts at the same spot. `marks` are the combining marks of the ActualText reading of the page."""
    out: list[list[Glyph]] = []
    for line in lines:
        fixed: list[Glyph] = []
        for g in line:
            found = [m for m in marks if g.char == "\ufffd" and _near(m.x0, g.x0) and abs(m.cy - g.cy) <= SAME_ROW * g.size]
            fixed.extend(Glyph(m.char, g.x0, g.y0, g.x0, g.y1, g.size) for m in found) if found else fixed.append(g)
        out.append(fixed)
    return out


def _kind(text: str) -> str:
    classes = {unicodedata.bidirectional(c) for c in text}
    if classes & RTL_CLASSES:
        return "rtl"
    if classes & LTR_CLASSES:
        return "ltr"
    if classes <= SEPARATOR_CLASSES | {"WS"}:
        return "separator"
    return "neutral"


def _script(char: str) -> str:
    """'R' right-to-left letters and their marks, 'L' Latin and digits, 'W' spaces, 'N' punctuation and symbols."""
    cls = unicodedata.bidirectional(char)
    if cls in RTL_CLASSES or (cls == "NSM" and unicodedata.combining(char)):
        return "R"
    if cls in LTR_CLASSES:
        return "L"
    return "W" if cls == "WS" else "N"


def _same_unit(prev: Glyph, cur: Glyph) -> bool:
    """Glyphs stay in one unit when they touch and keep the same script; punctuation is always a unit of its own."""
    a, b = _script(prev.char), _script(cur.char)
    if "N" in (a, b) or ("W" not in (a, b) and a != b):
        return False
    return _touches(prev, cur)


def _near(a: float, b: float) -> bool:
    return abs(a - b) < ZERO_WIDTH


def _lam_first(glyphs: list[Glyph]) -> list[Glyph]:
    """A lam-alef ligature is one glyph: its alef comes out with zero width, at the lam's left edge when the stream
    has it after the lam («خلال»), at the lam's right edge when the stream has it first («إغلاق» in a heading).
    Logically lam comes first."""
    out = list(glyphs)
    for i in range(len(out) - 1):
        alef, nxt = out[i], out[i + 1]
        after_lam = i > 0 and out[i - 1].char == "ل" and _near(alef.x0, out[i - 1].x0)
        if alef.char in ALEFS and alef.zero_width and nxt.char == "ل" and _near(alef.x0, nxt.x1) and not after_lam:
            out[i], out[i + 1] = nxt, alef
    return out


def _attach_marks(units: list[Unit]) -> list[Unit]:
    """A mark the stream put after punctuation («فوراً.») joins the right-to-left glyph it is drawn on."""
    out = [u for u in units if not all(unicodedata.combining(g.char) for g in u.glyphs)]
    for mark_unit in (u for u in units if all(unicodedata.combining(g.char) for g in u.glyphs)):
        x = mark_unit.x0
        hosts = [k for k, u in enumerate(out) if u.kind == "rtl" and abs(u.cy - mark_unit.cy) <= SAME_ROW * u.size
                 and u.x0 - ZERO_WIDTH <= x <= u.x1 + ZERO_WIDTH]
        if not hosts:
            out.append(mark_unit)
            continue
        host = out[hosts[0]]
        at = min(range(len(host.glyphs)), key=lambda n: abs(host.glyphs[n].x0 - x))
        glyphs = host.glyphs[:at + 1] + mark_unit.glyphs + host.glyphs[at + 1:]
        out[hosts[0]] = Unit(glyphs=glyphs, text="".join(g.char for g in glyphs), kind="rtl")
    return out


def _touches(prev: Glyph, cur: Glyph) -> bool:
    size = max(prev.size, cur.size)
    same_row = abs(cur.cy - prev.cy) <= SAME_ROW * size
    return same_row and (abs(cur.x1 - prev.x0) <= TOUCH * size or abs(cur.x0 - prev.x1) <= TOUCH * size)


def _unit(glyphs: list[Glyph]) -> Unit | None:
    """A unit without leading and trailing spaces; None when only spaces are left."""
    start, end = 0, len(glyphs)
    while start < end and glyphs[start].char.isspace():
        start += 1
    while end > start and glyphs[end - 1].char.isspace():
        end -= 1
    kept = glyphs[start:end]
    if not kept:
        return None
    kind = _kind("".join(g.char for g in kept))
    # digits and Latin read left to right whatever the stream order; right-to-left runs are logical in the stream
    ordered = sorted(kept, key=lambda g: g.x0) if kind in ("ltr", "separator") else _lam_first(kept)
    return Unit(glyphs=tuple(ordered), text="".join(g.char for g in ordered), kind=kind)


def _units(lines: list[list[Glyph]]) -> list[Unit]:
    units: list[Unit] = []
    for line in lines:
        current: list[Glyph] = []
        for glyph in line:
            if current and not _same_unit(current[-1], glyph):
                unit = _unit(current)
                if unit is not None:
                    units.append(unit)
                current = []
            current.append(glyph)
        unit = _unit(current) if current else None
        if unit is not None:
            units.append(unit)
    return _attach_marks(units)


def _rows(units: list[Unit]) -> list[list[Unit]]:
    rows: list[list[Unit]] = []
    for unit in sorted(units, key=lambda u: u.cy):
        if rows and abs(unit.cy - rows[-1][0].cy) <= SAME_ROW * unit.size:
            rows[-1].append(unit)
        else:
            rows.append([unit])
    return rows


def _groups(row: list[Unit]) -> list[list[Unit]]:
    """Right to left. A left-to-right stretch (digits, Latin, the separators inside it) is one group read left to right."""
    ordered = sorted(row, key=lambda u: -u.x1)
    groups: list[list[Unit]] = []
    i = 0
    while i < len(ordered):
        if ordered[i].kind != "ltr":
            groups.append([ordered[i]])
            i += 1
            continue
        last = i
        j = i + 1
        while j < len(ordered) and ordered[j].kind in ("ltr", "separator"):
            if ordered[j].kind == "ltr":
                last = j
            j += 1
        groups.append(list(reversed(ordered[i:last + 1])))
        i = last + 1
    return groups


def _spaced(prev: Unit, cur: Unit, gap: float) -> bool:
    return gap > SPACE_GAP * max(prev.size, cur.size)


def _join(groups: list[list[Unit]]) -> str:
    parts: list[str] = []
    for k, group in enumerate(groups):
        if k:
            prev = groups[k - 1]
            if _spaced(prev[-1], group[0], min(u.x0 for u in prev) - max(u.x1 for u in group)):
                parts.append(" ")
        for m, unit in enumerate(group):
            if m and _spaced(group[m - 1], unit, unit.x0 - group[m - 1].x1):
                parts.append(" ")
            # punctuation standing between right-to-left text takes the mirrored form it was drawn with
            parts.append(unit.text.translate(MIRROR) if len(group) == 1 and unit.kind != "ltr" else unit.text)
    return "".join(parts)


def logical_rows(lines: list[list[Glyph]]) -> list[str]:
    """The rows of a block, top to bottom, each in logical order. `lines` are the block's lines in stream order."""
    return [unicodedata.normalize("NFC", _join(_groups(row))) for row in _rows(_units(lines))]
