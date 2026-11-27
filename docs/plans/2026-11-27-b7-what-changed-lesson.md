# B7 — "What changed" lesson and badge recheck after a new SOP version

**Risk tier:** Enhanced. This is a stage 6 pipeline change plus a learner-flow change in `web/`, with browser tests for F05 and F07. The recommended option touches no High-risk path: no migration, and no change to `readiness.ts`, `readiness_v`, `hl_readonly`, `session.ts` or `db.ts`. If Mohammad picks storage option B (decision D1), its migration ships first as its own High-risk PR.
**Approved:** @superMohammad, 2026-11-27

## Goal

This is stage 6, step 5 of `hunger-learn-mvp-architecture.md`: "Notify affected learners: a 'what changed' lesson, and their badges are re-checked."

A learner who had started or mastered a procedure whose clauses changed will see a "What changed" lesson with the old and new clause text before they take the new exam. Their badge is suspended until they pass the new exam, then restored on the new version.

## Decisions already made (Mohammad, 2026-11-27)

1. **B9:** one badge per mastered procedure on `/learn`. The existing `mastery` row is where badge storage starts. A migration is proposed only if the required behaviour needs more storage.
2. **What the lesson shows:** only `changed`, `added` and `removed` clauses that affect the learner's procedure. Moved and unchanged clauses are left out.
3. **Who sees it:** learners who had started (`in_progress`) or mastered the affected procedure. It is shown before the new exam, once the revised training is published.
4. **Reset bug:** B7 fixes the `needs_refresh` reset, so the state stays until the learner passes the new exam. The loss of mastery on carried-over (unchanged or moved) procedures is a separate B8 follow-up, outside B7.

## What exists today (read from the code)

- **How `applyNewVersion` (`web/src/lib/pipeline.ts`) handles a procedure.** It handles each procedure in one of two ways:
  - **Carried over:** every cited clause is `unchanged` or `moved`, and none dropped out. The package is copied to the new version and mastery is left as it is.
  - **Changed:** the package is regenerated as drafts. Rows with `state IN ('mastered', 'in_progress')` become `needs_refresh` with `version_id` set to the new version, and each of those learners gets a `notifications` row.
- **Rows already in `needs_refresh` are not touched by a later upload.** Their `version_id` stays at the version that started the refresh, and they get no new notification.
- **docproc stores one comparison per version** in `comparisons (document_id, new_version_id, old_version_id, report)`. The report has each clause's `status`, `old.quote`, `new.quote`, headings and `change_reasons`. So the lesson can be built from stored data, with no AI call.
- **The reset bug (fixed here).** `record()` in `learning.ts` overwrites the state with `masteryState()`, which returns only `mastered` or `in_progress`. One wrong answer turns a `needs_refresh` learner into `in_progress`. That drops the marker in `/learn` and in readiness, and it hides the what-changed lesson.
- **Timing.** Between the upload and the admin publishing the regenerated package, the changed procedure has no published items in the current version, so it is not listed on `/learn`. The lesson therefore only becomes reachable once the revised training is published (decision 3). The notification is still sent at upload time. That ordering is out of scope.

## Behaviour after B7

| Before the new version | Procedure in the new version | Learner sees | Badge |
|---|---|---|---|
| `mastered` or `in_progress` | changed | After publish: the "What changed" lesson, then the normal lesson, practice and exam on the new items | `needs_refresh`, so not counted. Back to `mastered` (on the new version) once every exam item's latest attempt is correct |
| already `needs_refresh` | changed again | The combined changes since the version they last learned (see Skipped versions), plus a new notification | stays `needs_refresh` until they pass |
| `not_started` | changed | Normal flow. No what-changed lesson | none |
| any | carried over | Unchanged by B7 (see B8 follow-up) | unchanged by B7 |

### The "What changed" lesson

- **New screen kind.** It is a new `ScreenSpec` variant, `what_changed`, built by a pure function `whatChangedScreen(hops, procedureStableIds)` in `carry-over.ts`.
- **Clauses it lists.** It lists each clause the procedure cites, in the version the learner last learned or in the current one, whose net status is:
  - **changed:** "Before" shows the old quote and "After" the new quote. The change reasons come from `reasonLabel`, with "location changed" dropped.
  - **added:** only the new quote, labelled "New rule".
  - **removed:** only the old quote, labelled "No longer applies".
