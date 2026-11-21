"""Regenerate colab/ovis_ocr_runner.ipynb from colab/ovis_ocr_runner.py ("# %%" cells)."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
src = (root / "colab" / "ovis_ocr_runner.py").read_text(encoding="utf-8")
cells = []
for chunk in src.split("# %%")[1:]:
    is_md = chunk.startswith(" [markdown]")
    body = chunk.split("\n", 1)[1].strip("\n") if "\n" in chunk else ""
    if is_md:
        lines = [l[2:] if l.startswith("# ") else l.lstrip("#") for l in body.splitlines()]
        cells.append({"cell_type": "markdown", "metadata": {}, "source": "\n".join(lines)})
    else:
        body = body.replace("# !pip", "!pip")
        cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": body})
nb = {"cells": cells, "metadata": {"accelerator": "GPU", "kernelspec": {"name": "python3", "display_name": "Python 3"}},
      "nbformat": 4, "nbformat_minor": 5}
(root / "colab" / "ovis_ocr_runner.ipynb").write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
print("notebook written")
