# B8 — Keep training when a clause moves

**Risk tier:** Enhanced because the refactor touches web/src/lib/pipeline.ts.
**Approval status:** Pending Mohammed’s review.

## Scope

Keep the shared carry-over and citation helpers used by the v2 pipeline and admin review page. When docproc reports that a clause moved with the same wording, v2 carries forward the existing training and resolves its citation to the new location using the stable clause ID. Material changes trigger regeneration and reapproval.

## Verification

- Run node scripts/check.mjs. Keep the regression tests for training carry-over, the updated citation, and regeneration after a material change.
- Eval delta: n/a. B8 changes only web/; docproc is untouched, so docproc eval cannot change.
- Use the synthetic courier pickup-wait v1/v2 pair. Verify CW-04 keeps its training and cites its new section, CW-01 carries over as the unchanged control, and CW-02 triggers regeneration when the wait threshold changes from 15 to 10 minutes.
- Capture F04 for the admin review page, F05 for the learner flow, and F07 for v2 carry-over in Arabic and English. Record the additional Enhanced verification and review evidence required by AGENTS.md, including any owner-run eval or video evidence.

## Risk and rollback

An incorrect match could retain stale training or point a citation to the wrong location. The regression tests and v1/v2 walkthrough check both outcomes. Revert the B8 PR if a regression is found.
