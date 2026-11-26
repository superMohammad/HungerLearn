---
name: plan-change
description: Use before editing code for any Standard, Enhanced or High-risk task in Hunger Learn (bug fix, feature, schema, prompt or pipeline change). Produces a short plan with risk tier, files to touch and a verification plan, and stops for approval at Enhanced and above. Not for Minimal-tier typo or copy fixes.
---
# Plan a change

First, record that this skill is in use: `node scripts/skill-log.mjs plan-change` (Claude Code also logs it
automatically). The PR gate reads this log: `gh pr create` and the `pr-policy` check need the skills of
the change's tier (AGENTS.md → Workflow).

1. Restate the goal and each acceptance criterion as a checkable statement ("given … when … then …").
   If any criterion is ambiguous, ask the user. Never pick an interpretation silently; if you must
   assume, write the assumption in the plan for the engineer to confirm.
2. Explore read-only. List the files you expect to touch and why. Check whether the logic already exists.
3. Set the risk tier with the table in AGENTS.md (Workflow → Risk tiers). If unsure, go one tier up.
   Any High-risk path in the diff makes the whole change High-risk.
4. Write the verification plan:
   - which new or changed tests prove each criterion (write them first, see the fix-bug skill for bugs);
   - which `docs/feature-map.md` rows to exercise with the verify-app skill, in Arabic and English;
   - for prompt, model or docproc extraction changes: which eval or fixture run shows the delta on `dev/`
     data (never `held_out/`).
5. Note what is out of scope, new dependencies (need an engineer's OK), and the rollback path
   (Enhanced and High-risk).
6. Parallel sub-tasks: list the paths each one claims. Overlapping claims, shared migrations,
   `src/lib/i18n/*.ts` or lockfiles mean they run one after another.

Output format:

```
Tier: <Minimal|Standard|Enhanced|High-risk> — <one-line reason>
Criteria → checks: <criterion> → <test or command>
Files: <path> — <why>
Feature-map rows: <ids or none>
Risks / rollback: …
Open questions: …
```

Standard: continue after showing the plan unless the user objects.
Enhanced and High-risk: stop and wait for the engineer's approval; save the approved plan to
`docs/plans/<yyyy-mm-dd>-<slug>.md` so the PR can link it.
