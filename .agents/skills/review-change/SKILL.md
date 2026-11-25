---
name: review-change
description: Use when reviewing a Hunger Learn change you did not write (fresh-context reviewer, other tool preferred), or when asked to review a branch, diff or PR. Reads only the task, the diff and the evidence, and ranks findings. Does not edit files. Not for writing code.
---
# Review a change

Inputs: the issue or task text, `git diff origin/main...HEAD` (plus `git diff` for uncommitted work),
evidence in `.verify/<branch>/` and the PR description. Ignore how the change was produced.

Check in this order and stop spending time on lower levels if higher ones fail:

1. Correctness: does every acceptance criterion have a check that would fail without the change?
   Edge cases, error paths, Arabic and English inputs, empty and very large inputs.
2. Security and data: session re-checked in every server action (`src/lib/session.ts`), text-to-SQL
   only through `hl_readonly` / `readiness_v`, no secrets or `.env*` contents, uploads validated,
   LLM output treated as untrusted, migrations forward-safe.
3. Weakened checks: skipped or deleted tests, suppressions, loosened types or lint config, CI or hook
   edits, new fallbacks or catch-alls that hide errors.
4. Project invariants in AGENTS.md and the package AGENTS.md files (docproc hash, matching only in
   `matching.py`, backend parity, i18n dictionaries, design identity, held-out data untouched).
5. Design: simplest thing that works, no duplicated logic, small single-purpose functions, strict types.
6. Tests: do they test behaviour, not implementation details?

Skip anything the linter or formatter catches.

Output:

```
Must fix
- path:line — problem → why it matters → concrete fix
Consider
- path:line — …
Evidence gaps
- criterion or feature-map row with no proof
Verdict: ready for human review | needs another round
```

Two or three rounds without convergence mean the spec or design is wrong: hand over to the engineer.
