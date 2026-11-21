"""OvisOCR3 adapter (ATH-MaaS/OvisOCR3, ~0.9B params, BF16).

Running it locally needs roughly 2 GB of VRAM for the weights alone, which does not fit
next to the display on a 2 GB MX130. The supported path is the Colab runner in
``colab/`` + ``JsonImportOCR``. This adapter is for machines with a larger GPU and uses
the Transformers loader from the model card; one page at a time, cache cleared between
pages. Install with ``pip install -e ".[ovis]"``.
"""
from __future__ import annotations

from docproc.ocr.base import OCRPageRequest, OCRPageResult

PLAIN_OCR_PROMPT = (
    "Extract all text from this document image in natural reading order. "
    "Preserve Arabic and English exactly as written, including digits and punctuation. "
    "Output plain text only, one paragraph per line; mark headings with '#'."
)


class OvisOCR:
    name = "ovis"

    def __init__(self, model_id: str = "ATH-MaaS/OvisOCR3", max_new_tokens: int = 4096) -> None:
        self.model_id = model_id
        self.max_new_tokens = max_new_tokens
        self._model = None
        self._processor = None

    def _load(self):
        if self._model is None:
            import torch  # noqa: F401
            from transformers import AutoModelForMultimodalLM, AutoProcessor

            self._processor = AutoProcessor.from_pretrained(self.model_id)
            self._model = AutoModelForMultimodalLM.from_pretrained(
                self.model_id, device_map="auto", torch_dtype="auto"
            )
        return self._model, self._processor

    def ocr_page(self, req: OCRPageRequest) -> OCRPageResult:
        if req.image_path is None:
            return OCRPageResult(ok=False, error="no page image", engine=self.model_id)
        try:
            import torch
            from PIL import Image

            model, proc = self._load()
            image = Image.open(req.image_path).convert("RGB")
            messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PLAIN_OCR_PROMPT}]}]
            prompt = proc.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            inputs = proc(text=[prompt], images=[image], return_tensors="pt").to(model.device)
            with torch.inference_mode():
                out = model.generate(**inputs, max_new_tokens=self.max_new_tokens, do_sample=False)
            text = proc.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0]
            return OCRPageResult(ok=bool(text.strip()), text=text.strip(), error="" if text.strip() else "empty", engine=self.model_id)
        except Exception as e:  # OOM, missing deps, bad image: never crash the graph
            return OCRPageResult(ok=False, error=f"{type(e).__name__}: {e}", engine=self.model_id)
        finally:
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
