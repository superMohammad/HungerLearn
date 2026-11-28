# AGENTS.md

Shared instructions for every coding agent (Claude Code reads this through `CLAUDE.md`, Codex reads it natively) and for humans.

## What this repo is

Hunger Learn turns procedure documents (SOPs) into role-specific training: AI generates training once per document version, a human approves it, learners prove mastery, supervisors see readiness. The target product architecture (Next.js + Supabase/pgvector + Vercel AI SDK, six stages from "understand the document" to "re-do only changed clauses on v2") is described in `hunger-learn-mvp-architecture.md`. Read it before changing app code. The MVP app in `web/` implements a thin, local slice of all six stages.

What exists today:

| Path | Contents |
|---|---|
| `-/docproc/` | Python + LangGraph prototype of stages 1 and 6: bilingual (AR/EN) clause extraction with source citations, and v1→v2 clause comparison that emits a JSON report. Has its own `README.md` (detailed), `AGENTS.md` and `pytest` suite. |
| `web/` | Next.js 16 (App Router, cache components) MVP of all six stages behind a public landing page and email/password sign-in/sign-up: upload → docproc → procedures (grouped by section number, titled by the LLM) → per-procedure training package generated with `hunger-learn-training-generator-prompt.md` (used verbatim as the system prompt) and verified (quote check, LLM judge, format rules) → review/approve/publish → learner flow (lesson + video → practice → exam with confidence tap; formats mcq, timed_decision, spot_the_mistake, order_steps, checklist; no photo checks) → readiness (incl. confident-and-wrong) + Arabic text-to-SQL → v2 carry-over per procedure. Vercel AI SDK against any OpenAI-compatible LLM (default: local Ollama `gemma4:latest`, thinking on). |
| `media/` | Python `hlmedia` CLI for lesson videos: human-made clips from `media/clips/` (requested in `CLIP-REQUESTS.md`, catalogued in `library.json`; no video generator), Najdi narration with NAMAA-Saudi-TTS-V2 (CATT tashkeel applied inside the TTS step only, never shown), logo top-right + on-screen text overlays, ffmpeg MP4. Courier = vertical, partner = horizontal. |
| `docker-compose.yml` | The single Postgres 17 + pgvector database (`127.0.0.1:5442`) shared by docproc and `web/`. |
| `data/synthetic_sops/` | 15-document synthetic evaluation corpus (AR/EN, PDF/DOCX/TXT/scans) with gold labels, split into `dev/` and `held_out/`. See its `README.md`. |
| `engineering-best-practices.md` | Team coding-standards reference. |
| `.agents/skills/` (symlinked from `skills/` and `.claude/skills`) | Shared agent skills for Codex and Claude Code: the team workflow skills (see Workflow below), Supabase Postgres, Vercel React, UI/UX, Remotion (pinned in `skills-lock.json`), and the team's own `engineering-best-practices` (use it for code quality, API design, Python setup and agent design; this file wins over it). |
| `docs/` | `design-identity.md` (mandatory UI identity), `feature-map.md` (user-visible features and their proof), `rules-log.md` (mistakes turned into checks), `plans/` (approved Enhanced/High-risk plans). |
| `universal-ai-engineering-workflow.html` | The research and reasoning behind the Workflow section. Read it to understand why; this file is the rule. |
| `.claude/`, `.codex/` | Thin per-tool adapters: hooks that call the shared `scripts/agent-*-hook.mjs`, the `reviewer` subagent, MCP servers (Playwright, Context7). |
| `scripts/` | Plain Node, no dependencies, same on Linux, macOS and Windows: `check.mjs`, `check-fast.mjs`, `guard-diff.mjs`, `verify-app.mjs` (verification), `agent-*-hook.mjs` (tool hooks), `setup-teammate.mjs` (laptop without GPU). |
| `.githooks/`, `.github/` | Git hooks (pre-commit runs `check-fast`, pre-push blocks `main`); CI, PR and issue templates, CODEOWNERS. |

The top-level directory is literally named `-`. Always quote it or use `./-` / `--` in shell commands (`cd ./-/docproc`, `ls -- -`).

`*.zip` files at the root are archives of tracked folders and are gitignored. Do not commit them.

## Workflow (both tools, every engineer)

The repository, not the prompt, carries the quality bar. Package rules live in `web/AGENTS.md`, `-/docproc/AGENTS.md` and `media/AGENTS.md`.

### Commands

