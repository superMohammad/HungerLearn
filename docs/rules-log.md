# Rules log

Every repeated mistake becomes a rule (encode-mistake skill). One row per rule, newest first.

| Date | Mistake (pattern) | Rung | Rule / check | Proven failing on |
|---|---|---|---|---|
| 2026-11-25 | Agents "fix" red checks by skipping tests or adding suppressions | CI gate | `scripts/guard-diff` in `scripts/check`, CI and the Stop hook | a test file with `test.skip` and `eslint-disable` |
