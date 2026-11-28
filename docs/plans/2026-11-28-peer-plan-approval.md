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
1. **It has an approving GitHub review on the PR, and it is not the PR author.**
   - Only the latest review that is not a comment counts. A later "changes requested" or a dismissed review takes the approval away.
   - The review must be of the PR's **current head commit**, so a push after the approval needs a fresh one.
   - The reviewer's association must be OWNER, MEMBER or COLLABORATOR. The repo is user-owned, so every COLLABORATOR has write access.
   - Reviews by deleted accounts are left out.
2. **It is `@superMohammad` and he is the PR author.**
   - GitHub does not let an author approve his own PR. The author's login comes from the GitHub API, so nobody else can use this exception.
   - On his own PRs the line is self-reported. He merges them himself with the admin bypass in the web UI (`enforce_admins` stays off), or asks a teammate to approve. Agents never use `--admin`.

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
- `.agents/skills/plan-change/SKILL.md`: the `**Approved:**` line names the approving teammate.
- `scripts/lib/bash-guard.mjs`: fix the doc comment.

## Rollout

The gate depends on branch protection: peers can merge, and `pr-policy` runs the PR's own scripts. Apply protection **just before this PR merges**, so AGENTS.md never describes a review that isn't enforced. It doesn't block this PR: Mohammad merges it with the admin bypass, since `enforce_admins` stays off. Mohammad runs the call, or asks for it, then checks it with `gh api repos/superMohammad/HungerLearn/branches/main/protection`. If the PATCH returns 404 because review protection isn't on yet, `PUT …/branches/main/protection` with the full settings does the same.

```sh
gh api -X PATCH repos/superMohammad/HungerLearn/branches/main/protection/required_pull_request_reviews \
  -F required_approving_review_count=1 -F dismiss_stale_reviews=true -F require_last_push_approval=true \
  -F require_code_owner_reviews=false
```

With these settings, a PR that rewrites `pr-policy` itself still needs an approving review from a non-author. That review must be of the last push, and someone other than the pusher must give it.

Fork PRs get a read-only token, which is enough. A first-time contributor's workflow runs wait for a maintainer to approve them.

## Verification

- `scripts/test/policy.test.mjs`, tests written first:
  - a teammate's approval passes;
  - the author naming themself fails;
  - an owner-authored PR passes on its line alone;
  - a line with no review fails;
  - a review that is later changes-requested or dismissed fails;
  - an approval of an older commit fails; reviews of deleted accounts or garbage-collected commits are left out by `pr-meta`;
  - a review by a non-collaborator fails;
  - bad meta raises.
- `scripts/test/pr-policy.test.mjs`: the end-to-end runs take a meta file.
- `node scripts/check.mjs scripts`.
- On this PR, CI `pr-policy` runs on the `pull_request` and `pull_request_review` events. The review run must post `pr-policy` on the head commit and turn it green. This is also the first real review that `pr-meta` parses.

## Risks and rollback

- **The PR's own scripts run in CI**, so a PR could weaken `pr-policy` itself. The required approving review in branch protection means a non-author human still approved it.
- **Rollback:** revert this PR and set `required_approving_review_count` back to 0, with `require_last_push_approval=false`.
