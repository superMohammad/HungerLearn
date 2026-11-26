<!-- Fill every section. The pr-ready skill does this for agents. Delete nothing; an unticked box needs "n/a: <reason>".
     The required check pr-policy (scripts/pr-policy.mjs) enforces this description; run it locally before pushing. -->

**Risk tier:** Minimal | Standard | Enhanced | High-risk  <!-- AGENTS.md → Workflow → Risk tiers; if unsure, go one higher -->
**Issue:** #

## What changes for users

## Evidence
<!-- Commands + output (node scripts/check.mjs summary), failing-then-passing test for bugs,
     .verify/<branch>/ screenshots for each touched docs/feature-map.md row in AR and EN,
     eval / fixture delta on dev/ data for prompt, model or extraction changes. -->

## Skills used
<!-- Standard+: plan-change, review-change or reviewer, pr-ready; High-risk: security-review; verify-app when the diff touches UI files.
     Agents: paste the output of `node scripts/skills-used.mjs`. Humans: list the skills you followed. -->
skills:

## Review
- [ ] Fresh-context review done (`reviewer` subagent, `review-change`, or Codex) and every must-fix resolved (Standard+);
      Enhanced+: a second review (the other tool or a second `review-change` pass); High-risk: `/security-review`
- [ ] This PR adds or changes its plan in `docs/plans/`, with an **Approved:** line by `@superMohammad` (Enhanced, High-risk)

## Risks and rollback
<!-- Required for Enhanced and High-risk: what could break, how to revert, data/migration impact. -->

## Checklist
- [ ] `node scripts/check.mjs` passes locally
- [ ] No skipped/deleted tests, suppressions, loosened types/lint, or CI/hook edits (or label `allow-weakening` + reason)
- [ ] Diff limited to the issue; refactors separate from behaviour changes
- [ ] UI strings only in `src/lib/i18n/{ar,en}.ts`; Arabic copy native Saudi Arabic
- [ ] No new dependency, permission or DB role without an engineer's OK
