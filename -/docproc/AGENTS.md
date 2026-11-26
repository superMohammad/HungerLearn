# AGENTS.md — docproc

Package rules for `-/docproc/` (stages 1 and 6). The root `AGENTS.md` (workflow, risk tiers, `node scripts/check.mjs`) applies too.

## Commands

Run from `-/docproc/`. `node scripts/check.mjs` expects the virtualenv at `.venv-linux` on Linux and macOS, and at `.venv` on Windows (`Scripts\` instead of `bin/`):

```sh
uv venv .venv-linux && uv pip install --python .venv-linux -e ".[dev,pg,gemma]"   # Windows: .venv; extras: pg, st, gemma, anthropic, ovis
cp .env.example .env
. .venv-linux/bin/activate                                                       # Windows PowerShell: .venv\Scripts\Activate.ps1

ruff check src tests scripts      # lint (part of node scripts/check.mjs)
pytest -q                         # full suite; no GPU, API key, or server needed
pytest tests/test_matching.py::<test_name> -q   # single test
pytest -q -m postgres             # SQLite vs Postgres parity (needs docker compose up -d + DOCPROC_PG_DSN; CI runs it)
pytest -q -m real_models          # real Ollama/BGE-M3/LLM backends; skipped unless configured

docproc demo [--format pdf|scanned] [--real]   # bilingual v1 -> v2 demo, writes out/report_v2.json
docproc process FILE --doc DOC_ID --version VER [--links links.json] [--ocr-json ocr.json]
docproc report --doc DOC_ID --version VER
docproc eval [--real]             # score extraction + v1->v2 on data/synthetic_sops/dev; writes out/eval_dev_*.json. Run --real before and after any prompt, model, parsing or matching change
docproc export-schema             # regenerates docs/report.schema.json
python scripts/make_fixtures.py   # rebuilds committed tests/fixtures
```

All configuration is `DOCPROC_*` env vars / `.env` (see `.env.example`, `src/docproc/config.py`). The defaults in tests are fully offline: `llm=fixture`, `embeddings=fixture`, `ocr=null`, SQLite in `tmp_path` (see `tests/conftest.py`, the `make_app` fixture and `run_pair` helper).

## Architecture

- `pipeline.py` `App` wires `Settings` to swappable adapters, then runs two LangGraph `StateGraph`s:
  - `graphs/understand.py` (Workflow 1): load → native parse (PyMuPDF / Mammoth / UTF-8 `.txt`) → OCR flagged pages → segment by heading hierarchy → LLM extraction **per section** into `ClauseDraft` → validate quotes against source text (stores exact span; hallucinated quote → `quote_not_found`) → hash and persist idempotently.
  - `graphs/compare.py` (Workflow 2): exact-hash match → embed only unmatched clauses → candidates (clause number, heading, cosine) → **lexical verification of actual text** → greedy one-to-one assignment → added/removed/needs_review → persist and emit `ComparisonReport`.
- Adapter families, each with a deterministic fixture/null implementation used by tests: `llm/` (fixture, openai_compat, anthropic; prompt and validation in `llm/base.py`), `embeddings/` (ollama bge-m3, sentence-transformers CPU, fixture), `ocr/` (json_import, ovis, null), `storage/` (sqlite, postgres).
- Invariants that span files:
  - Matching rules live **only** in `matching.py`. Both storage backends run the same SQL from `storage/base.py`; only placeholders and JSON/vector encodings differ. Keep backend parity (`tests/test_backend_parity.py`).
  - Content hash = `sha256(normalize(quote without leading title line, checklist box, clause number or leading copy of its heading) | sorted audiences)`. Page, position, clause number, numbered title and heading stay out of the hash. A title is a short label with no number, negation or modal verb (`normalize.is_title_label`). An unnumbered first line is always content in the hash; `matching.same_but_title` ignores a leading label only when the other version shows that exact label as its title line or heading (PDF text layers keep titles on the rule line; Word list numbers are not in DOCX text). Never treat a short line as a title without such evidence: "Wear gloves" or "Supervisors …" are rules.
  - A section whose body is one paragraph yields one clause: `llm/base.py` `merge_single_paragraph` joins drafts a model split out of it.
  - An audience difference counts as a change only when both versions state the audience in the text (`audience_source == "explicit"`); a verified pair with no content reason is `moved`/`unchanged`, not `changed` (`matching.status_for`). `normalize.py` folds forms, digits, and alef variants but must never drop words or numbers.
  - Embeddings never decide identity on their own. Lexical verification is required.
  - Stable IDs live in `clauses`; per-version records in `clause_versions`. Re-processing the same `--version` replaces it and must produce the same stable IDs (`tests/test_idempotency.py`).
  - If a new version is incomplete (OCR-failed pages, invalid extractions), would-be removals become `needs_review`, never `removed`. OCR failures are recorded as issues and never crash a run.
  - `models.py` holds both the LLM output schema and the team JSON contract (`contract_version`). Changing the report shape means updating `docs/report.schema.json`.
- OCR for scans: on a machine with a CUDA GPU (about 2 GB free VRAM; the owner's RTX 3090, ~55 s per page with the reference kernels) install `.[ovis]` and set `DOCPROC_OCR=ovis`. `docproc process`, the web upload and `docproc eval --real` then OCR scans in-process, and the eval scores the dev scans under their own document ID (`<family>-scan`). Without a GPU, OCR runs out-of-process: `docproc export-ocr-pages` → `colab/ovis_ocr_runner.ipynb` (OvisOCR3 on a Colab GPU) → import the JSON with `--ocr-json`. The notebook is generated by `scripts/build_notebook.py` from `colab/ovis_ocr_runner.py`, so edit the `.py`.

docproc's `Audience` enum is `owner/employee/partner/courier/unspecified`; the app assigns each document one learner role (`courier/employee/partner`) at upload.
