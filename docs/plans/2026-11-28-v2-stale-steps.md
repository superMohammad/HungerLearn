# Fix: a changed procedure keeps its old steps after a v2 upload

**Tier:** Enhanced (pipeline change in `web/src/lib/pipeline.ts`, plus one new LLM call per changed procedure) · **Owner:** Yasser (@altayariyasser) · **Branch:** `fix/v2-stale-steps` (from `main` at 302f803)

**Approved:** @vGolden25 (PR review, under the peer-approval rule from #33); the plan itself was approved by @superMohammad on 2026-11-28 (on [#32](https://github.com/superMohammad/HungerLearn/issues/32): "stale steps 1 steps only, 2 yes, 3 yes")

## Problem
Found by Mohammad in the F07 run for #17: after uploading `courier-pickup-wait-v2`, the changed procedure's steps still say «…بعد ١٥ دقيقة», while its rule CW-02 now says 10 minutes. The regenerated draft was then flagged `contradiction` and needed a reviewer.

**Cause (`web/src/lib/pipeline.ts`):**
- `carryProcedures` copies every old procedure's **title and steps** into the new version (`pipeline.ts:129`), also when its clauses changed.
- `applyNewVersion` then regenerates the changed procedure with `generatePackageFor`, and `draftPackage` gives the generator `procedure.steps` (`generation.ts:174`). The generator sees the old steps («15 minutes») next to the new clause (10 minutes).

**The stale steps reach people:**
- the admin's document page lists them (`app/[lang]/admin/documents/[id]/page.tsx:166`);
- learners get them as the **fallback lesson** when a lesson spec is missing (`learning.ts:76`).

**Every new version, not only v2:** `carryProcedures` runs for each upload after the first, so v2 → v3 hits the same bug. Mohammad's B7 run uploads `courier-pickup-wait-v3` (17 procedures) over v2, so its changed procedures will show stale steps until this is fixed.

**A second gap:** a changed procedure with no package yet is skipped (`pipeline.ts:152`, `pkg === undefined`), so it keeps stale steps too, with no regeneration to expose them.

## Approach
1. **Refresh the name and steps of every procedure that doesn't carry over**, from the new version's clauses, before its package is regenerated. Unchanged and moved procedures keep their title and steps exactly as now (zero AI cost, no change).
2. **Reuse the existing naming call** instead of a new prompt. Split `groupProcedures` (`generation.ts`) into:
   - the deterministic grouping (unchanged);
   - a naming step that can name one given group of clauses: `nameProcedure(doc, versionId, clauses)`, returning `{ title, steps }`, with the same prompt (`understand.name_procedures`), the same validation (no clause ids in learner text, non-empty steps) and the same 3 attempts.

   `groupProcedures` keeps its behaviour, and its existing tests must stay green.
3. **Keep the title by default and refresh only the steps.** The title is the procedure's name for learners and appears in the change notice («{title} was updated…»). The naming prompt already forbids numbers in titles, so a title can't carry a stale number. Approved as decision 1.
4. In `applyNewVersion`, for each old procedure whose `next` doesn't carry over: refresh the steps (an `UPDATE procedures SET steps = … WHERE id = next.id`) **before** `generatePackageFor`, so the generator and the fallback lesson see the new steps. This includes the case with no package.
5. **Cost:** one naming call per changed procedure, logged in `ai_calls` with the new version (A2b), so A2c counts it.

## Acceptance criteria → checks
- Given v1 with a procedure whose steps say "15 minutes", and a v2 where its clause changes to 10 minutes, when the v2 update runs, then the v2 procedure's steps come from the new clauses (a fake LLM answers with steps saying 10), and the package generator's input contains the new steps, not the old → DB test in `web/db/tests/` with the fake LLM, written first.
- Given an unchanged or moved procedure, then its title and steps are copied exactly and no naming call is made for it → same DB test (the `ai_calls` purposes for that procedure).
- Given a changed procedure that had no package, then its steps are refreshed too → DB test.
- Given a naming call that fails 3 times, then the update job fails with the procedure named in the error, not silently with old steps → DB test.
- `groupProcedures` behaves exactly as before → the existing tests and the `ai-call-scope` DB test stay green.
- Real check on the GPU machine (it needs the real LLM), by Mohammad, in Arabic and English:
  - his **B7 v2 → v3 run** (`courier-pickup-wait-v3` over v2): every changed procedure shows steps from the v3 clauses on the document page, with no `contradiction` flag caused by stale steps;
  - `verify-app` F07 (v1 → v2): no `contradiction` flag from stale steps on CW-02.
- `node scripts/check.mjs` passes; two fresh-context reviews have no open must-fix.

## Files
- `web/src/lib/generation.ts`: extract `nameProcedure` from `groupProcedures` (no behaviour change for `groupProcedures`).
- `web/src/lib/pipeline.ts`: refresh the steps of non-carried procedures in `applyNewVersion`, before regeneration, including those without a package.
- `web/src/lib/repo.ts`: `updateProcedureSteps(id, steps)`.
- `web/db/tests/v2-steps.test.ts`: new DB test with the fake LLM (shared `db/tests/helpers.ts`).

## Eval delta
docproc is unchanged, so `docproc eval --real` doesn't move. The effect shows in the web pipeline: F07 on the GPU machine. A useful number for the PR: the count of `contradiction` flags on the regenerated v2 packages before and after (Mohammad's F07 run had 1 on CW-02).

## Risks / rollback
- **One extra LLM call per changed procedure** (usually 1–3 per update), logged and costed. With the LLM down, the update fails loudly (no fallback), the same as regeneration does today.
- **Title stability:** titles are kept, so notices and learner progress still name the same procedure.
- **Rollback:** revert the PR. No migration and no data change. Steps written by the fixed code are just newer text.

## Decisions (@superMohammad on #32, 2026-11-28)
1. **Steps only:** a changed procedure keeps its title; only its steps are refreshed.
2. **A moved procedure keeps its steps**, like its training.
3. **Real check:** he reruns his B7 v2 → v3 upload (and F07, v1 → v2) on the 3090 after the fix.

## Out of scope
- Changing the naming prompt or the generator prompt.
- Re-checking titles or steps of procedures that carry over.
