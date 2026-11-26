"""Loop 5 targeted check for the three scan fixtures (no OCR model needed).

For each scan in the manifest it reports:
  * hidden text: poppler `pdftotext` output for image PDFs (must be empty) and PNG text/EXIF/XMP chunks;
  * effective resolution: raster pixels per inch of the PDF page (PNG: assumes a US Letter page width);
  * measured skew: projection-profile estimate of text-line rotation, compared with manifest rotation_degrees;
  * page renders written to qa/results/scans/ for visual inspection.
Requires Pillow, numpy and pypdfium2; pdftotext is used when it is on PATH.
Run from the dataset directory: python qa/scan_qa.py
"""
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
from PIL import Image
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "qa" / "results" / "scans"
MIN_DPI = 150
SKEW_TOLERANCE = 0.35  # degrees


def page_images(doc):
    path = ROOT / doc["path"]
    if doc["format"] == "png":
        img = Image.open(path)
        return [(img.convert("L"), img.width / 8.5)]
    reader = PdfReader(path)
    images = []
    for page in reader.pages:
        width_in = float(page.mediabox.width) / 72
        xobjects = page["/Resources"]["/XObject"].get_object()
        raster = next(iter(xobjects.values())).get_object()
        data = raster.get_data()
        try:
            img = Image.open(io.BytesIO(data))
        except Exception:
            mode = "L" if raster["/ColorSpace"] == "/DeviceGray" else "RGB"
            img = Image.frombytes(mode, (raster["/Width"], raster["/Height"]), data)
        images.append((img.convert("L"), raster["/Width"] / width_in))
    return images


def skew_degrees(img):
    # Binarize a downscaled copy and pick the rotation that makes horizontal text rows sharpest.
    small = img.resize((img.width // 3, img.height // 3))
    ink = (np.asarray(small) < 128).astype(np.float32)
    pil = Image.fromarray((ink * 255).astype(np.uint8))
    best, best_score = 0.0, -1.0
    for angle in np.arange(-3.0, 3.01, 0.05):
        rows = np.asarray(pil.rotate(angle, resample=Image.BILINEAR)).sum(axis=1)
        score = float(np.square(np.diff(rows)).sum())
        if score > best_score:
            best, best_score = float(angle), score
    return -best  # angle the page content is rotated by


def hidden_text(doc):
    path = ROOT / doc["path"]
    if doc["format"] == "png":
        img = Image.open(path)
        keys = [k for k in img.info if k not in ("dpi", "gamma")]
        return f"PNG metadata keys: {keys or 'none'}", not keys
    if not shutil.which("pdftotext"):
        return "pdftotext not available", True
    text = subprocess.run(["pdftotext", str(path), "-"], capture_output=True, text=True).stdout
    return f"pdftotext chars: {len(text.strip())}", not text.strip()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    failures = 0
    for doc in (d for d in manifest["documents"] if d["variant"] == "scan"):
        text_msg, text_ok = hidden_text(doc)
        for i, (img, dpi) in enumerate(page_images(doc), start=1):
            measured = skew_degrees(img)
            declared = doc["scan_quality"]["rotation_degrees"]
            skew_ok = abs(abs(measured) - abs(declared)) <= SKEW_TOLERANCE
            ok = text_ok and dpi >= MIN_DPI and skew_ok
            failures += not ok
            img.save(OUT / f"{doc['document_id']}-p{i}.png")
            print(f"{'ok  ' if ok else 'FAIL'} {doc['document_id']} p{i}: {text_msg}; {dpi:.0f} dpi; "
                  f"skew measured {measured:+.2f} deg vs declared {declared} ({doc['scan_quality']['profile']})")
    print(f"{failures} failing page(s); renders in {OUT.relative_to(ROOT)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
