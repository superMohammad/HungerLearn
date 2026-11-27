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
from dataclasses import dataclass, replace
from typing import Literal

RTL_CLASSES = frozenset({"R", "AL"})
LTR_CLASSES = frozenset({"L", "EN", "AN"})
# a separator stays inside a left-to-right stretch only when the stretch continues after it ("2026-12-01", "٦.١")
SEPARATOR_CLASSES = frozenset({"CS", "ES", "ET"})
TOUCH = 0.35  # glyphs closer than this × font size belong to one unit
SPACE_GAP = 0.15  # a gap between units wider than this × font size is a space
SAME_ROW = 0.5  # vertical centres closer than this × font size are one row
CELL_GAP = 1.5  # a wider gap (× font size) between texts on one row separates table cells or columns
ZERO_WIDTH = 0.5  # points
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


Kind = Literal["rtl", "ltr", "separator", "neutral"]


@dataclass(frozen=True)
class Unit:
    """Glyphs that touch on the page, in the order they are read."""
    glyphs: tuple[Glyph, ...]
    text: str
    kind: Kind

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


def _mostly_arabic(lines: list[list[Glyph]]) -> bool:
    """At least as many right-to-left letters as left-to-right ones."""
    classes = [unicodedata.bidirectional(g.char) for line in lines for g in line]
    return sum(c in RTL_CLASSES for c in classes) >= sum(c == "L" for c in classes)


def _left_to_right_paragraph(lines: list[list[Glyph]]) -> bool:
    """The stream opens with digits or Latin at the left end of their row («1.2 يجب …» at the left margin)."""
    glyphs = [g for line in lines for g in line]
    first = next((g for g in glyphs if unicodedata.bidirectional(g.char) in RTL_CLASSES | LTR_CLASSES), None)
    if first is None or unicodedata.bidirectional(first.char) in RTL_CLASSES:
        return False
    row_left = min(g.x0 for g in glyphs if abs(g.cy - first.cy) <= SAME_ROW * first.size)
    return first.x0 - row_left <= TOUCH * first.size


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


def right_to_left_page(blocks: list[list[list[Glyph]]]) -> bool:
    """A page whose letters are mostly Arabic (browser-made Arabic SOPs: 88 % or more; bilingual pages: 41 % or less)."""
    return _mostly_arabic([line for lines in blocks for line in lines])


def rebuilds_on_rtl_page(lines: list[list[Glyph]]) -> bool:
    """On a right-to-left page, every mostly-Arabic block drawn right to left is a right-to-left paragraph, also
    when its stream opens with the time or code that ends the sentence («… الساعة 1:15»)."""
    return _mostly_arabic(lines) and _drawn_right_to_left(lines)


def rebuilds_on_ltr_page(lines: list[list[Glyph]]) -> bool:
    """On a left-to-right page, a block that opens with digits or Latin at its row's left end is a left-to-right
    paragraph quoting Arabic («1.2 يجب …»), already in order."""
    return rebuilds_on_rtl_page(lines) and not _left_to_right_paragraph(lines)


def restore_unmapped(lines: list[list[Glyph]], marks: list[Glyph]) -> list[list[Glyph]]:
    """A glyph the font cannot map (U+FFFD, e.g. shadda with fatha drawn as one) takes the marks that the PDF's
    ActualText puts at the same spot. `marks` are the combining marks of the ActualText reading of the page."""
    out: list[list[Glyph]] = []
    for line in lines:
        fixed: list[Glyph] = []
        for g in line:
            if g.char != "\ufffd":
                fixed.append(g)
                continue
            found = [m for m in marks if _near(m.x0, g.x0) and abs(m.cy - g.cy) <= SAME_ROW * g.size]
            if found:
                fixed.extend(Glyph(m.char, g.x0, g.y0, g.x0, g.y1, g.size) for m in found)
            else:
                fixed.append(g)
        out.append(fixed)
    return out


def _kind(text: str) -> Kind:
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


def _same_unit(prev: Glyph, last_solid: Glyph | None, cur: Glyph) -> bool:
    """Glyphs stay in one unit when they touch and keep the same script, also across a space («١٥ دقيقة» is two
    units); punctuation is always a unit of its own. `last_solid` is the unit's last glyph that is not a space."""
    a, b = _script(prev.char), _script(cur.char)
    if "N" in (a, b) or ("W" not in (a, b) and a != b):
        return False
    if b != "W" and last_solid is not None and _script(last_solid.char) != b:
        return False
    return _touches(prev, cur)


