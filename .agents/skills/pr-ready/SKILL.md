---
name: pr-ready
description: Use when a Hunger Learn change is finished and about to become a pull request. Runs the full checks, gathers evidence and writes the PR description from .github/pull_request_template.md. Not for work in progress.
---
# Get a change PR-ready

First, record that this skill is in use: `node scripts/skill-log.mjs pr-ready` (Claude Code also logs it
automatically). The PR gate reads this log: the `pr-policy` check needs the skills of the change's tier
(AGENTS.md → Workflow).

1. Make sure you are on a branch, not `main` (`git switch -c <type>/<slug>` if needed).
2. Run `node scripts/check.mjs` and keep the summary of its output. If it fails, fix the root cause first.
3. Collect evidence:
   - the new/changed tests and their output (before/after for bugs);
   - `.verify/<branch>/` results for every touched feature-map row (verify-app skill);
   - for prompt, model or extraction changes: the eval or fixture delta on `dev/` data.
4. Standard tier and above: get a fresh-context review (the `reviewer` subagent, or the review-change
   skill in a new session of the other tool). Enhanced and High-risk: a second review as well (the other
   tool, or a second `review-change` pass); High-risk: `/security-review` too. Resolve every "Must fix".
5. Write the PR body by filling `.github/pull_request_template.md` completely: tier, linked issue,
   behaviour change, evidence, risks and rollback (Enhanced and High-risk). Paste the output of
   `node scripts/skills-used.mjs` as the `skills:` line, and say in the body if a skill was recorded by hand.
   Save the body to a file outside the repo and run `node scripts/pr-policy.mjs <file>`: it must pass,
   because the same check is required on the PR.
6. Check the diff is only the task: `git diff --stat origin/main...HEAD`. Split refactors from behaviour
   changes; aim for a diff a human can review in one sitting (under ~400 lines).
7. Push the branch and open the PR only when the user asks (`gh pr create --body-file …`). Merge only
   when the human asks in the session, with every required check green, and never with `--admin`.