- **What it leaves out.** Moved and unchanged clauses are omitted (decision 2). A `needs_review` clause counts as changed and is shown as before/after rather than hidden, because hiding a possible change is the worse failure.
- **How quotes look.** Quotes are source text. They stay in the document's language and are shown with `dir="auto"` in the serif quote style from `docs/design-identity.md`.
- **Layout.** Each change is a stacked card, so it works at phone width. There are no modals, and no traffic-light colours.
- **Labels.** Labels come only from `src/lib/i18n/ar.ts` and `en.ts`. The Arabic is written natively.
- **Contents.** The spec holds only report quotes and dictionary keys: no answer keys, no LLM text.

### How the app knows the learner has viewed the lesson

The recommended option (A) needs no new storage.

- **When the lesson is shown.** The server shows the lesson when `mastery.state = 'needs_refresh'` and the learner has no attempts on the current version. In that case `nextScreen` in `auto` mode returns `what_changed`.
- **Where it leads.** Its only button, "Continue to the lesson", goes to the normal lesson (`?lesson=1`). The lesson's Start button leads to the questions.
- **How the learner reaches it.** The `/learn` card of a `needs_refresh` procedure opens `auto` mode. Every in-app path to the new exam therefore goes through the lesson.
- **Their first answer on the current version is the evidence.** "Viewed" is inferred from that answer; the view itself is not recorded.
- **Afterwards.** The lesson stays reachable from the procedure page with `?changes=1` until the badge comes back.

Limitations of option A, which make this a decision for Mohammad (D1):

- A hand-typed `?start=1` URL skips the lesson.
- Readiness cannot report who viewed the changes, or when.

Option B would enforce and record the view. It is described under Storage.

### Badge recheck

- **`record()` keeps `needs_refresh` until the learner passes.** If the stored state is `needs_refresh` and `masteryState()` returns `in_progress`, the state stays `needs_refresh`.
- **Only a pass restores the badge.** When every published exam item of the current version has a correct latest attempt, the row becomes `mastered` with `version_id` = the current version. That is the restored badge.
- **Grading is unchanged.** It is still against the approved key, with the same mastery rule.
- **While waiting.** The `/learn` badge count and level (`levelFor`) only count `mastered`, so a suspended badge does not count until the learner passes.

### Skipped SOP versions

A learner who mastered v1, never opened v2, and comes back after v3:

1. **The v2 upload** (procedure changed) sets their row to `needs_refresh` with `version_id = v2` and notifies them.
2. **The v3 upload** leaves the row as it is (it is already `needs_refresh`). B7 adds a step there: learners already in `needs_refresh` on a procedure that changed again get a new notification too. Their `version_id` is not changed, because it marks where their refresh started.
3. **The lesson covers every version they missed.**
   - The comparisons are chained from `mastery.version_id`, following each comparison's `old_version_id` back from the current version.
   - So the version they last learned is the `old_version_id` of `version_id`'s comparison (v1 here).
   - For each stable id, the oldest `old` quote is compared with the newest `new` quote, and that pair decides the net status. A clause changed in v2 and reverted in v3 drops out. One added in v2 and removed in v3 drops out. The moves in between are ignored.
   - A procedure that changed v1→v2 but was carried over at v3 still shows the v1→v2 changes, because the learner never retook it.
4. **Only current-version attempts count.** Attempts on v2 items made before v3 do not count towards the v3 exam, the same as today.
5. **A missing link in the chain stops the lesson with an error.** It is a missing or incomplete comparison, or a hop with `complete = false` that the learner would see. In that case the screen fails with a technical error naming the version, like every pipeline error. It never shows a partial diff, and there is no fallback (AGENTS.md).

## Acceptance criteria and their checks

Unit tests come first and must fail before the change (`web/src/lib/carry-over.test.ts`, `logic.test.ts`). DB tests run with `pnpm test:db` in a new `web/db/tests/what-changed.test.ts`.

