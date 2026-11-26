# QA-hardened synthetic SOP corpus

**Tier:** Enhanced · **Owner:** Yasser (@altayariyasser) · **Branch:** `Yasser` · **PR:** #7

**Approval pending:** @superMohammad. Replace this line with `**Approved:** @superMohammad, <date>` to approve the three `held_out/` changes below (AGENTS.md: `held_out/` is human-controlled).

## Problem
The evaluation corpus in `data/synthetic_sops/` lacked gold for publication gates and typed change
pairs, had only 7 learners (not every v1→v2 routing outcome was exercised), stored gold facts as
quote copies, and a fresh Windows clone failed the freeze check because `core.autocrlf` rewrote
corpus bytes.

## Approach
1. Replace the corpus with the QA-hardened version: same 15 uploads and stable clause IDs, 12
   learners, new `dev/gold/publication_gates.json` and `{dev,held_out}/gold/change_pairs.json`,
   normalized gold facts, 7 source wording fixes, stricter `validate.py`, `FREEZE.sha256` over 30 files.
2. `web/scripts/seed-learners.mts`: names and emails for the new learners so `pnpm db:seed` works.
3. `.gitattributes`: `data/synthetic_sops/** -text` so corpus bytes stay exact on every checkout.

## Held-out changes needing explicit approval
1. `held_out/gold/extraction.json`: facts rewritten from Arabic source text to English normalized labels.
2. `held_out/uploads/partner-counter-verification-v1-ar.docx`: PV-11 wording change.
3. `held_out/gold/change_pairs.json`: new file (24 typed edits).

No held-out file was used for development or tuning; the held-out labels stay in the scorer.

## Acceptance criteria
- `python data/synthetic_sops/validate.py` → PASS, freeze intact (30 files).
- Fresh clone with `core.autocrlf=true` and `false` both pass the freeze check.
- `docproc eval --real` on the GPU machine: no regression vs `main` (verified by Mohammad:
  recall/precision 1.00/1.00, diff 33/33 on both).
- `node scripts/check.mjs` passes.

## Out of scope
Scorers for the new gold (next PR, A4); the seed-vs-manifest Arabic branch name mismatch
(`BRANCH_AR` vs `branch_local`, pre-existing, follow-up); the agent engineering guide (removed
from this PR, separate PR later).

## Rollback
Revert the PR's commits; no schema, migration or app-code impact beyond the seed list.
