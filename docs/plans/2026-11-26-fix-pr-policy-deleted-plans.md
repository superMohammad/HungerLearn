# Fix: pr-policy crashes when a PR deletes a plan file

**Tier:** High-risk: the fix changes `scripts/pr-policy.mjs`, which the High-risk list covers.
**Approved:** Mohammad Almalke (`@superMohammad`), 2026-11-26, in the Claude Code session: "ok approve you to do all remaining tasks".

## Bug
**Expected:** `pr-policy` ignores a `docs/plans/*.md` file that the PR deletes, and checks the rest normally.
**Actual:** it crashes with `ENOENT`, so the required check fails.

How it happens: `changedFiles()` lists deleted paths, which is on purpose, because a deleted High-risk file must still raise the tier. `changedPlans()` keeps those paths, and `pr-policy.mjs` then reads each one.

The reviewer found it on PR B (the revert of #8), which deletes `docs/plans/2026-11-26-local-ovis-ocr.md`.

## Fix
Read only the changed plan files that are regular files in the PR's tree (`lstatSync().isFile()`, the rule the other scripts use). A plan the PR deletes, a symlink or a directory cannot be the PR's own approved plan. The tier computation still sees deletions.

## Criteria → checks
- **No crash, still passes:** given a PR that deletes one plan and adds its own approved plan, `pr-policy` passes without crashing.
- **No bypass:** a PR whose only plan is deleted or a symlink fails with the `Plan:` problem.
  Check: `scripts/test/pr-policy.test.mjs` (3 cases), which runs the real CLI in a throwaway repo. All failed before the fix and pass after.
- **Nothing else changes:** `node scripts/check.mjs scripts` passes.

## Siblings
None. Everything else that reads files from a diff list reads only untracked files, and those always exist:
- `agent-stop-hook.mjs`
- `lib/guard.mjs`
- `lib/hl.mjs`

## Rollback
Revert the PR.
