# PR B: revert #8 (local OvisOCR3 for scans)

**Tier:** High-risk: the revert changes `-/docproc/AGENTS.md`, a rules file. It is also multi-package and touches `evaluation.py`.
**Approved:** Mohammad Almalke (`@superMohammad`), 2026-11-26. This is step 2 of the approved plan
`docs/plans/2026-11-26-enforce-pr-policy-and-redo-ocr.md`; in the session he said "start PR B & C".

## Why
#8 was merged without the workflow skills. It is reverted so that PR C can rebuild the same feature through the full
workflow under the new `pr-policy` gate.

## Acceptance criteria → checks
- **Restores main exactly:** given `main` after this PR, the 10 files #8 changed are identical to `main` before #8.
  Check: `git diff 679f666^ HEAD -- <files>` is empty.
- **Checks pass:** `node scripts/check.mjs docproc web scripts`.
- **Scans skipped again:** the offline dev eval (`docproc eval`) skips the 3 dev scans.

## Scope
- **Reverted:** the 10 files of #8, by `git revert 679f666`.
- **Kept:** the existing `ovis` OCR adapter, which predates #8.
- **Not touched:** local configuration. `DOCPROC_OCR=ovis` stays in `-/docproc/.env`, so web uploads of scans still OCR
  on the GPU machine.
- **Temporarily lost until PR C:** the eval's scan scoring and the clearer 0-clause error.

## Rollback
Revert this PR, which restores #8.
