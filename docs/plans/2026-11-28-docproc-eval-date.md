# docproc eval: record when the run finished

**Tier:** Enhanced. The change is 12 lines, but `-/docproc/src/docproc/evaluation.py` is on pr-policy's Enhanced list (`scripts/lib/policy.mjs:43`). · **Owner:** Yasser (@altayariyasser) · **Branch:** `feat/docproc-eval-date` (from `main` at 302f803)

**Approved:** _pending @superMohammad_

## Problem
The scoreboard (A2d, #31) shows each number with its date. A2a's and A2c's result files carry their own date, but docproc's `out/eval_dev_*.json` has none. So the extraction card has to use the file's save time, which changes whenever the file is copied.

## Approach
- `EvalReport` gains `generated_at: datetime`, set to `datetime.now(timezone.utc)` in `run_eval` (Python 3.10-compatible, like `models.py`).
- Pydantic writes it as ISO 8601 with `Z` through the existing `model_dump(mode="json")` path in `cli.py`.
- It's required, because `run_eval` is the only place an `EvalReport` is built, so forgetting it fails loudly.
- **No scoring, prompt, parsing or matching change.** EvalReport is not part of the team contract (`docs/report.schema.json` covers `ComparisonReport` only).
- After #31 merges, a small web follow-up makes the scoreboard read this date instead of the file time.

## Acceptance criteria → checks
- `run_eval` returns a UTC `generated_at` between the test's start and end, the JSON form ends in `Z`, and it round-trips through `fromisoformat` (3.10-safe) → assertions in `test_run_eval_offline_scores_dev_and_never_reads_held_out`, written first and seen failing.
- `node scripts/check.mjs docproc scripts` passes; two fresh-context reviews have no open must-fix.

## Eval delta
None by construction: only a timestamp is added, and every score is computed exactly as before. A `docproc eval --real` run before and after would differ only in `generated_at`.

## Risks / rollback
- **Additive:** one new key. Readers that ignore unknown keys are unaffected, and nothing reads it yet.
- **Rollback:** revert the PR.

## Open question for @superMohammad
1. Approve as Enhanced (the file is on the Enhanced list), with the "eval delta: none by construction" note instead of a before-and-after `--real` run?
