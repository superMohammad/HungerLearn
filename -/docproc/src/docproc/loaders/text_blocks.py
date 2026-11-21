"""Turn page text (PDF text layer or OCR output) into ordered Blocks with heading detection."""
from __future__ import annotations

import re

from docproc.models import Block

_MD_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_HEADING_WORDS = re.compile(
    r"^(section|part|chapter|annex|appendix|القسم|الباب|الفصل|الملحق|الجزء)\b", re.IGNORECASE
)
from docproc.normalize import CLAUSE_NO  # noqa: E402,F401  (re-exported)

_LIST = re.compile(r"^\s*(?:[-•*▪]|\(?[a-zأ-ي\d٠-٩]\))\s+")


def is_heading_line(line: str) -> tuple[bool, int, str]:
    m = _MD_HEADING.match(line)
    if m:
        return True, len(m.group(1)), m.group(2).strip()
    if _HEADING_WORDS.match(line.strip()) and len(line) < 120 and not line.rstrip().endswith((".", "۔")):
        return True, 1, line.strip()
    return False, 0, line


def text_to_blocks(
    text: str,
    start_index: int,
    *,
    page: int | None = None,
    image_name: str | None = None,
    image_index: int | None = None,
    text_source: str = "text_layer",
) -> list[Block]:
    blocks: list[Block] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        heading, level, clean = is_heading_line(line)
        if heading:
            kind = "heading"
        elif _LIST.match(line):
            kind, level, clean = "list_item", 0, line
        else:
            kind, level, clean = "paragraph", 0, line
        blocks.append(
            Block(
                text=clean, kind=kind, level=level, index=start_index + len(blocks), page=page,
                image_name=image_name, image_index=image_index, text_source=text_source,  # type: ignore[arg-type]
            )
        )
    return blocks
