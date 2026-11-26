---
name: encode-mistake
description: Use when the same mistake, review comment or incident has happened twice in Hunger Learn, or after fixing a bug class that could come back. Walks the correction ladder and turns the mistake into the most deterministic check that works. Not for one-off bugs.
---
# Encode a repeated mistake

First, record that this skill is in use: `node scripts/skill-log.mjs encode-mistake` (Claude Code also logs it
automatically). The PR gate reads this log: the `pr-policy` check needs the skills of the change's tier
(AGENTS.md → Workflow).

Take the highest rung that works:

1. Make it impossible: change the API or architecture (a narrow wrapper, a module boundary, a DB role
   like `hl_readonly`).
2. Make it a type: branded types, exhaustive unions, a zod schema or pydantic model at the boundary.
3. Make it a lint rule: ESLint (`no-restricted-imports`, `no-restricted-syntax`, a small custom rule in
   `web/eslint.config.mjs`) or a ruff rule in the package's `pyproject.toml`. The message must say what
   to do instead.
4. Make it a test: a regression, architecture or property-based test that fails on the old code.
5. Make it a CI gate: wire the check into `node scripts/check.mjs` (and so into CI and the agent hooks).
6. Write it down: only for judgment calls, one line with the reason in the right AGENTS.md or Skill.

Steps:

1. Write the mistake as a pattern with two real examples (`path:line`).
2. Pick the rung and implement it.
3. Prove it: run it against the bad example (it must fail, show the output) and against the fixed code
   (it must pass).
4. Add a row to `docs/rules-log.md`.

Changes to lint config, `scripts/`, hooks or CI are human-controlled: make them, say so in the PR, and a
code owner reviews them there (`.github/CODEOWNERS`).
