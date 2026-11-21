from docproc.ocr.base import OCRPageRequest, OCRPageResult


class NullOCR:
    """Always fails. Used when no OCR is configured, and in tests to simulate an outage."""

    name = "null"

    def ocr_page(self, req: OCRPageRequest) -> OCRPageResult:
        return OCRPageResult(ok=False, error="OCR not configured", engine=self.name)