1. Given the courier v1→v2 report, composing the screen for the CW-02 procedure shows CW-02's old (15 min) and new (10 min) quotes. CW-04 (moved) and CW-01 (unchanged) are not shown. → unit test.
2. Given the employee v1→v2 report, ED-02 is shown as before/after and ED-04 as "No longer applies" with its old quote. Unchanged ED clauses are not shown. → unit test.
3. Given two chained reports (v1→v2 changes a clause, v2→v3 reverts it, and a different clause is added in v3), the net screen shows only the added clause. Given a hop with `complete = false` or a missing comparison, composing the screen throws an error that names the version. → unit test.
4. Given a learner in `needs_refresh` with no attempts on the current published version, `nextScreen` in `auto` mode returns `what_changed`. After one answer on the current version it returns a question. `?changes=1` still returns `what_changed`. → DB test.
5. Given a `needs_refresh` learner, a wrong exam answer leaves the state `needs_refresh`. **This fails today**, when it becomes `in_progress`. When every exam item's latest attempt is correct, the state is `mastered` with the current `version_id`. → DB test.
6. Given an `in_progress` learner before the upload, the same lesson and recheck apply. A `not_started` learner gets no what-changed screen. → DB test.
7. Given a learner already in `needs_refresh` when a new version changes the procedure again, they get a new notification and their `version_id` is unchanged. → DB test on `applyNewVersion`.
8. The `what_changed` spec passes `ScreenSpecSchema` and contains no answer-key fields. → unit test.
9. `node scripts/check.mjs` passes, with no suppressions, skips or loosened types.

## Files

- `web/src/lib/carry-over.ts`: `whatChangedScreen` and a helper that chains the hops (both pure). `changeLines` reuses the same clause filter, so the notification and the lesson agree.
- `web/src/lib/compose.ts`: add the `what_changed` variant to `ScreenSpecSchema`.
- `web/src/lib/learning.ts`: the gate in `nextScreen`, the `?changes=1` mode, and keeping `needs_refresh` in `record()`.
- `web/src/lib/docproc.ts`: a `getComparisonChain(documentId, fromVersionId, toVersionId)` read of the existing `comparisons` table.
- `web/src/lib/repo.ts`: `getMastery(learnerId, documentId, procedureKey)`.
- `web/src/lib/pipeline.ts`: notify learners already in `needs_refresh` when their procedure changes again. The existing `UPDATE` stays as it is.
- `web/src/components/what-changed.tsx` (new) and `screen.tsx`: render the stacked before/after cards.
- `web/src/app/[lang]/learn/[doc]/[proc]/page.tsx`: pass the `changes` mode.
- `web/src/lib/i18n/ar.ts`, `en.ts`: "What changed", "Before", "After", "New rule", "No longer applies", "Continue to the lesson", and the reason line.
- Tests: `carry-over.test.ts`, `logic.test.ts`, `web/db/tests/what-changed.test.ts`, and the F05 and F07 cases in `web/e2e/feature-map.spec.ts`.
- `docs/feature-map.md`: the F05 and F07 Proof (below).
- Not touched: `readiness.ts`, `readiness_v`, `hl_readonly`, migrations (under option A), and the carry-over decision (`carriesOver`).

## Storage

### B9: badges

- **The existing row is enough.** B9 needs one badge per mastered procedure on `/learn`, and `mastery` already has one row per (learner, document, procedure_key):
  - `state = 'mastered'` is the badge;
  - `version_id` is the version it was earned on;
  - `updated_at` is when it was earned.
- **No migration for B9 as decided.** B7 keeps that meaning: a suspended badge is `needs_refresh` and a restored one is `mastered` on the new version.

### Gaps needing Mohammad's decision

