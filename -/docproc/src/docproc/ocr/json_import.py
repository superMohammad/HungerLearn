"""Import OCR results produced elsewhere (e.g. the Colab OvisOCR3 runner).

Accepted file shape (written by colab/ovis_ocr_runner.py)::

    {
      "format": "docproc-ocr/1",
      "engine": "ATH-MaaS/OvisOCR3",
      "versions": {
        "<version_id>": {
          "pages": {
            "2": {"status": "ok", "text": "..."},
            "3": {"status": "failed", "error": "CUDA out of memory"}
          }
        }
      }
    }

Page keys are PDF page numbers (1-based); for standalone images, the 1-based image index
or the image filename. A shorthand ``{"<version_id>": {"2": "text"}}`` is also accepted.
"""
from __future__ import annotations

import json
from pathlib import Path

from docproc.ocr.base import OCRPageRequest, OCRPageResult


class JsonImportOCR:
    name = "json_import"

    def __init__(self, *paths: str | Path) -> None:
        self.engine = "unknown"
        self._pages: dict[str, dict[str, dict]] = {}
        for p in paths:
            if p:
                self.load(p)

    def load(self, path: str | Path) -> None:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        versions = data.get("versions") if isinstance(data, dict) and "versions" in data else data
        self.engine = data.get("engine", self.engine) if isinstance(data, dict) else self.engine
        for version_id, v in versions.items():
            pages = v.get("pages", v) if isinstance(v, dict) else {}
            bucket = self._pages.setdefault(str(version_id), {})
            for key, entry in pages.items():
                if isinstance(entry, str):
                    entry = {"status": "ok", "text": entry}
                bucket[str(key)] = entry

    def ocr_page(self, req: OCRPageRequest) -> OCRPageResult:
        pages = self._pages.get(req.version_id, {})
        entry = pages.get(str(req.page)) or (pages.get(req.image_name) if req.image_name else None)
        if entry is None:
            return OCRPageResult(
                ok=False, error=f"no OCR result for version={req.version_id} page={req.page}", engine=self.name
            )
        if entry.get("status", "ok") != "ok" or not str(entry.get("text", "")).strip():
            return OCRPageResult(ok=False, error=entry.get("error", "empty OCR text"), engine=self.engine)
        return OCRPageResult(ok=True, text=entry["text"], engine=self.engine)
