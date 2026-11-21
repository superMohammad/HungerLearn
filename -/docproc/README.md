# docproc: bilingual policy understanding and version comparison

docproc is a local Python + LangGraph application with four jobs:
- read Arabic, English, and mixed-language policies (text PDF, scanned PDF, DOCX, images);
- extract structured clauses together with where each one came from;
- compare a new version with the previous version of the same document;
- emit a JSON report for the teams that own lessons, approval, notifications, and badges.

Everything runs on a Windows laptop with no GPU. **Colab is optional.** Use it only to run OvisOCR3 on scanned pages, then import the resulting JSON.

## Quick start (PowerShell, Windows 11)

```powershell
cd C:\path\to\docproc
py -3.12 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass   # only if Activate.ps1 is blocked
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install -e ".[dev]"
copy .env.example .env

docproc demo                     # bilingual v1 -> v2 from DOCX (fixture LLM + fixture embeddings)
docproc demo --format pdf        # same, from text PDFs
docproc demo --format scanned    # v2 page 2 is image-only and is OCRed via the OCR JSON
pytest -q                        # full test suite (no GPU, no API key, no server)
```

`docproc demo` prints the statuses and writes `out\report_v2.json`.

### Real BGE-M3 embeddings on CPU (default backend: Ollama)

```powershell
# install Ollama for Windows from https://ollama.com, then:
ollama pull bge-m3
# .env: DOCPROC_EMBEDDINGS=ollama   (already the default in .env.example)
docproc demo --real
```

Alternative without Ollama: sentence-transformers on CPU. It downloads about 2.3 GB and needs about 2.5 GB of RAM.

```powershell
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -e ".[st]"
# .env: DOCPROC_EMBEDDINGS=st_cpu
```

Vectors are computed in batches of `DOCPROC_EMBEDDING_BATCH_SIZE` (default 4) and stored per `(model, content_hash)`. An unchanged or moved clause is never re-embedded.

### Real clause-extraction LLM

```powershell
# OpenAI-compatible endpoint (OpenAI, or a local Ollama chat model):
#   DOCPROC_LLM=openai_compat
#   DOCPROC_LLM_BASE_URL=https://api.openai.com/v1      (or http://localhost:11434/v1)
#   DOCPROC_LLM_MODEL=gpt-4o-mini                       (or e.g. qwen2.5:7b)
#   DOCPROC_LLM_API_KEY=sk-...
# Claude:
pip install -e ".[anthropic]"
#   DOCPROC_LLM=anthropic
#   DOCPROC_LLM_MODEL=claude-opus-5-5
#   DOCPROC_ANTHROPIC_API_KEY=sk-ant-...
```

`DOCPROC_LLM=fixture` is a deterministic, rule-based extractor. It returns the same Pydantic schema as a real LLM, so the whole graph can be tested without a key.

### Your own documents

```powershell
docproc init-db
docproc process .\policies\leave_v1.pdf  --doc leave-policy --version 2025-01
docproc process .\policies\leave_v2.docx --doc leave-policy --version 2025-06 --links .\links.json --out out\leave_2025-06.json
docproc report  --doc leave-policy --version 2025-06
docproc history <stable_id>
```

Use the **same `--doc`** for every version of a policy. Re-running the same `--version` is safe: it replaces that version's records and produces the same stable IDs.

### Scanned pages and the optional Colab OCR

```powershell
docproc export-ocr-pages .\scan.pdf --doc leave-policy --version 2025-09    # -> out\ocr_pages.zip
# Open colab/ovis_ocr_runner.ipynb in Colab (T4 GPU), run all, upload the zip,
# and download ocr_2025-09.json.
docproc process .\scan.pdf --doc leave-policy --version 2025-09 --ocr-json .\ocr_2025-09.json
```

How OCR works:
- The runner OCRs **one page at a time** with OvisOCR3. It uses vLLM as on the model card, with a Transformers fallback.
- If a page fails, the runner writes `{"status": "failed"}` for that page.
- Locally, OCR sits behind a replaceable adapter: `docproc.ocr.OCRAdapter`, with implementations `json_import`, `ovis`, and `null`.
- The MX130 (2 GB) cannot comfortably hold OvisOCR3 next to the display, so use `json_import`. `DOCPROC_OCR=ovis` is meant for a machine with a bigger GPU.

