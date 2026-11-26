# Rules log

Every repeated mistake becomes a rule (encode-mistake skill). One row per rule, newest first.

| Date | Mistake (pattern) | Rung | Rule / check | Proven failing on |
|---|---|---|---|---|
| 2026-11-26 | A PR written and merged without the workflow skills: no plan approval by the owner, no skills, missing Enhanced evidence (#8; #7 with 5/7 boxes and no plan) | CI gate | `pr-policy` required check (`scripts/pr-policy.mjs`, rules in `scripts/lib/policy.mjs`); skill log (`scripts/skill-log.mjs`, Claude PostToolUse hook). Reading `.env*` for the demo password stays a written rule in `verify-app` (not machine-checkable) | PR #8 and PR #7 descriptions: both fail with the missing plan approval and skills |
| 2026-11-25 | A server action without a session check | Test | `web/src/lib/security.test.ts`: every `"use server"` export starts with `requireAdmin()`/`requireLearner()` (allowlist: sign-in, sign-up, sign-out) | a new action returning its input unguarded |
| 2026-11-25 | UI text hard-coded in one language instead of the i18n dictionaries | Lint rule | `react/jsx-no-literals` in `web/eslint.config.mjs` (symbols and the brand name allowed) | `<p>Hello world</p>` in a component |
| 2026-11-25 | Normalization or hashing silently changing identity | Test (properties) | `-/docproc/tests/test_properties.py` (Hypothesis): numbers and words survive, hash ignores clause number, heading copy and audience order, changes on content | generated inputs; first run caught two wrong assumptions in the test itself |
| 2026-11-25 | A UI flow "verified" by a test that passes while the page still shows a spinner | Test | `web/e2e/feature-map.spec.ts` waits for the visible result (e.g. the sign-in error alert), not only the URL | the wrong-password test, whose screenshot showed "Checking…" |
| 2026-11-25 | Workflow scripts that only run on Linux | CI gate | scripts are plain Node; CI job `workflow-scripts` runs them on Ubuntu, macOS and Windows | the earlier bash/jq versions |
| 2026-11-25 | Agents "fix" red checks by skipping tests or adding suppressions | CI gate | `node scripts/guard-diff.mjs` in `node scripts/check.mjs`, CI and the Stop hook | a test file with `test.skip` and `eslint-disable` |