- `node scripts/check-fast.mjs`: lint, types and unit tests of the packages changed on this branch, plus `guard-diff`. The pre-commit hook and the agents' Stop hook run it; an agent cannot end a turn while it is red.
- `node scripts/check.mjs [web|docproc|media|scripts …]`: everything, incl. `next build`. CI runs it per package. Must pass before a PR.
- `node scripts/verify-app.mjs [F01 F02 …]`: drives the running app through `docs/feature-map.md` rows in Arabic and English with Playwright and saves screenshots and traces to `.verify/<branch>/` (CI runs it too).
- `node scripts/pr-policy.mjs <pr-body-file> <pr-meta-file>`: the PR gate (see below). Required check `pr-policy` on every PR; run it locally before pushing. The meta file is the PR's author and reviews: `node scripts/pr-meta.mjs <pr-number> <file>`, or before the PR exists `gh api user --jq '{author: .login, headSha: "none", reviews: []}' > <file>`.
- `node scripts/skill-log.mjs <skill>` / `node scripts/skills-used.mjs`: record a skill load on this branch / print the `skills:` line for the PR description.
- `node scripts/guard-diff.mjs [BASE]`: fails on added test skips, `eslint-disable`, `@ts-ignore`, `# noqa`, `type: ignore`, loosened strictness, or deleted test files. Only a human may override (`HL_ALLOW_WEAKENING="<reason>"`, CI label `allow-weakening`).
- The agent SessionStart hook sets `core.hooksPath=.githooks` on every clone and reports missing setup.
- Everything runs the same on Linux, macOS and Windows (Node 22+; git hooks are POSIX `sh`, which Git for Windows provides). `check-fast` and `guard-diff` look at the whole working tree, including untracked files, so untracked scratch code with a suppression blocks commits: keep scratch files outside the repo.

### Risk tiers

Pick the tier before starting; if unsure, go one higher. Any High-risk path in the diff makes the change High-risk.

