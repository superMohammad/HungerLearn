---
name: fix-bug
description: Use when fixing a reported bug or failing behaviour in Hunger Learn (web, docproc or media). Reproduces it with a failing test before changing code, then proves the fix. Not for new features or refactors.
---
# Fix a bug

First, record that this skill is in use: `node scripts/skill-log.mjs fix-bug` (Claude Code also logs it
automatically). The PR gate reads this log: `gh pr create` and the `pr-policy` check need the skills of
the change's tier (AGENTS.md → Workflow).

1. Restate the bug as expected vs actual, with the exact input. If you can't, ask.
2. Reproduce it with the smallest automated test that fails for the reported reason:
   - web: `web/src/lib/*.test.ts` (`node:test` via `pnpm test`);
   - docproc: `-/docproc/tests/` with the offline fixtures (`make_app`, `run_pair` in `tests/conftest.py`);
   - media: `media/tests/` (GPU machine only).
   Run it and keep the failing output.
3. Find the root cause. Don't patch the symptom. Don't add a timeout, retry, fallback or comment as the fix.
4. Fix it. Keep the diff minimal and leave unrelated code untouched.
5. Prove it: run the new test (now passing), then `node scripts/check-fast.mjs`, then `node scripts/check.mjs`.
   UI bugs: also run the verify-app skill for the affected feature-map row.
6. Search for the same pattern elsewhere (`rg`) and list any siblings in the PR; don't fix them here.
7. If this bug class could come back, run the encode-mistake skill.

Report: failing output (before), passing output (after), root cause in two sentences, siblings found.

Never delete or skip tests, loosen types, add `eslint-disable` / `# noqa` / `type: ignore`, or edit CI or
hooks to get green (`node scripts/guard-diff.mjs` fails on these).
