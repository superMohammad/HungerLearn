"""Replaceable OCR adapter interface."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

OCR_JSON_FORMAT = "docproc-ocr/1"


@dataclass
class OCRPageRequest:
    document_id: str
    version_id: str
    page: int  # 1-based PDF page number, or 1-based image index for standalone images
    source_file: Path
    image_path: Path | None = None  # rendered PNG (PDF) or the image itself
    image_name: str | None = None


@dataclass
class OCRPageResult:
    ok: bool
    text: str = ""
    error: str = ""
    engine: str = ""


class OCRAdapter(Protocol):
    name: str

    def ocr_page(self, req: OCRPageRequest) -> OCRPageResult: ...