def _near(a: float, b: float) -> bool:
    return abs(a - b) < ZERO_WIDTH


def _lam_first(glyphs: list[Glyph]) -> list[Glyph]:
    """Ligatures. Zero-width letters at the right edge of the next glyph are its ligature components, written in
    reverse: lam-alef alef first («إغلاق» in a heading) and «الله» as «اهلل». Components at the previous lam's left
    edge are already in order («خلال», «الأصناف»)."""
    out = list(glyphs)
    i = 0
    while i < len(out):
        j = i
        while j < len(out) and out[j].zero_width and not unicodedata.combining(out[j].char) and _script(out[j].char) == "R":
            j += 1
        if j == i or j >= len(out) or not _near(out[i].x0, out[j].x1):
            i = max(j, i + 1)
            continue
        after_lam = i > 0 and out[i - 1].char == "ل" and _near(out[i].x0, out[i - 1].x0)
        if not after_lam:
            out[i:j + 1] = reversed(out[i:j + 1])
        i = j + 1
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


def _drop_overlapping_spaces(stream: list[Glyph]) -> list[Glyph]:
    """A real space sits in its own gap. A space glyph lying on the letter before it is a placeholder the PDF adds
    after a glyph the font cannot map («تُجهَّز» drawn with a combined shadda and fatha)."""
    out: list[Glyph] = []
    for g in stream:
        prev = next((h for h in reversed(out) if not h.char.isspace() and not h.zero_width), None)
        on_letter = prev is not None and _script(prev.char) == "R" and abs(g.cy - prev.cy) <= SAME_ROW * prev.size \
            and min(g.x1, prev.x1) - max(g.x0, prev.x0) > ZERO_WIDTH
        if g.char.isspace() and on_letter:
            continue
        out.append(g)
    return out


def _place_marks(line: list[Glyph]) -> list[Glyph]:
    """A mark the stream puts right after punctuation belongs to the Arabic letter touching that punctuation on its
    right: Chrome writes a sentence-final «اً.» as «.», «ً», then the rest of the row (the mark's own box is not
    reliable there). Move such marks after their letter. A mark right after a letter in the stream belongs to that
    letter and takes its position: its own box can carry another row's height or the row's edge."""
    out = list(line)
    i = 0
    while i < len(out):
        mark = out[i]
        if unicodedata.combining(mark.char) and i > 0 and _script(out[i - 1].char) == "R":
            base = out[i - 1]
            if min(abs(mark.x0 - base.x0), abs(mark.x0 - base.x1)) > base.size:
                out.pop(i)  # a stray copy at the row's edge, far from its letter (the letter's own mark is read too)
                continue
            out[i] = replace(mark, x0=base.x0, x1=base.x0, y0=base.y0, y1=base.y1)
            i += 1
            continue
        prev = next((g for g in reversed(out[:i]) if not g.char.isspace()), None)
        if not unicodedata.combining(mark.char) or prev is None or _script(prev.char) != "N":
            i += 1
            continue
        hosts = [k for k, g in enumerate(out) if _script(g.char) == "R" and not unicodedata.combining(g.char)
                 and abs(g.cy - prev.cy) <= SAME_ROW * prev.size and abs(g.x0 - prev.x1) <= TOUCH * prev.size]
        if not hosts:
            i += 1
            continue
        out.pop(i)
        host = hosts[-1] - (1 if hosts[-1] > i else 0)  # the logically last letter (alef of a final lam-alef)
        at = host + 1
        while at < len(out) and unicodedata.combining(out[at].char):
            at += 1
        out.insert(at, replace(mark, x0=out[host].x0, x1=out[host].x0))
        if at <= i:
            i += 1
    return out


def _units(lines: list[list[Glyph]]) -> list[Unit]:
    units: list[Unit] = []
    # one stream for the whole block: a mark can open the next line's stream («فريقا» | «ً مختصاً»)
    for line in [_place_marks(_drop_overlapping_spaces([g for line in lines for g in line]))]:
        current: list[Glyph] = []
        for glyph in line:
            last_solid = next((g for g in reversed(current) if not g.char.isspace()), None)
            if current and not _same_unit(current[-1], last_solid, glyph):
                unit = _unit(current)
                if unit is not None:
                    units.append(unit)
                current = []
            current.append(glyph)
        unit = _unit(current) if current else None
        if unit is not None:
            units.append(unit)
    return units


