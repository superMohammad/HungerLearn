# B6 — Role and device layouts in the learner flow

**Risk tier:** Enhanced. The diff is over 400 changed lines because the implementation and its F05 browser tests ship together. It touches web/ only and no High-risk paths.
**Approved:** Pending — awaiting @superMohammad

## Scope

Stage 4 of `hunger-learn-mvp-architecture.md`: the learner's stored role and device choose how existing published content is arranged. No new content is generated. Grading against the approved key and the mastery rule do not change.

- **Courier on a phone:** the lesson video plus one question on each screen. When the video is ready, "auto" mode skips the separate lesson screen; the lesson stays reachable with `?lesson=1`.
- **Employee on a laptop:** a scenario question, meaning an approved question with a non-empty `scene`. The scene is shown in its own panel next to the question.
- **Partner on a tablet:** a checklist question in a two-column, touch-sized grid.
- **Every other role/device pair, or preferred content unavailable** (no ready video, no scene, not a checklist): the standard layout.
- **Invalid screen spec:** the existing Zod fallback (the lesson screen) is kept.

The selection is pure functions in `web/src/lib/compose.ts`: `preferredLayout`, `fitsLayout`, `orderForLayout`, `composeScreen`, `nextStepForLayout` and `skipsLessonInAuto`. `web/src/lib/learning.ts` connects them to the normal flow, `web/src/components/screen.tsx` renders them with the existing components, and the three new strings live in `src/lib/i18n/ar.ts` and `en.ts`.

## B5 retry priority

The layout only reorders items within practice and within exam so that items that fit come first. B5's `nextStep` then picks. After "Not yet", the next item is still a due item in a different format, and the layout only breaks ties among those. If the picked item does not fit the layout, the screen uses the standard layout. A regression test pins this: a partner on a tablet who fails a checklist exam gets the multiple-choice practice item next, in the standard layout.

## Verification

- Unit tests (written first, in `web/src/lib/logic.test.ts`) cover:
  - the three role/device pairs;
  - the standard layout for other pairs and for missing content;
  - the invalid-spec fallback;
  - the stable reorder;
  - the lesson skip;
  - the B5-over-B6 regression.
- `node scripts/check.mjs` passes.
- F05 in `web/e2e/feature-map.spec.ts`, run with `node scripts/verify-app.mjs F05`, walks the three layouts in Arabic and English (six checks) at phone, laptop and tablet sizes. Screenshots go to `.verify/vgolden25-b6-role-device-format/`. The row never submits an answer.
- A fresh-context `reviewer` pass on the integrated diff, with must-fix and should-fix findings resolved. A second review follows before merge.
- Eval delta: n/a. B6 changes only the learner UI and browser tests in web/; docproc extraction, prompts and models are untouched, so `docproc eval --real` cannot change.

## Disposable database fixtures

- **Where seeding is allowed.** `web/e2e/f05-fixtures.ts` seeds one published procedure per role, and only into a disposable database:
  - GitHub Actions (`CI=true` and `GITHUB_ACTIONS=true`, a fresh service container per job);
  - or locally, a throwaway database whose name matches `HL_DISPOSABLE_DB`. It is created, migrated and seeded, and the app runs against it.
- **Anywhere else** the run stops before writing.
- **Unique ids and cleanup.** Each run uses ids derived from a random UUID and deletes, in one transaction, only the rows it inserted (by those ids). Nothing cascades.
- **Interrupted runs.** If a run is interrupted, its rows stay until the throwaway database is dropped. There is deliberately no prefix sweep.

## Known gaps

- Video playback is not verified. No MP4 is rendered on CI or teammate machines, so the courier fixture's video points at a missing file and F05 only checks that the player is shown with a `/api/media/…` source. The GPU machine's owner verifies real playback.
- The standard layout for other role/device pairs is covered by unit tests only: sign-up and the seed always store the device that matches the role.
- Grading and the B5 retry are proven by unit tests, not in the browser.

## Risk and rollback

- **Risks:**
  - A wrong layout choice could hide a question's scene or put the wrong item first. The unit tests and the F05 screenshots check both.
  - The courier's lesson skip changes the "lesson first" flow; it needs Mohammad's confirmation.
  - The fixtures write to the database the tests are pointed at. The disposable-database guard and id-scoped cleanup limit this.
- **Rollback:** revert the B6 PR. No migration or data change ships, and published training, attempts and mastery are untouched.
