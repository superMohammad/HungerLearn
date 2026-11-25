---
name: pr-ready
description: Use when a Hunger Learn change is finished and about to become a pull request. Runs the full checks, gathers evidence and writes the PR description from .github/pull_request_template.md. Not for work in progress.
---
# Get a change PR-ready

1. Make sure you are on a branch, not `main` (`git switch -c <type>/<slug>` if needed).
2. Run `scripts/check` and keep the summary of its output. If it fails, fix the root cause first.
3. Collect evidence:
   - the new/changed tests and their output (before/after for bugs);
   - `.verify/<branch>/` results for every touched feature-map row (verify-app skill);
   - for prompt, model or extraction changes: the eval or fixture delta on `dev/` data.
4. Standard tier and above: get a fresh-context review (the `reviewer` subagent, or the review-change
   skill in a new session of the other tool). Resolve every "Must fix".
5. Write the PR body by filling `.github/pull_request_template.md` completely: tier, linked issue,
   behaviour change, evidence, risks and rollback (Enhanced and High-risk).
6. Check the diff is only the task: `git diff --stat origin/main...HEAD`. Split refactors from behaviour
   changes; aim for a diff a human can review in one sitting (under ~400 lines).
7. Push the branch and open the PR only when the user asks (`gh pr create --body-file …`). Never merge.
