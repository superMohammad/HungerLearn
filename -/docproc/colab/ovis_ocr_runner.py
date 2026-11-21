# %% [markdown]
# # OvisOCR3 page runner (optional, Colab GPU)
#
# Only OCR runs here. LangGraph, clause extraction, embeddings, storage and comparison stay
# in the local project.
#
# 1. Locally: `docproc export-ocr-pages scan.pdf --doc <doc> --version <ver>` -> `out/ocr_pages.zip`
# 2. Here: Runtime -> Change runtime type -> T4 GPU, run all cells, upload the zip.
# 3. Download `ocr_<version>.json`. Then, locally:
#    `docproc ingest scan.pdf --doc <doc> --version <ver> --ocr-json ocr_<ver>.json`
#
# Pages run one at a time. A page that fails (e.g. CUDA OOM) is written as
# `{"status": "failed"}` so the local app marks the comparison incomplete instead of
# reporting false removals.

# %%
# Official path from the model card: vLLM (pinned). Transformers is the fallback.
# !pip -q install "vllm==0.22.1" pillow huggingface_hub

# %%
import json
import os
import zipfile
from pathlib import Path

MODEL_ID = "ATH-MaaS/OvisOCR3"
WORK = Path("/content/ocr_job")
WORK.mkdir(parents=True, exist_ok=True)

try:
    from google.colab import files  # type: ignore

    uploaded = files.upload()  # choose ocr_pages.zip
    zip_path = WORK / next(iter(uploaded))
    zip_path.write_bytes(uploaded[zip_path.name])
except ImportError:  # running outside Colab: point at a local zip
    zip_path = Path(os.environ.get("OCR_PAGES_ZIP", "ocr_pages.zip"))

with zipfile.ZipFile(zip_path) as z:
    z.extractall(WORK)
manifest = json.loads((WORK / "manifest.json").read_text(encoding="utf-8"))
print(manifest["document_id"], manifest["version_id"], len(manifest["pages"]), "page(s)")

# %%
from huggingface_hub import snapshot_download

model_dir = Path(snapshot_download(MODEL_ID))  # includes prompts/plain_ocr.txt
prompt_file = model_dir / "prompts" / "plain_ocr.txt"
PROMPT = prompt_file.read_text(encoding="utf-8").strip() if prompt_file.exists() else (
    "Extract all text from this document image in natural reading order. "
    "Preserve Arabic and English exactly, including digits. Plain text only."
)

# %%
from PIL import Image

engine = None
try:
    from vllm import LLM, SamplingParams

    llm = LLM(model=str(model_dir), tensor_parallel_size=1, gpu_memory_utilization=0.8,
              limit_mm_per_prompt={"image": 1})
    tok = llm.get_tokenizer()
    params = SamplingParams(max_tokens=16384, temperature=0.0)

    def ocr_image(img: Image.Image) -> str:
        messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}]
        prompt = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        out = llm.generate(
            [{"prompt": prompt, "multi_modal_data": {"image": img},
              "mm_processor_kwargs": {"images_kwargs": {"min_pixels": 448 * 448, "max_pixels": 2880 * 2880}}}],
            params,
        )
        return out[0].outputs[0].text

    engine = f"{MODEL_ID} (vllm)"
except Exception as e:  # vLLM unavailable: Transformers fallback
    print("vLLM unavailable, using transformers:", e)
    import torch
    from transformers import AutoModelForMultimodalLM, AutoProcessor

    proc = AutoProcessor.from_pretrained(str(model_dir))
    model = AutoModelForMultimodalLM.from_pretrained(str(model_dir), device_map="auto", torch_dtype="auto")

    def ocr_image(img: Image.Image) -> str:
        messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}]
        prompt = proc.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = proc(text=[prompt], images=[img], return_tensors="pt").to(model.device)
        with torch.inference_mode():
            ids = model.generate(**inputs, max_new_tokens=8192, do_sample=False)
        return proc.batch_decode(ids[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0]

    engine = f"{MODEL_ID} (transformers)"

# %%
pages_out = {}
for p in manifest["pages"]:  # one page at a time
    key = p["key"]
    try:
        img = Image.open(WORK / p["file"]).convert("RGB")
        text = ocr_image(img).strip()
        pages_out[key] = {"status": "ok", "text": text} if text else {"status": "failed", "error": "empty output"}
    except Exception as e:
        pages_out[key] = {"status": "failed", "error": f"{type(e).__name__}: {e}"[:500]}
    finally:
        try:
            import torch

            torch.cuda.empty_cache()
        except Exception:
            pass
    print(key, pages_out[key]["status"])

result = {
    "format": "docproc-ocr/1",
    "engine": engine,
    "document_id": manifest["document_id"],
    "versions": {manifest["version_id"]: {"pages": pages_out}},
}
out_file = Path(f"/content/ocr_{manifest['version_id']}.json")
out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print("wrote", out_file)
try:
    files.download(str(out_file))  # type: ignore[name-defined]
except Exception:
    pass
