# A2d · Admin scoreboard page

**Tier:** Enhanced. The lane spec says Standard, but the diff is about 610 lines (page, dictionaries, tests), and pr-policy counts more than 400 changed lines as Enhanced. While A2c (#30) is open, the gate also counts A2c's lines, because it compares with `main`. · **Owner:** Yasser (@altayariyasser) · **Branch:** `feat/a2d-scoreboard`, stacked on `feat/a2c-cost-time` (A2c, #30)

**Approved:** _pending @superMohammad_

## Problem
The architecture promises judges five numbers on a scoreboard: rule extraction recall, citation accuracy, 0 published hallucinations, cost per document and time per document, plus the money a v2 update saves. A2a (#25) and A2c (#30) compute them into JSON files, but no page shows them.

## Approach
1. **Read the three result files** the team's commands already write into docproc's `out/` folder (`DOCPROC_DIR/out`). There is no new data path and no database read:

   | File | Command | Metrics |
   |---|---|---|
   | `eval_dev_real.json` | `docproc eval --real` | rule extraction recall (`macro_recall`, with precision, and how many documents it covers versus skipped) |
   | `eval_generation_dev.json` | `pnpm eval:generation` (A2a) | citation accuracy; silent failures (headline, decision 2 on #21) with flagged-but-publishable items next to it |
   | `cost_time.json` | `pnpm report:cost-time --hosted-model <model>` (A2c) | cost per document (with the hosted estimate and the docproc-not-logged note), time per document (processing headline, elapsed next to it), v2 saving (estimate) |

2. **A pure module, `web/src/lib/scoreboard.ts`**, checks each file with zod and turns it into what the page shows. `pnpm test` covers it.
   - A **missing** file is "not run yet", with the exact command that produces it.
   - A **broken** file (bad JSON, wrong shape, malformed date) names the file and the problem.
   - A `null` in a report stays "not available". Neither case ever becomes a number or 0.
3. **Honest headlines.**
   - A generation run with failed documents or procedures shows "the run did not finish" and the counts on its cards. A partial run can't pass as a clean 0.
   - Recall shows "documents scored: n / n+k", with a warning when docproc skipped some (scans without OCR).
4. **The page `/admin/scoreboard`:**
   - an admin-only Server Component (`ensureAdmin` inside Suspense with the shared Skeleton) and a nav link;
   - six cards, in Arabic (default, RTL) and English, with every string in `src/lib/i18n/{ar,en}.ts`;
   - big monospace numbers, no charts;
   - each number names its source file, date (for docproc's report, the file's save time) and model;
   - numbers and Latin names inside Arabic text are isolated left to right (`<bdi>`, U+2066/U+2069).

## Acceptance criteria → checks
- The three files are read into the five metrics and the saving → unit test.
- A missing file gives "not run yet" with its command; a broken file names the problem; one broken file doesn't hide the others → unit tests.
- A report's nulls stay null, never 0 → unit test.
- Failed documents or procedures and skipped documents are reported → unit tests.
- A malformed date makes the file invalid → unit test.
- The real producers' output (`buildReport`, `buildCostTimeReport`) is read as ok → contract test.
- An admin sees six cards in Arabic (RTL) and English (LTR), each "ok" (with a number) or "missing" (with its command), never "invalid"; a learner and anonymous visitors are sent to sign-in → feature-map row F08 and its e2e test, plus the F02 guard test, via `verify-app`.
- `node scripts/check.mjs` passes, and two fresh-context reviews have no open must-fix.

## Files
- `web/src/lib/scoreboard.ts`, `web/src/lib/scoreboard.test.ts`: new.
- `web/src/lib/scoreboard-files.ts`: new (`server-only`; reads the files, and only "file not found" becomes "missing").
- `web/src/app/[lang]/admin/scoreboard/page.tsx`: new. `web/src/app/[lang]/admin/layout.tsx`: nav link.
- `web/src/lib/i18n/ar.ts`, `en.ts`: the page's strings.
- `docs/feature-map.md`: row F08. `web/e2e/feature-map.spec.ts`: F08, and `/admin/scoreboard` in the anonymous-redirect test.

## Risks / rollback
- **Read-only:** the page only reads three files; it writes nothing and runs no query.
- **Stale numbers:** each card shows its file's date and model, so an old run is visible as old.
- **Rollback:** revert the PR. There is no data, migration or behaviour change elsewhere.

## Eval delta
None by construction: no pipeline, prompt or docproc change.

## Open questions for @superMohammad
1. Approve this as Enhanced (by size), with the plan above?
2. Is reading the result files from `DOCPROC_DIR/out` right for the demo machine, rather than a live database view? The files are what the judges' numbers come from, and each card shows its date.
