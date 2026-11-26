from docproc.ocr.base import OCRPageRequest, OCRPageResult


class NullOCR:
    """Always fails. Used when no OCR is configured, and in tests to simulate an outage.

    The web app matches the error text "OCR not configured" (web/src/lib/docproc-issues.ts) to advise enabling
    OCR; tests/test_ocr_adapter.py pins it.
    """

    name = "null"

    def ocr_page(self, req: OCRPageRequest) -> OCRPageResult:
        return OCRPageResult(ok=False, error="OCR not configured", engine=self.name)