### PostgreSQL + pgvector (team integration)

```powershell
docker compose up -d                 # pgvector/pgvector:pg16
pip install -e ".[pg]"
$env:DOCPROC_BACKEND="postgres"; $env:DOCPROC_PG_DSN="postgresql://docproc:docproc@localhost:5432/docproc"
docproc init-db
pytest -q -m postgres                # SQLite vs PostgreSQL parity test
```

Both backends execute the same SQL from `storage/base.py`; only placeholders and the JSON/vector encodings differ. Matching rules live only in `matching.py`. PostgreSQL also exposes `search_similar()` (pgvector HNSW, cosine) for teammates.

## Folder structure

```
docproc/
  pyproject.toml  README.md  .env.example  docker-compose.yml
  src/docproc/
    config.py              settings (DOCPROC_* env / .env)
    models.py              Pydantic: LLM output schema + team JSON contract
    normalize.py           light AR/EN normalization, content hash, numbers/negation/modality, RTL repair
    loaders/               pdf.py (PyMuPDF probe + render), docx.py (Mammoth), text_blocks.py
    ocr/                   base.py (adapter), json_import.py, ovis.py, null.py
    llm/                   base.py (prompt + validation), fixture.py, openai_compat.py, anthropic.py
    embeddings/            Ollama bge-m3 | sentence-transformers BAAI/bge-m3 CPU | fixture
    storage/               base.py (shared SQL), sqlite.py, postgres.py, schema_*.sql
    matching.py            matching stages shared by every backend
    graphs/understand.py   Workflow 1 (LangGraph StateGraph)
    graphs/compare.py      Workflow 2 (LangGraph StateGraph)
    pipeline.py            wires settings -> adapters -> graphs
    cli.py                 `docproc` commands
  colab/ovis_ocr_runner.ipynb (+ .py)   optional GPU OCR runner
  scripts/make_fixtures.py              rebuilds tests/fixtures (committed)
  docs/report.schema.json               JSON Schema of the report (`docproc export-schema`)
  tests/                                pytest suite + fixtures
```

## Workflow 1: understand (`graphs/understand.py`)

| Node | What it does |
|---|---|
| `load_input` | Checks the file, document ID, and version ID, and detects PDF, DOCX, or image. |
| `parse_native` | **PDF:** reads each page's text layer with PyMuPDF. A page is flagged for OCR if it has too few characters, broken encoding, or private-use glyphs. Arabic runs that a PDF returns in visual order are restored to logical order, and a `reading_order_repaired` issue is recorded. **DOCX:** Mammoth yields headings (with level) and paragraphs in order. **Image:** becomes OCR page 1, keyed by its filename. |
| `ocr_pages` | Sends flagged pages through the OCR adapter, one at a time. A failure goes into `failed_pages` plus an `ocr_failed` issue. It never crashes the run. |
| `segment_sections` | Builds sections from the heading hierarchy. Each section keeps its heading path, which is the evidence for inherited audiences. |
| `extract_clauses` | Calls the configured extractor **per section**, which keeps prompts small. The output is validated against `ClauseDraft`: quote, statement, steps, audiences (`owner`/`employee`/`partner`/`unspecified`), audience source/evidence, clause number, heading. |
| `validate_clauses` | Finds every quote in the extracted text, after normalization, and **stores the exact source span**, so Arabic wording and digits are preserved. A hallucinated quote becomes `quote_not_found`. An inherited audience must be backed by a heading; otherwise it is downgraded and flagged. Duplicates are flagged too. |
| `hash_and_persist` | Computes the content hash and upserts the version idempotently. Stable IDs live in `clauses`; version-specific records live in `clause_versions`. |

## Workflow 2: compare (`graphs/compare.py`)

