# HungerLearn web (MVP)

Next.js 16 app for the six stages in `../hunger-learn-mvp-architecture.md`. Setup, commands, and runtime notes are in the root `CLAUDE.md` ("Running the MVP").

| Stage | Route | Code |
|---|---|---|
| 1 Understand · 6 Version update | `/trainer`, `/trainer/documents/[id]` | `src/lib/docproc.ts`, `src/lib/pipeline.ts` |
| 2 Generate + verify, explainer video | (background) | `src/lib/generation.ts`, `src/lib/media.ts` |
| 3 Human approval, audit log | `/trainer/review` | `src/lib/review.ts` |
| 4 Learn & prove mastery | `/learn`, `/learn/[id]` | `src/lib/compose.ts`, `src/lib/learning.ts` |
| 5 Readiness, ask in Arabic | `/trainer/readiness` | `src/lib/readiness.ts`, `src/lib/sql-guard.ts` |

## Generation eval

`pnpm eval:generation [--documents id1,id2] [--out file.json] [--keep-db]` runs the app's real procedure naming and package generation (`src/lib/generation.ts`) on the gold clauses of the dev originals in `../data/synthetic_sops/` (`split: dev`, `variant: original`; `held_out/` is never read) and scores what it wrote (`src/lib/generation-eval.ts`):

- **Citation accuracy:** the share of items whose every citation quotes its clause, with the app's check (`quoteInClause`) and with an exact check in which printed digits must match (`١٥` ≠ `15`). A quote that only matches after normalization is marked `quote_digits_differ` (digits) or `quote_not_exact` (punctuation, spacing, diacritics).
- **Silent failures** (scoreboard headline, target 0): items marked `verified`, so the trainer sees no warning, that still fail a check.
- **Publishable with a failed check** (target 0): items failing a check that `canPublishWithFlags` (`src/lib/publication-rules.ts`) still lets a trainer approve and publish.

It needs a real LLM (`.env.local`) and writes `../-/docproc/out/eval_generation_dev.json` next to `docproc eval`'s output, broken down by document, language, role and v1/v2 versus v3. AI calls are logged in a throwaway database `hl_eval_<random>` on `DATABASE_URL`'s server, which the run creates and drops (`--keep-db` keeps it). The app's own database is never written. Stopping a run with Ctrl-C skips the drop: the database name is printed at the start, so drop it by hand (`DROP DATABASE hl_eval_… WITH (FORCE)`). The migrations it runs also create the app's server-wide read-only role if the server has none yet, exactly as `pnpm db:migrate` does. A run where any procedure failed (for example, the LLM was unreachable) still writes the JSON but exits with code 1.

## Cost and time per document

`pnpm report:cost-time [--hosted-model <model>] [--out file.json]` reads the app database (read-only) and writes `../-/docproc/out/cost_time.json` with, for every document version (`src/lib/cost-time.ts`):

- **Cost:** AI calls, input and output tokens and dollars, split by purpose. Dollars are tokens × `LLM_PRICES_USD_PER_MTOK`, computed when the report runs, so a corrected price fixes every report. A call with a model that has no price fails the report with the model's name, so it is never counted as $0. With local Gemma the dollars are 0. `--hosted-model` (a model in `LLM_PRICES_USD_PER_MTOK`, such as the one teammates use on OpenRouter) also prices the same tokens at that model, labelled an estimate.
- **Time:** **processing** (the scoreboard headline) is the sum of the version's `pipeline_jobs` durations, i.e. machine time. **Elapsed to ready** runs from the version's first job until every procedure has its first package. It is `null` while any procedure has none. For a first upload it includes the wait for the admin's "generate" clicks.
- **Packages:** generated, carried over from the previous version, and regenerated after a reject. The **rework** cost and the **v2 carry-over saving** (carried procedures × the previous version's average generation cost per package) are estimates, because `ai_calls` does not record the procedure.
- **Coverage:** docproc's LLM calls (extraction, change judge) are not logged yet, so this is web-only cost. Zero-token calls, failed jobs and running jobs are counted, so no number looks more complete than it is.

The summary averages first uploads and updates separately.