def _rows(units: list[Unit]) -> list[list[Unit]]:
    rows: list[list[Unit]] = []
    for unit in sorted(units, key=lambda u: u.cy):
        if rows and abs(unit.cy - rows[-1][0].cy) <= SAME_ROW * unit.size:
            rows[-1].append(unit)
        else:
            rows.append([unit])
    return rows


def _latin(unit: Unit) -> bool:
    return any(unicodedata.bidirectional(c) == "L" for c in unit.text)


def _classes(unit: Unit) -> set[str]:
    return {unicodedata.bidirectional(c) for c in unit.text}


def _latin_context(logical: list[Unit], k: int) -> bool:
    """Bidi rule W7: digits count as Latin when the nearest strong unit before them is Latin («ZN-401»)."""
    for u in reversed(logical[:k + 1]):
        if _latin(u):
            return True
        if u.kind == "rtl":
            return False
    return False


def _pieces(stretch: list[Unit], after_arabic: bool) -> list[list[Unit]]:
    """Split a left-to-right stretch (given right to left) into the pieces that read left to right.

    - N1: a space between numbers resolves right to left, so a spaced boundary splits unless the strong units on
      both sides are Latin (after W7) («1 2026-03-01» in a table row; «A & B» and «ZN-401، ZN-404» stay whole).
    - W2/W4: after Arabic letters, digits are Arabic numbers and only a single common separator (":", ".", ",")
      binds them, so «-» splits a date in Arabic prose into right-to-left pieces («2026-12-01»).
    """
    logical = list(reversed(stretch))
    latin = [_latin_context(logical, k) for k in range(len(logical))][::-1]  # back to right-to-left order
    pieces: list[list[Unit]] = [[stretch[0]]]
    for k in range(1, len(stretch)):
        prev, cur = stretch[k - 1], stretch[k]
        before = next((latin[m] for m in range(k - 1, -1, -1) if stretch[m].kind == "ltr"), False)
        after = next((latin[m] for m in range(k, len(stretch)) if stretch[m].kind == "ltr"), False)
        spaced = _spaced(prev, cur, prev.x0 - cur.x1)
        arabic_numbers = after_arabic and not (before or after)
        es_split = arabic_numbers and ({"ES"} & (_classes(prev) | _classes(cur))) and not ({"CS"} & (_classes(prev) | _classes(cur)))
        if (spaced and not (before and after)) or es_split:
            pieces.append([cur])
        else:
            pieces[-1].append(cur)
    return pieces


def _binds_left(sep: Unit, nxt: Unit) -> bool:
    """Bidi rule W5: a percent or currency sign touching a number is part of it («95٪»)."""
    return _classes(sep) <= {"ET"} and nxt.kind == "ltr" and sep.x0 - nxt.x1 <= TOUCH * max(sep.size, nxt.size)


def _after_arabic(groups: list[list[Unit]], first: Unit) -> bool:
    """Bidi rule W2 looks back past punctuation to the last strong text: Arabic within a word gap (not across a
    table-cell gap, where each cell is its own paragraph)."""
    for group in reversed(groups):
        unit = group[-1]
        if unit.kind in ("rtl", "ltr"):
            return unit.kind == "rtl" and min(u.x0 for u in group) - first.x1 <= CELL_GAP * max(unit.size, first.size)
    return False


def _groups(row: list[Unit]) -> list[list[Unit]]:
    """Right to left. A left-to-right stretch is one group read left to right: digits and Latin, with the separators
    and punctuation between them (Unicode bidi rule N1: "A & B", "user@example.com"), split per `_pieces`."""
    ordered = sorted(row, key=lambda u: -u.x1)
    groups: list[list[Unit]] = []
    i = 0
    while i < len(ordered):
        starts = ordered[i].kind == "ltr" or (i + 1 < len(ordered) and _binds_left(ordered[i], ordered[i + 1]))
        if not starts:
            groups.append([ordered[i]])
            i += 1
            continue
        last = i
        j = i + 1
        while j < len(ordered) and ordered[j].kind != "rtl":
            if ordered[j].kind == "ltr":
                last = j
            j += 1
        after_arabic = _after_arabic(groups, ordered[i])
        groups.extend(list(reversed(piece)) for piece in _pieces(ordered[i:last + 1], after_arabic))
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
