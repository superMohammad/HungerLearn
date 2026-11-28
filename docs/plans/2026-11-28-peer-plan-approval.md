# Peer plan approval, proven by a GitHub review

**Risk tier:** High-risk (`scripts/**`, `.github/**`, `AGENTS.md`, `.agents/skills/**`)

**Approved:** @superMohammad, 2026-11-28

## Context

The `**Approved:**` line was plain text: anyone could type `@superMohammad` into a plan and `pr-policy` passed. Branch protection required no review, so the approval was never proven. Decision (Mohammad, 2026-11-28):
- any teammate other than the PR author may approve a plan, in every tier;
- one approval is enough;
- the approval must be a real GitHub review;
- peers may merge.

## Rule

A changed plan in `docs/plans/` is approved when its `**Approved:**` line names a handle that meets one of these conditions:
1. **It has an approving GitHub review on the PR, and it is not the PR author.** Only the latest review that is not a comment counts, so a later "changes requested" or a dismissed review takes the approval away. The reviewer's association must be OWNER, MEMBER or COLLABORATOR.
2. **It is `@superMohammad` and he is the PR author.** GitHub does not let an author approve his own PR, and the author's login comes from the GitHub API, so nobody can forge it.

## Changes

- `scripts/lib/policy.mjs`:
  - `PrMeta` / `Review` types, and `parsePrMeta` (strict, raises on bad input).
  - `approvingReviewers`, `approvalHandles` and `isApprovedPlan(text, meta)`.
  - `policyProblems` takes `meta`, and its message names the missing approval.
- `scripts/pr-meta.mjs <pr-number> <out-file>` (new): reads the PR's author and reviews with `gh api`. It retries with a warning, then raises.
- `scripts/pr-policy.mjs <pr-body-file> <pr-meta-file>`.
- `.github/workflows/pr-policy.yml`:
  - `pull-requests: read`;
  - also triggers on `pull_request_review` events;
  - runs `pr-meta.mjs` first.
- `AGENTS.md`, `.agents/skills/pr-ready/SKILL.md`, `.github/pull_request_template.md`, `.github/CODEOWNERS` (comment): the new rule.
- After merge: branch protection `required_approving_review_count: 1` and `dismiss_stale_reviews: true`. Mohammad runs this `gh api` call, or asks for it.

## Verification

- `scripts/test/policy.test.mjs`, tests written first:
  - a teammate's approval passes;
  - the author naming themself fails;
  - an owner-authored PR passes on its line alone;
  - a line with no review fails;
  - a review that is later changes-requested or dismissed fails;
  - a review by a non-collaborator fails;
  - bad meta raises.
- `scripts/test/pr-policy.test.mjs`: the end-to-end runs take a meta file.
- `node scripts/check.mjs scripts`.
- On this PR, CI `pr-policy` runs on the `pull_request` and `pull_request_review` events.

## Risks and rollback

- **The PR's own scripts run in CI**, so a PR could weaken `pr-policy` itself. The required approving review in branch protection means a non-author human still approved it.
- **Rollback:** revert this PR and set `required_approving_review_count` back to 0.