- **D1, recording that the lesson was viewed.**
  - **Option A (recommended for B7, no migration):** the view is inferred, as described above. It meets "show the lesson before the new exam" on every in-app path.
  - **Option B (needs a migration):**
    - **Schema:** add a nullable column `mastery.changes_viewed_version_id TEXT`.
    - **Recording:** "Continue to the lesson" becomes a server action that writes the current version id there.
    - **Enforcement:** `nextScreen` and `gradeAnswer` refuse exam answers from a `needs_refresh` learner until the column equals the current version. That closes the URL bypass, gives an audit timestamp, and handles skipped versions on its own: a newer version means a new view is needed.
    - **Review path:** it touches `web/db/migrations/**`, so it would ship first as a separate High-risk PR, with a threat model and a rollback (drop the column).
    - **Readiness is unaffected.** `readiness_v` does not need the column.
  - **Choose B** if supervisors must see proof that a learner read the change.
- **D2, showing a suspended badge differently from "never mastered".** `needs_refresh` does not record whether the learner had `mastered` or was `in_progress`. The B9 decision as written does not need this; `/learn` shows both as "needs refresh". If B9 should show "badge under recheck" only for learners who had the badge, a nullable `mastery.badge_version_id TEXT` (the last version mastered) is needed. Same High-risk migration route. Not proposed unless Mohammad asks for it.
- **Not needed.** `notifications` has no `procedure_key`. That is fine for B7, because the `/learn` card, not the notification, links to the lesson.

## Feature-map changes and verification

- **F07 Proof**, appended: "…learners who had started or mastered a changed procedure are set to needs refresh and notified, including learners already waiting on an earlier version."
- **F05 Proof**, appended: "…after a new version, a learner who needs a refresh sees What changed (old and new text of changed, added and removed clauses only) before the lesson and exam; the state stays needs refresh until the new exam is passed, then the badge is back."
- **Run** `node scripts/verify-app.mjs F05 F07` in Arabic and English. Screenshots go to `.verify/vgolden25-b7-what-changed/`.
  - **Arabic document:** `courier-pickup-wait-v1-ar.docx` → `v2-ar.docx`. CW-02 is shown before/after, and CW-04 and CW-01 are absent.
  - **English document:** `employee-delayed-order-v1-en.pdf` → `v2-en.txt`. ED-02 is shown before/after and ED-04 as removed.
  - **Both UI languages:** each document is viewed with the UI in `/ar` and in `/en`, to check RTL and LTR layout, that quotes keep their own direction, and that the logo stays top-right.
  - **Skipped version:** courier v1 → v2 → v3 with a learner who never opened v2. It shows the net v1→v3 changes.
  - **Fixtures:** they follow B6's disposable-database rule (`HL_DISPOSABLE_DB` or CI only, cleanup by id).
- **Full feature map:** run F01–F07 once on the integrated branch (Enhanced).
- **Eval delta:** n/a. B7 changes only `web/`. docproc, its prompts, its models and the training-generator prompt are untouched, so `docproc eval --real` cannot change.
- **Reviews:** a `reviewer` subagent pass, then a second review (Codex `review-change` or a second pass) before merge.

## Out of scope

- **B8 follow-up: carried procedures lose mastery.** Carried items get new ids, so a learner who mastered v1 is asked again on v2, and one answer drops them to `in_progress`. This is tracked as a separate issue/PR after B8.
- **When the notification is sent.** Moving it from upload time to publish time.
- Keeping a changed procedure visible on `/learn` while its revised package waits for approval.
- A video for the what-changed lesson. It is text only.
- Any change to readiness, text-to-SQL or DB roles.

## Risks and rollback

- **A clause wrongly shown, or a real change hidden.** The screen trusts docproc's statuses and the chained net comparison. Unit tests on both dev pairs and the chain test pin the output. `needs_review` is always shown, and a broken chain fails loudly.
- **A learner stuck in `needs_refresh`.** Only a pass on the current version clears it, and only the pipeline sets it. Tests 5 and 7 cover both directions.
- **Lesson skipped by a typed URL (option A).** This is accepted until D1 is decided. Option B closes it.
- **Source text direction.** Mixed AR/EN quotes could render the wrong way. Each quote has `dir="auto"`, and the Arabic and English screenshots check it.
- **Rollback:** revert the B7 PR. Under option A no migration or data rewrite ships. Mastery rows written while B7 was live are ordinary `mastered`, `in_progress` or `needs_refresh` values and stay valid. Extra notifications stay as harmless history. Under option B, also revert the migration PR (drop the nullable column) after the B7 revert.
