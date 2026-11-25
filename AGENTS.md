# AGENTS.md

Shared instructions for every coding agent (Claude Code reads this through `CLAUDE.md`, Codex reads it natively) and for humans.

## What this repo is

Hunger Learn turns procedure documents (SOPs) into role-specific training: AI generates training once per document version, a human approves it, learners prove mastery, supervisors see readiness. The target product architecture (Next.js + Supabase/pgvector + Vercel AI SDK, six stages from "understand the document" to "re-do only changed clauses on v2") is described in `hunger-learn-mvp-architecture.md`. Read it before changing app code. The MVP app in `web/` implements a thin, local slice of all six stages.

What exists today:

| Path | Contents |
|---|---|
| `-/docproc/` | Python + LangGraph prototype of stages 1 and 6: bilingual (AR/EN) clause extraction with source citations, and v1→v2 clause comparison that emits a JSON report. Has its own `README.md` (detailed) and `pytest` suite. |
| `web/` | Next.js 16 (App Router, cache components) MVP of all six stages behind a public landing page and email/password sign-in/sign-up: upload → docproc → procedures (grouped by section number, titled by the LLM) → per-procedure training package generated with `hunger-learn-training-generator-prompt.md` (used verbatim as the system prompt) and verified (quote check, LLM judge, format rules) → review/approve/publish → learner flow (lesson + video → practice → exam with confidence tap; formats mcq, timed_decision, spot_the_mistake, order_steps, checklist; no photo checks) → readiness (incl. confident-and-wrong) + Arabic text-to-SQL → v2 carry-over per procedure. Vercel AI SDK against any OpenAI-compatible LLM (default: local Ollama `gemma4:latest`, thinking on). |
| `media/` | Python `hlmedia` CLI for lesson videos: human-made clips from `media/clips/` (requested in `CLIP-REQUESTS.md`, catalogued in `library.json`; no video generator), Najdi narration with NAMAA-Saudi-TTS-V2 (CATT tashkeel applied inside the TTS step only, never shown), logo top-right + on-screen text overlays, ffmpeg MP4. Courier = vertical, partner = horizontal. |
| `docker-compose.yml` | The single Postgres 17 + pgvector database (`127.0.0.1:5442`) shared by docproc and `web/`. |
| `data/synthetic_sops/` | 15-document synthetic evaluation corpus (AR/EN, PDF/DOCX/TXT/scans) with gold labels, split into `dev/` and `held_out/`. See its `README.md`. |
| `engineering-best-practices.md` | Team coding-standards reference. |
| `.agents/skills/` (symlinked from `skills/` and `.claude/skills`) | Shared agent skills for Codex and Claude Code: Supabase Postgres, Vercel React, UI/UX, Remotion (pinned in `skills-lock.json`), and the team's own `engineering-best-practices` (use it for code quality, API design, Python setup and agent design; this file wins over it). |
| `.claude/settings.json`, `.codex/config.toml` | Shared MCP servers (Playwright, Context7) for both tools. |
| `scripts/` | `setup-teammate.sh` (laptop without GPU) and `setup-gpu-host.sh` (the team's GPU machine). |

The top-level directory is literally named `-`. Always quote it or use `./-` / `--` in shell commands (`cd ./-/docproc`, `ls -- -`).

`*.zip` files at the root are archives of tracked folders and are gitignored. Do not commit them.

## docproc commands

Run from `-/docproc/`. The committed `.venv` there was made on Windows (`Scripts/`, no `bin/`), so on Linux create a fresh one first:

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"          # extras: pg, st, anthropic, ovis
cp .env.example .env

pytest -q                         # full suite; no GPU, API key, or server needed
pytest tests/test_matching.py::<test_name> -q   # single test
pytest -q -m postgres             # SQLite vs Postgres parity (needs docker compose up -d + DOCPROC_PG_DSN)
pytest -q -m real_models          # real Ollama/BGE-M3/LLM backends; skipped unless configured

docproc demo [--format pdf|scanned] [--real]   # bilingual v1 -> v2 demo, writes out/report_v2.json
docproc process FILE --doc DOC_ID --version VER [--links links.json] [--ocr-json ocr.json]
docproc report --doc DOC_ID --version VER
docproc export-schema             # regenerates docs/report.schema.json
python scripts/make_fixtures.py   # rebuilds committed tests/fixtures
```

All configuration is `DOCPROC_*` env vars / `.env` (see `.env.example`, `src/docproc/config.py`). The defaults in tests are fully offline: `llm=fixture`, `embeddings=fixture`, `ocr=null`, SQLite in `tmp_path` (see `tests/conftest.py`, the `make_app` fixture and `run_pair` helper).

## Running the MVP

```sh
docker compose up -d                                  # Postgres + pgvector on 127.0.0.1:5442
cd ./-/docproc && uv venv .venv-linux && VIRTUAL_ENV=.venv-linux uv pip install -e ".[dev,pg,gemma]"
#   .env: DOCPROC_BACKEND=postgres, DOCPROC_LLM=openai_compat (Ollama gemma4), DOCPROC_EMBEDDINGS=embeddinggemma,
#         DOCPROC_EMBEDDING_MODEL=google/embeddinggemma-2, DOCPROC_EMBEDDING_DIM=768, DOCPROC_EMBEDDING_DEVICE=cuda
cd media && uv venv .venv && VIRTUAL_ENV=.venv uv pip install --extra-index-url https://download.pytorch.org/whl/cu128 --index-strategy unsafe-best-match -e ".[dev]" && .venv/bin/pytest -q
cd web && pnpm install && cp .env.example .env.local   # then fill the absolute paths
pnpm db:migrate && pnpm db:seed                        # app tables, read-only role, demo learners + accounts (DEMO_PASSWORD)
pnpm dev                                               # http://localhost:3000
pnpm test && pnpm typecheck && pnpm lint
```

- The app tables live in `web/db/migrations/`; docproc creates its own tables. `readiness_v` plus the `hl_readonly` role (SELECT on that view only) is the only surface the text-to-SQL feature can read.
- Long work (docproc, generation, video) runs after the response via `after()`; progress is in `pipeline_jobs` and `lesson_videos`. Renders are serialized on one GPU queue.
- Stage 2 is per procedure (the admin clicks "توليد التدريب" / "إعادة التوليد"); courier, employee and partner are all trained. Publishing a new package retires the procedure's previously published items (`outdated`). A lesson whose library clip is not in `media/clips/` yet fails to render with the missing file names; re-render it from the review page after adding the clip.
- `media` pins torch 2.8 / CUDA 12.8 because `habibi-tts` (NAMAA inference) requires torch<2.9. NAMAA and its Habibi Najdi reference clip are CC BY-NC-SA (non-commercial).
- Accounts (`accounts`, `sessions` tables; `src/lib/session.ts`, `src/lib/accounts.ts`) stand in for Supabase Auth: scrypt password hashes, an httpOnly random token cookie whose SHA-256 is stored server-side. Two account kinds: `admin` (uploads, reviews, publishes, readiness; seeded only, never self sign-up) and `learner` (self sign-up picks role and branch). Every server action re-checks the session.
- The UI is bilingual (Arabic default, English). Every page lives under `src/app/[lang]/`; `src/proxy.ts` rewrites clean URLs to `/<hl_lang cookie>/…`, and `/en/…` or `/ar/…` sets the cookie and redirects back (the header toggle uses this). UI strings live only in `src/lib/i18n/ar.ts` and `en.ts` (same shape, enforced by a test): Server Components call `getDict()` (`next/root-params`), Client Components `useDict()`. Server actions return dictionary keys, not text. Training content stays in its document's language and is rendered with `dir="auto"`. The logo stays top-right in both languages.
- Arabic UI copy is professional Saudi Arabic written natively (English copy likewise native), never word-by-word translation; procedure titles name the concrete situation. Optional landing/auth photos go in `web/public/brand/photos/` (see `IMAGE-REQUESTS.md` there).
- `.uploads/` and `media/out/` hold uploaded files and rendered videos; both are gitignored.

## Team setup and the GPU host

Only one team machine has a GPU (RTX 3090, 24 GB). Everything that needs CUDA runs there and nowhere else: LLM inference (Ollama `gemma4`), NAMAA TTS and lesson-video renders (`hlmedia`), and any future training. Never install CUDA torch or run `hlmedia` on a teammate laptop.

- The GPU host and the laptops share a private Tailscale network. The GPU host runs `scripts/setup-gpu-host.sh` once: Ollama listens on the network with one model loaded at a time, and ports 11434 (Ollama) and 3000 (shared staging app) are reachable only over `tailscale0`.
- A teammate runs `GPU_HOST=<tailscale name or IP> DEMO_PASSWORD=<min 8 chars> scripts/setup-teammate.sh`: local Postgres, docproc with CPU torch (EmbeddingGemma on CPU, same 768-d vectors), web with `LLM_BASE_URL` on the GPU host. EmbeddingGemma is a gated Hugging Face model: accept its licence and run `hf auth login` first.
- Lesson videos render only on the GPU host. Verify video features on the staging app at `http://<GPU_HOST>:3000`.
- When the GPU host is off, LLM calls fail. That is expected; do not add fallbacks.

## docproc architecture

- `pipeline.py` `App` wires `Settings` to swappable adapters, then runs two LangGraph `StateGraph`s:
  - `graphs/understand.py` (Workflow 1): load → native parse (PyMuPDF / Mammoth) → OCR flagged pages → segment by heading hierarchy → LLM extraction **per section** into `ClauseDraft` → validate quotes against source text (stores exact span; hallucinated quote → `quote_not_found`) → hash and persist idempotently.
  - `graphs/compare.py` (Workflow 2): exact-hash match → embed only unmatched clauses → candidates (clause number, heading, cosine) → **lexical verification of actual text** → greedy one-to-one assignment → added/removed/needs_review → persist and emit `ComparisonReport`.
- Adapter families, each with a deterministic fixture/null implementation used by tests: `llm/` (fixture, openai_compat, anthropic; prompt and validation in `llm/base.py`), `embeddings/` (ollama bge-m3, sentence-transformers CPU, fixture), `ocr/` (json_import, ovis, null), `storage/` (sqlite, postgres).
- Invariants that span files:
  - Matching rules live **only** in `matching.py`. Both storage backends run the same SQL from `storage/base.py`; only placeholders and JSON/vector encodings differ. Keep backend parity (`tests/test_backend_parity.py`).
  - Content hash = `sha256(normalize(quote without leading clause number or leading copy of its heading) | sorted audiences)`. Page, position, clause number, and heading stay out of the hash.
  - An audience difference counts as a change only when both versions state the audience in the text (`audience_source == "explicit"`); a verified pair with no content reason is `moved`/`unchanged`, not `changed` (`matching.status_for`). `normalize.py` folds forms, digits, and alef variants but must never drop words or numbers.
  - Embeddings never decide identity on their own. Lexical verification is required.
  - Stable IDs live in `clauses`; per-version records in `clause_versions`. Re-processing the same `--version` replaces it and must produce the same stable IDs (`tests/test_idempotency.py`).
  - If a new version is incomplete (OCR-failed pages, invalid extractions), would-be removals become `needs_review`, never `removed`. OCR failures are recorded as issues and never crash a run.
  - `models.py` holds both the LLM output schema and the team JSON contract (`contract_version`). Changing the report shape means updating `docs/report.schema.json`.
- OCR for scans runs out-of-process: `docproc export-ocr-pages` → `colab/ovis_ocr_runner.ipynb` (OvisOCR3 on a Colab GPU) → import the JSON with `--ocr-json`. The notebook is generated by `scripts/build_notebook.py` from `colab/ovis_ocr_runner.py`, so edit the `.py`.

docproc's `Audience` enum is `owner/employee/partner/courier/unspecified`; the app assigns each document one learner role (`courier/employee/partner`) at upload.

## Synthetic SOP dataset

```sh
pip install Pillow==13.0.0 pypdf==6.21.4
python data/synthetic_sops/validate.py     # run from repo root
```

- `manifest.json` resolves document IDs, families, versions, roles, languages, and paths.
- `(document_id, clause_id)` identifies a citation. `clause_id` and procedure IDs are stable across a family's versions and scans.
- Keep `held_out/` uploads and labels out of prompt development and the dev index. For held-out evaluation, freeze the config and build a fresh index from `held_out/uploads/` only.

## Frontend design rules

`docs/design-identity.md` defines a mandatory visual identity for any UI work ("Obsidian Intelligence": dark-first, cyan `#06B6D4` accent, no Inter/Roboto, no traffic-light sentiment colors, no pie charts or word clouds, monospace numbers, serif for quoted source text, slide-in panels instead of modals). Follow it when building the Next.js app. The architecture also requires Arabic-first RTL.
