from docproc.config import Settings
from docproc.ocr.base import OCRAdapter, OCRPageRequest, OCRPageResult
from docproc.ocr.json_import import JsonImportOCR
from docproc.ocr.null import NullOCR


def make_ocr(settings: Settings, ocr_json: str | None = None) -> OCRAdapter:
    path = ocr_json or settings.ocr_json
    if settings.ocr == "json_import":
        return JsonImportOCR(path) if path else NullOCR()
    if settings.ocr == "ovis":
        from docproc.ocr.ovis import OvisOCR

        return OvisOCR(settings.ovis_model)
    return NullOCR()


__all__ = ["OCRAdapter", "OCRPageRequest", "OCRPageResult", "JsonImportOCR", "NullOCR", "make_ocr"]
