# A2a · Generation eval: citation accuracy and items publishable with a failed check

**Tier:** Enhanced (new eval over the generation pipeline, two packages touched: `web/` code, output beside `-/docproc/out/`) · **Owner:** Yasser (@altayariyasser) · **Branch:** `feat/a2a-generation-eval` (from `main` at cd3f72a, after #17 and #19; `main` merged in at fe68425 for #22's v3 documents)

**Approved:** @superMohammad 2026-11-27 (issue #21)

**Decisions (Mohammad, 2026-11-27, issue #21):**
1. **Publishable rule:** add a pure `canPublishWithFlags(flags)` in `review.ts` that returns `true` today, used by `approveItem` and `approvePackage`, so C's gates change one place.
2. **Scoreboard headline:** `silent_failures`, with `publishable_with_failed_check` next to it.
3. **Input:** gold clauses for now; an end-to-end mode (docproc → generation) comes later.
4. **Partner type:** `restaurant` for both partner families (Copper Olive Kitchen).
5. **Real run:** Mohammad runs it on the 3090 with `gemma4:latest`.
6. **Docs:** the command goes in `web/README.md`, not `AGENTS.md`, so the PR stays Enhanced.
7. **Change since the plan (#22):** there are now **12** dev originals, the 9 v1/v2 plus 3 v3 originals of 28–29 pages. Include v3 and report v1/v2 and v3 separately. Score only `variant == "original"`; skip format copies, translations and scans.

## Problem
The architecture promises five scoreboard numbers. `docproc eval` measures extraction recall, but nothing measures what the **generator** writes. So two of the promised numbers have no source:
- **Citation accuracy:** does each generated item's quote really appear in the clause it cites?
- **0 published hallucinations:** can an item that failed a check still reach learners?

## Approach
A script that runs the **app's own generation code** on the dev documents and scores the result. There is no copy of the pipeline, so a change to the generator or its checks shows up in the score immediately.

1. **Input: the dev gold clauses, not docproc's output.** For each dev document in `data/synthetic_sops/manifest.json` with `split: "dev"` and `variant: "original"`, the clauses come from `dev/gold/extraction.json`. That gives 12 documents: 9 v1/v2 and 3 v3 (decision 7). Scans, format copies and translations are skipped. `held_out/` is never opened, and the loader rejects any path outside `dev/`.
   - **Why gold clauses:** extraction recall is still 0.42 offline, so with docproc's output most procedures would be missing or partial, and the score would mix extraction errors with generation errors. AGENTS.md asks for each stage to be scored on its own. End-to-end (docproc → generation) is a later option; see open question 3.
   - **Only source text reaches the model.** Each gold clause becomes a `Clause` with `quote` = the document text, `heading` = the section from its locator, and `clauseNumber` = the first number in that section (`«القسم ٦: …»` → `٦`, `«2. Escalate…»` → `2`), so the app's `groupBySection` groups v3's several clauses per section exactly as it would docproc's output. Gold `facts` are never passed. The model sees `C1`, `C2`… refs (as in the app), never gold clause IDs.
2. **Run the real pipeline:** `groupProcedures(doc, versionId, clauses)` (deterministic section grouping plus LLM titles and steps), then `buildPackage(doc, procedure, clauses, "")` for each procedure, exactly as `pipeline.ts` does. Each item gets the status `pipeline.ts` would give it: `verified` with no flags, otherwise `draft` (including `needs_human`). `buildPackage` is used unchanged.
3. **Throwaway database.** Since A2b, every AI call is logged in `ai_calls` with an FK to `hl_documents`. The script creates `hl_eval_<random>` on `DATABASE_URL`'s server, runs migrations, inserts one `hl_documents` row per dev document (role and language from the manifest), and drops the database at the end (`--keep-db` keeps it for inspection). The app's real database is never written. Token totals per document are read from `ai_calls` before the drop and stored in the JSON (raw tokens only; dollars and time are A2c).
4. **Score (a pure function, `web/src/lib/generation-eval.ts`):**
   - **Citation accuracy** = items whose every citation passes ÷ all items. A question has one citation (`clause_id` + `quote`); a lesson passes only if **all** its key points and shots pass. "Passes" means the cited ref is a clause of this procedure and `quoteInClause(quote, clause.quote)` is true, the same check the app uses. Also reported:
     - per citation, not just per item;
     - **exact** (the raw quote is a substring of the raw clause, so printed digits must match: `١٥` ≠ `15`), next to the app's normalized check. AGENTS.md says "match printed digits exactly in a quote", and today's normalized check folds digits.
   - **Items publishable with a failed check (target 0):**
     - **failed check** = any flag the app's gate sets (`quote_not_found`, `unknown_clause_ref`, shape rules, `judge_unsupported`, `needs_human`, …) **or** a citation that fails the scorer's exact check;
     - **publishable** = what today's publish rules allow, decided by calling the app's rule, not a copy (see open question 1).
     - Reported in two parts:
       - **`silent_failures`:** items marked `verified` (they look clean to the trainer) that fail the exact citation check. This is a true leak and should be 0.
       - **`publishable_with_failed_check`:** flagged items that a trainer's "approve package" would still publish. Today `review.ts` approves flagged items "despite flags", so this number is **expected to be above 0** until the deterministic publication gates (teammate C's lane) land. It is the number those gates should drive to 0.
   - Breakdowns by document, language, role and **generation (v1/v2 versus v3)**; also counts of skipped packages (`status: "skipped"`) and procedures that failed to generate (an error is recorded with its message, never silently dropped).
   - An empty denominator gives `null`, never `NaN` or 0.
5. **Output:** `-/docproc/out/eval_generation_dev.json`, next to `eval_dev_*.json` (`out/` is git-ignored). It records the LLM model, the `LLM_BASE_URL` host, prompt version `training-generator-v3`, git commit, date, per-document and per-procedure results, and every failed item with its flags, quote and cited clause, so a reviewer can read why it failed. The script also prints a short summary.
6. **Command:** `pnpm eval:generation` in `web/` (`tsx --env-file=.env.local --conditions=react-server scripts/eval-generation.mts`), with an optional `--documents courier-pickup-wait-v2,…` to run a subset.

## Who runs it
It needs a real LLM: about 9 documents × ~10 procedures plus 3 v3 documents × ~17 procedures, × ~8 calls each, ≈ 1,100 calls. Yasser's laptop (4 GB GPU) cannot run Gemma 4, so:
- **CI and local tests** use the fake OpenAI-compatible server from A2b's `test:db`. They prove the scorer and the wiring, not model quality.
- **Real numbers:** @superMohammad runs `pnpm eval:generation` on the 3090 with `gemma4:latest`, or Yasser runs it against OpenRouter. The PR shows the numbers from that run.

## Acceptance criteria → checks
- Given a package where one question's quote is not in its cited clause, then citation accuracy counts it as failed and lists it → unit test (written first).
- Given a lesson where one of three citations fails, then the lesson counts as one failed item and the per-citation numbers show 2/3 → unit test.
- Given a quote `15` cited from a clause that prints `١٥`, then the normalized check passes and the exact check fails, and the item counts as a failed check → unit test.
- Given a `verified` item that fails the exact check, then `silent_failures` = 1 → unit test.
- Given a flagged `draft` item, then `publishable_with_failed_check` counts it while the app's rule lets approved flagged items publish → unit test that calls the app's rule, so the test changes when the gate does.
- Given a skipped package, or zero items, then it is counted as skipped and rates are `null` → unit test.
- Given the dev manifest, then the loader returns the 12 original dev documents (9 v1/v2, 3 v3), no scans, format copies or translations, nothing from `held_out/` → unit test.
- Given a v3 document, then its clauses are grouped into the same procedures as the gold (several clauses per section) → unit test.
- Given the fake LLM server and one dev document, when `pnpm eval:generation --documents <id>` runs, then the JSON is written with the expected shape, `ai_calls` rows carried that document's ID, and the `hl_eval_*` database is gone afterwards → `test:db` test, run in CI's `web-e2e` job.
- `node scripts/check.mjs` passes, two fresh-context reviews have no open must-fix, and the real-LLM numbers are pasted in the PR.

## Files
- `web/src/lib/generation-eval.ts`: new. Gold loading (dev only) and pure scoring.
- `web/src/lib/generation-eval.test.ts`: new, unit tests.
- `web/scripts/eval-generation.mts`: new. Throwaway DB, runs the pipeline, writes the JSON.
- `web/db/tests/generation-eval.test.ts`: new, end to end with the fake LLM. The fake server and DB helpers from `ai-call-scope.test.ts` move to `web/db/tests/helpers.ts`, as a separate refactor commit with no behaviour change.
- `web/package.json`: `eval:generation` script.
- `web/src/lib/review.ts`: a pure exported `canPublishWithFlags(flags)` (returns `true`), used by `approveItem` and `approvePackage`; no behaviour change (decision 1).
- `web/README.md`: documents the command (decision 6).
- **Not touched:** `generation.ts`, `pipeline.ts`, prompts, migrations, `.github/` (the `test:db` step already runs `db/tests/*.test.ts`).

## Feature-map rows
None. No UI or app flow changes; the scoreboard page is A2d.

## Eval delta
This PR adds an eval and changes no pipeline code, so `docproc eval --real` before and after is unchanged by construction. The PR says so instead of asking you for the run.

## Risks / rollback
- **Writes to the shared Postgres server:** only into its own `hl_eval_<random>` database, dropped in a `finally` block. A crash can leave one behind; the name makes that obvious, and `--keep-db` aside, the script prints the name at start.
- **LLM cost on OpenRouter:** about 1,100 calls per full run; `--documents` limits a run.
- **Nondeterminism:** one run is one sample. The JSON records the model and prompt version; repeated runs can be compared, but averaging over runs is out of scope.
- **Rollback:** delete the new files and the `package.json` line. Nothing else depends on them yet (A2d will read the JSON).

## Open questions for @superMohammad (answered above, under Decisions)
1. **Which rule decides "publishable"?** There is no gate function today: `approveItem` / `approvePackage` approve flagged items "despite flags". My proposal: export a tiny pure function from `review.ts`, e.g. `canPublishWithFlags(flags): boolean` (today it returns `true`), use it in `approveItem` / `approvePackage` with no behaviour change, and have the scorer call it. When C adds deterministic gates, they change that one function and the eval follows. `review.ts` is C's area, so I'd keep the change to that extraction only. OK, or should the scorer define "publishable" itself for now?
2. **Which number is the scoreboard's "0 published hallucinations"?** I propose `silent_failures` as the headline (should be 0 today), with `publishable_with_failed_check` shown next to it as what the gates must still close. Or do you want the stricter one as the headline?
3. **Gold clauses as input:** OK to score generation on gold clauses now, and add an end-to-end mode (docproc's clauses) later?
4. **Partner type:** the manifest has no `partner_type`, which `hl_documents` requires for partner documents. Is `restaurant` right for `partner-packing-sealing` and `partner-item-substitution`, or is one of them a `cafe`?
5. **Real run:** will you run `pnpm eval:generation` on the 3090, or should I use OpenRouter (prices then go in `LLM_PRICES_USD_PER_MTOK`)?

## Out of scope
- Cost in dollars and time per document (A2c), and the scoreboard page (A2d).
- Changing the generator, its prompt, or the publication gates (C's lane).
- Human review of scenario realism and Arabic quality (AGENTS.md lists it as a human rubric, not an automatic score).
- Logging docproc's LLM calls (Mohammad's decision on A2b: separate PR).
