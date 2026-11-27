# A2c · Cost and time per document

**Tier:** Enhanced (a scoreboard metric computed from the pipeline's logs; lane spec) · **Owner:** Yasser (@altayariyasser) · **Branch:** `feat/a2c-cost-time`, stacked on `feat/a2a-generation-eval` (A2a)

**Approved:** _pending @superMohammad_

## Problem
The architecture promises "cost per document" and "time per document" on the scoreboard. A2b (#19) made it possible: every web AI call in `ai_calls` now has its document, version and tokens, and prices come from `LLM_PRICES_USD_PER_MTOK`. Nothing turns those rows into the two numbers yet.

## What the code does today (facts the design depends on)
- **First upload (v1):** the background run does `understand` (docproc), then `procedures` (LLM titles), and **stops**. Training is generated only when the admin clicks "generate" for each procedure (`runGeneration`, one `generate:<title>` job each). So v1's wall-clock time includes however long the admin waits before clicking.
- **New version (v2):** the run does `understand`, then `update`. `update` carries unchanged and moved procedures over (event `carried_over`, "zero AI cost") and regenerates the changed ones automatically. So v2 is ready for review when `update` finishes.
- **docproc's AI calls are not logged anywhere.** Its clients (`-/docproc/src/docproc/llm/`) don't record token usage, so extraction and the change judge cost is invisible. On A2b you decided that logging belongs in a separate PR.
- **Two places where web's log under-counts:**
  - `ai.ts` retries a failed call up to 3 times, but only the successful attempt is inserted. Tokens spent on failed attempts are lost (noted in A2b).
  - A missing `usage` is logged as 0 (`?? 0`). Ollama and OpenRouter return usage, so this is rare, but it is indistinguishable from a real 0.
- **With local Gemma, the price is 0**, so the dollar cost is exactly 0. Tokens and time are the meaningful numbers there.

## Approach
1. **A pure module, `web/src/lib/cost-time.ts`**, with no DB and no `server-only`, so `pnpm test` covers it. Given the `ai_calls` rows, the `pipeline_jobs` rows, the package and carry-over counts of one document version, and the price table, it returns:
   - **Cost:** input and output tokens and dollars (`costUsd()` from A2b), in total and split by purpose (`understand.name_procedures`, `generate.package`, `verify.judge`). It also reports **rework**: the number of packages regenerated after a reviewer rejected one (packages beyond the first per procedure, from `training_packages`). `ai_calls` has no procedure column, so rework **cost** is an estimate (regenerations × the version's average cost per package) and is labelled as one.
   - **Time**, as two numbers, because v1 includes the admin's waiting time:
     - **processing time** = the sum of the version's job durations (`finished_at − started_at`) = machine time, with no waiting for clicks;
     - **elapsed time to "ready for review"** = the first `pipeline_jobs` row (`queued`) → the moment **every procedure of the version has a package** (the latest of those packages' creation times). If some procedure has no package yet, it is `null` ("not ready"), not a guess.
   - **v2 carry-over saving** (A2d shows it): carried procedures × the average cost per procedure of first-time generation in the version they came from, plus the same in tokens. It is labelled an estimate. If the source version has no logged generation, it is `null`.
   - **Coverage flags**, so a number never hides a gap: `docproc_calls_not_logged: true` (until that PR exists), the count of calls with 0 tokens, failed jobs, and calls with a model that has no price (an error names the model, as `costUsd()` already does; never a silent 0).
2. **A thin DB reader, `web/src/lib/cost-time-db.ts`** (`server-only`), loads those rows for one version or for all versions, using the app's normal `sql()` pool. **No new grants:** `ai_calls` stays invisible to `hl_readonly`, and nothing is exposed to learners. The scoreboard (A2d) calls this from an admin-only page.
3. **A report command, `pnpm report:cost-time`** (`web/scripts/report-cost-time.mts`), writes `-/docproc/out/cost_time.json` next to the eval outputs (git-ignored) for every version in the database, plus averages per document, by role and language, and for v1 versus v2. It prints a short summary. This is what the PR's evidence shows, from a real run on your machine (upload the dev documents, generate, upload v2).
4. **No migration, no change to `ai.ts`, `pipeline.ts` or docproc** in this PR. The under-counts above are reported as coverage flags, and fixing them is listed under open questions.

## Acceptance criteria → checks
- Given `ai_calls` rows for one version (two purposes, known tokens) and a price table, then tokens, dollars and the split by purpose are exact → unit test, written first.
- Given a model with no price, then the result names the model as an error → unit test.
- Given jobs `queued`, `understand`, `procedures` and two `generate:*` jobs with gaps between them, then processing time = the sum of durations and elapsed = queued → last package → unit test.
- Given a version where one procedure has no package, then elapsed is `null` (not ready) and processing time is still reported → unit test.
- Given a v2 with 3 carried and 1 regenerated procedure, and v1's average generation cost known, then the saving = 3 × that average; with no v1 generation logged, it is `null` → unit test.
- Given a procedure with two packages (one rejected, one regenerated), then rework = 1 regeneration and its estimated cost = 1 × the average cost per package → unit test.
- Given calls logged with 0 tokens, then the coverage count shows them → unit test.
- Given seeded rows in a throwaway database (`test:db`, no LLM needed), when the reader and `pnpm report:cost-time` run, then the JSON matches the pure module's result for the same rows, and calls with a NULL document (readiness text-to-SQL) are excluded → DB test in `web/db/tests/`, run in CI's `web-e2e`.
- `node scripts/check.mjs` passes, and two fresh-context reviews have no open must-fix.

## Files
- `web/src/lib/cost-time.ts`, `web/src/lib/cost-time.test.ts`: new (pure computation and unit tests).
- `web/src/lib/cost-time-db.ts`: new (reader).
- `web/scripts/report-cost-time.mts`: new (JSON report).
- `web/db/tests/cost-time.test.ts`: new (DB test, reusing the helpers file planned in A2a).
- `web/package.json`: `report:cost-time` script.
- Command documented where A2a's is (decided in A2a's question 6).

## Feature-map rows
None. No UI changes; the scoreboard page is A2d.

## Eval delta
No pipeline code changes, so `docproc eval --real` is unchanged by construction.

## Risks / rollback
- **Cost data visibility:** only the admin pool reads it; no grants change; A2d's page re-checks the admin session.
- **Under-counting** (docproc not logged, failed attempts lost, possible 0-token rows): reported as explicit coverage flags in the JSON and to be shown on the scoreboard, instead of a number that looks complete.
- **Rollback:** delete the new files and the `package.json` line. There is no migration and no behaviour change.

## Open questions for @superMohammad
1. **docproc's cost.** Should A2c report web-only cost with the `docproc_calls_not_logged` flag, or should docproc's logging come first? If first: who does it? I can. My proposal: docproc returns each call's tokens and duration in its JSON result, and web writes them into `ai_calls` with purpose `docproc.extract` / `docproc.change_judge`. That keeps a single writer and needs no new table. It is a separate PR that touches docproc's LLM clients.
2. **Failed attempts' tokens.** Should `ai.ts` log failed attempts too? That needs a column such as `outcome`, which is a migration and therefore High-risk; it would be a separate PR. Or is reporting the gap enough for the hackathon?
3. **Which time goes on the scoreboard?** I propose **processing time** as the headline (it doesn't depend on how fast someone clicks), with elapsed time shown next to it. For v2 the two are nearly the same, because everything runs automatically.
4. **Dollars with local Gemma are 0.** Should the scoreboard also show a "what it would cost if hosted" figure, using the same token counts priced at one named hosted model (an extra entry in `LLM_PRICES_USD_PER_MTOK`, chosen by you)? Or tokens and $0 only?
5. **The v2 saving estimate** (carried procedures × v1's average cost per procedure): is that definition OK for the "cost saved" number A2d shows?
6. **Real run:** the numbers need the real pipeline (upload the dev documents, generate every procedure, upload the v2s) on your machine, then `pnpm report:cost-time`. OK to ask you for that run when the PR is ready?

## Out of scope
- docproc call logging and failed-attempt logging (questions 1 and 2: separate PRs if wanted).
- The scoreboard page (A2d).
- Changing prices or models.
