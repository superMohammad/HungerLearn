<!-- Fill every section. The pr-ready skill does this for agents. Delete nothing; write "n/a" with a reason. -->

**Risk tier:** Minimal | Standard | Enhanced | High-risk  <!-- AGENTS.md → Workflow → Risk tiers; if unsure, go one higher -->
**Issue:** #

## What changes for users

## Evidence
<!-- Commands + output (node scripts/check.mjs summary), failing-then-passing test for bugs,
     .verify/<branch>/ screenshots for each touched docs/feature-map.md row in AR and EN,
     eval / fixture delta on dev/ data for prompt, model or extraction changes. -->

## Review
- [ ] Fresh-context review done (`reviewer` subagent / other tool) and every must-fix resolved (Standard+)
- [ ] Plan linked from `docs/plans/` and approved by an engineer (Enhanced, High-risk)

## Risks and rollback
<!-- Required for Enhanced and High-risk: what could break, how to revert, data/migration impact. -->

## Checklist
- [ ] `node scripts/check.mjs` passes locally
- [ ] No skipped/deleted tests, suppressions, loosened types/lint, or CI/hook edits (or label `allow-weakening` + reason)
- [ ] Diff limited to the issue; refactors separate from behaviour changes
- [ ] UI strings only in `src/lib/i18n/{ar,en}.ts`; Arabic copy native Saudi Arabic
- [ ] No new dependency, permission or DB role without an engineer's OK
