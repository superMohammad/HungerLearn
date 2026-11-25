"""Plain-text uploads (UTF-8, with or without BOM, LF or CRLF) into ordered Blocks."""
from __future__ import annotations

from pathlib import Path

from docproc.loaders.text_blocks import text_to_blocks
from docproc.models import Block


def load_text(path: str | Path) -> list[Block]:
    """Blocks of a UTF-8 text file. Other encodings are rejected, never guessed."""
    raw = Path(path).read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise ValueError(f"{path} is not UTF-8 text ({e}); re-save it as UTF-8") from e
    return text_to_blocks(text, 0, text_source="text")