| Tier | Typical change | Process |
|---|---|---|
| Minimal | Typo, copy, comment, config with no behaviour change | implement → `node scripts/check.mjs` → PR |
| Standard | Bug fix or self-contained feature in one package | `plan-change` → failing test first → implement → `node scripts/check.mjs` → `verify-app` if UI → `reviewer` → `pr-ready` |
| Enhanced | Multi-package, schema, pipeline, prompt/model or generation change; diff over ~400 lines | as Standard, plus a written plan in `docs/plans/` approved by one teammate other than the author (an `**Approved:**` line naming them, backed by their approving GitHub review; Mohammad's line alone suffices on his own PRs), stacked PRs, full feature-map verification, a second review (the other tool, or a second `review-change` pass), eval delta on `dev/` data (`docproc eval --real` before and after, from `-/docproc/`) |
| High-risk | Auth/sessions, permissions, DB roles, migrations, deletion, text-to-SQL, secrets, anything irreversible | as Enhanced, plus a design note with a threat model, `/security-review` (Claude) or `@codex security review`, the plan approved as for Enhanced, rollback plan. Never auto-merge. |

High-risk paths: `web/src/lib/session.ts`, `web/src/lib/accounts.ts`, `web/src/lib/db.ts`, `web/src/lib/sql-guard.ts`, `web/src/lib/readiness.ts`, `web/db/migrations/**`, anything touching `hl_readonly` / `readiness_v`, `.github/**`, `.githooks/**`, `scripts/**`, `.claude/**`, `.codex/**`, `.agents/skills/**`, `skills/**`, every `AGENTS.md` and `CLAUDE.md`, `web/eslint.config.mjs`, `web/tsconfig.json`, `docker-compose.yml`, docproc's `storage/schema_*.sql` (see `.github/CODEOWNERS`; `scripts/lib/policy.mjs` holds the same list, and a test keeps CODEOWNERS inside it).

### Definition of done

1. Every acceptance criterion has a check that passed; show the command and its output. Bugs: the test failed before the fix and passes after.
2. `node scripts/check.mjs` passes. No skipped or deleted tests, suppressions, loosened types, or CI/hook edits to get green.
3. UI or flow changes: `verify-app` evidence for each touched `docs/feature-map.md` row, in Arabic and English.
4. Standard and above: a fresh-context review (the `reviewer` subagent, or `review-change` in the other tool) with every must-fix resolved.
5. The required check `pr-policy` passes.

### PR gate (enforced)

Using the skills and these rules is a precondition for merging, checked by machines, not by memory:

- **`pr-policy` (required CI check, `scripts/pr-policy.mjs`)** fails a PR when: the `**Risk tier:**` line is missing or lower than the diff needs (High-risk paths or changed lines mentioning `hl_readonly`/`readiness_v`; multi-package, pipeline/OCR/prompt/corpus files or over 400 changed lines for Enhanced; computed by `scripts/lib/policy.mjs`); a checkbox is unticked without `n/a: <reason>`; "What changes for users", "Evidence" (with the `node scripts/check.mjs` result) or, from Enhanced, "Risks and rollback" is empty; an Enhanced or High-risk PR does not add or change its own plan in `docs/plans/` with an `**Approved:**` line naming a teammate other than the PR author who approved the PR on GitHub (latest non-comment review APPROVED on the current head commit, collaborator or owner; `scripts/pr-meta.mjs` reads the author and reviews, and the check re-runs on every review), or naming `@superMohammad` on a PR he opened; or the `skills:` line lacks the tier's skills (Standard+: `plan-change`, `review-change` or `reviewer`, `pr-ready`; High-risk: `security-review`; `verify-app` when UI files change).
- **Skill log:** each workflow skill's first step runs `node scripts/skill-log.mjs <skill>`; Claude Code also logs Skill loads and `reviewer` runs itself (PostToolUse hook). `node scripts/skills-used.mjs` prints the `skills:` line and marks skills that were only recorded by hand `(manual)`. Manual skill entries are self-reported; the `**Approved:**` line is not, because `pr-policy` matches it against the PR's GitHub reviews, and branch protection requires one approving review before merging.
- **Agent guard (`scripts/agent-bash-guard-hook.mjs`, rules in `scripts/lib/bash-guard.mjs`):** reads every command with bash and PowerShell quoting rules, including code in `bash -c`, `pwsh -Command`, `eval`, `$(…)` and heredocs. It refuses `gh pr create`/`gh pr new` until the tier's skills are in the log; `gh pr merge` with `--admin` (any spelling), with `$`/backtick arguments, or while a required check is not green; `gh api` merges and `gh alias set`. Any error in the guard denies the command.

### Shared skills (`.agents/skills`)

`plan-change` (before editing, Standard+), `fix-bug` (reproduce first), `verify-app` (drive the real app), `review-change` (fresh-context review), `pr-ready` (checks, evidence, PR body), `encode-mistake` (a mistake seen twice becomes a lint rule, type, test or CI gate, logged in `docs/rules-log.md`). Add a skill only after a procedure was repeated by hand three times.

### Always human-controlled

Risk tier and acceptance criteria; architecture decisions, new dependencies, DB roles and grants; approving and merging PRs: any teammate other than the author approves a plan or PR (one approval is enough) and may merge it; GitHub does not let an author approve their own PR, so on Mohammad's own PRs his `**Approved:**` line is self-reported and he merges them himself with the admin bypass in the web UI, or asks a teammate to approve; an agent merges only when the engineer asks in the session, with every required check green, never with `--admin` (agents work on branches and never push `main`, force-push or skip git hooks; `scripts/agent-bash-guard-hook.mjs` blocks these); deploying; changes to CI, hooks, `scripts/`, lint and type config (agents may edit them; a teammate other than the author reviews them in the PR); publishing training to learners; anything touching `held_out/`. If a requirement is ambiguous, ask or write the assumption into the plan; never guess silently.

### Code Review Rules

- Report correctness and security first; skip anything the linter catches.
- Flag weakened tests or checks, broadened permissions or DB grants, new dependencies, fallbacks that hide errors, and UI strings outside `src/lib/i18n/`.
- Every finding: `path:line` → problem → why it matters → concrete fix. AI review is advisory; a human approves.

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
node scripts/check.mjs                                 # from the repo root, before every PR
```

Web specifics (accounts, i18n, background jobs, publishing) are in `web/AGENTS.md`; docproc commands and invariants in `-/docproc/AGENTS.md`; media in `media/AGENTS.md`.

## Team setup and the LLM

Every machine is self-contained; no machine serves another. Only the project owner's own machine has a GPU (RTX 3090), and it is private: nobody else reaches it. Lesson videos (NAMAA TTS + `hlmedia`) render only there, by its owner. Never install CUDA torch or run `hlmedia` on a teammate laptop.

- A teammate on Linux, macOS or Windows (needs git, Node 22+, pnpm, uv, Docker) picks any OpenAI-compatible LLM endpoint (e.g. OpenRouter with their own key, or Ollama on their own machine) and runs `LLM_BASE_URL=<…/v1> LLM_MODEL=<model> LLM_API_KEY=<key> DEMO_PASSWORD=<min 8 chars> LLM_PRICES_USD_PER_MTOK='{"<model>":{"input":<USD/Mtok>,"output":<USD/Mtok>}}' node scripts/setup-teammate.mjs` (PowerShell: set each with `$env:NAME="…";` first, in single quotes for the JSON of `LLM_PRICES_USD_PER_MTOK`): local Postgres, docproc with CPU torch (EmbeddingGemma on CPU, same 768-d vectors), web and docproc pointed at that endpoint, and the team git hooks. EmbeddingGemma is a gated Hugging Face model: accept its licence and run `hf auth login` first. Codex users trust the project once so `.codex/hooks.json` runs.
- If the LLM endpoint is unreachable, LLM calls fail. That is expected; do not add fallbacks.
- Video features are verified by the GPU machine's owner before a media PR merges.
- Parallel agents on one machine (one worktree and branch each) share its Postgres container and GPU: they must not run migrations or renders at the same time. `.worktreeinclude` copies the `.env` files into Claude Code worktrees.

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
