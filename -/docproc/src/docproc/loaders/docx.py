"""DOCX loading with Mammoth: preserve heading level and paragraph position."""
from __future__ import annotations

import html
from html.parser import HTMLParser
from pathlib import Path

import mammoth

from docproc.models import Block

_HEADINGS = {f"h{i}": i for i in range(1, 7)}
_BLOCK_TAGS = {"p", "li", *_HEADINGS}


class _BlockParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[Block] = []
        self._tag: str | None = None
        self._buf: list[str] = []
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in _BLOCK_TAGS:
            if self._tag is not None:  # nested block (e.g. p inside li): flush outer
                self._flush()
            self._tag = tag
            self._buf = []
        elif tag == "br" and self._tag:
            self._buf.append("\n")

    def handle_endtag(self, tag):
        if tag == self._tag:
            self._flush()

    def handle_data(self, data):
        if self._tag:
            self._buf.append(data)

    def _flush(self):
        text = html.unescape("".join(self._buf)).strip()
        tag, self._tag, self._buf = self._tag, None, []
        if not text:
            return
        if tag in _HEADINGS:
            kind, level = "heading", _HEADINGS[tag]
        elif tag == "li":
            kind, level = "list_item", 0
        else:
            kind, level = "paragraph", 0
        self.blocks.append(Block(text=text, kind=kind, level=level, index=len(self.blocks), text_source="docx"))


def load_docx(path: str | Path) -> tuple[list[Block], list[str]]:
    """Return ordered blocks and Mammoth warnings."""
    with open(path, "rb") as f:
        result = mammoth.convert_to_html(f)
    parser = _BlockParser()
    parser.feed(result.value)
    parser.close()
    return parser.blocks, [m.message for m in result.messages]