| Node | What it does |
|---|---|
| `load_versions` | Loads the new version and the most recent earlier version of the same document. It decides `complete` from failed pages and invalid extractions. |
| `exact_hash_match` | Pairs equal hashes one-to-one and reuses the stable ID and the cached embedding. Same position gives `unchanged`; a different page or section gives `moved`. Moved duplicates give `needs_review`. |
| `embed_unmatched` | Looks up vectors by hash and embeds only the missing ones (BGE-M3, CPU, small batches), then persists them. |
| `generate_candidates` | Finds candidates through the same clause number, the same heading, or BGE-M3 cosine ≥ `cosine_candidate` (top-k). |
| `verify_candidates` | Compares the **actual text** (lexical similarity) before accepting an identity. Embeddings alone never decide anything. |
| `assign_one_to_one` | Assigns the best pairs greedily. A confirmed edit becomes `changed`, keeps the stable ID, and gets reasons such as `numbers: 30 -> 15`, negation, modality, or audience. Near-ties become `needs_review`. |
| `apply_incompleteness` | Leftover new clauses are `added`, with a new deterministic ID. Leftover old clauses are `removed`, unless the new version is incomplete. Then they become `needs_review` with `removal_deferred_incomplete_extraction`. |
| `persist_and_report` | Writes identities, keeps history, attaches lesson/badge links, and saves and returns the `ComparisonReport`. |

**Content hash** = `sha256(normalize(quote without leading clause number) | sorted audiences)`.

Normalization is light:
- folds presentation forms (NFKC) and removes tatweel, harakat, and bidi/zero-width marks;
- maps Arabic-Indic and Persian digits to ASCII;
- unifies alef forms, quotes, and dashes;
- collapses whitespace, drops the space before closing punctuation, and casefolds Latin text.

It **never** drops words or numbers. Page, position, and clause number are kept out of the hash.

## JSON report (team contract, `docs/report.schema.json`)

```jsonc
{
  "contract_version": "1.0",
  "document_id": "policy-leave-expense-docx",
  "old_version_id": "v1", "new_version_id": "v2",
  "complete": true, "incomplete_reasons": [],
  "summary": {"unchanged":1,"moved":1,"changed":1,"added":1,"removed":1,"needs_review":0},
  "clauses": [{
      "status": "changed", "stable_id": "9b1e5cee-…",
      "old": {"quote": "1.2 يجب على الموظفين … خلال ٣٠ يومًا …", "location": {"kind":"docx","block_index":3,"heading_path":[…]}, …},
      "new": {"quote": "1.2 يجب على الموظفين … خلال ١٥ يومًا …", …},
      "affected_audiences": ["employee"], "change_reasons": ["numbers: 30 -> 15"],
      "cosine": 0.95, "lexical": 0.97,
      "lesson_ids": ["lesson-expenses-201"], "badge_ids": ["badge-finance"]
  }],
  "lesson_regeneration": [ /* only changed / added / removed */ ],
  "needs_review": [ /* unclear identity or deferred removals */ ],
  "issues": [ /* ocr_failed, quote_not_found, reading_order_repaired, ... */ ]
}
```

`--links links.json` maps stable IDs to lesson and badge IDs:
`{"<stable_id>": {"lesson_ids": [...], "badge_ids": [...]}}`.
A selector key such as `"@v1#1.2"` resolves to the stable ID of clause 1.2 in version v1.

## Fixtures

Built by `scripts/make_fixtures.py`, which uses Arial for Arabic glyphs.

| Clause | v1 → v2 | Expected |
|---|---|---|
| A 1.1 leave, 7 days (employees **and** owners) | identical, same section | `unchanged`, same ID |
| B 1.2 «خلال ٣٠ يومًا» | → «١٥» | `changed`, same ID, cosine > 0.9 |
| C partner confidentiality (mixed AR/EN) | §1 1.3 → §2 2.1 | `moved`, same ID |
| D 1.4 owners approve remote work | deleted | `removed`, history kept |
| E 2.2 security training + steps | new, audience inherited from «For Partners / للشركاء» | `added`, new ID |

Scanned fixtures:
- `policy_v2_scanned.pdf` is v2 with page 2 rasterized; it has no text layer.
- `ocr_v2_scanned.json` is the simulated OvisOCR3 output.
- `ocr_v2_missing_page.json` has page 2 failed. It produces `complete=false` and zero removals.

## Limits to know

- Comparing a DOCX with a PDF of the same policy reports location changes, because pages and heading styles differ between formats. Within one format, locations are stable.
- The visual-order Arabic repair is a heuristic. It looks for the article «ال» at word ends and restores those runs. If a PDF text layer is badly broken, OCR the page instead with `docproc export-ocr-pages --all`.
- An incomplete new version defers **all** of its would-be removals. We cannot know which missing clause sat on the unreadable page.
