# Enforce the workflow on every PR, then redo PR #8 under it

**Tier:** High-risk: the diff touches `scripts/**`, `.github/**`, `.claude/**`, `.codex/**` and `AGENTS.md`.
**Approved:** Mohammad Almalke (@superMohammad), 2026-11-26, in the Claude Code session: "i'm only whos accepts PR and merge".

## Why
PR #8 was merged without loading the repo skills. A `verify-app` rule was broken (a script read
`web/.env.local`), and Enhanced evidence was missing: no second-tool review, no full feature-map walk.
Nothing stopped this: today the repo checks results (tests, lint, guard-diff) but not process.
`main` protection requires the CI checks but **0 reviews**. Nothing checks the PR description, and
nothing blocks an agent's `gh pr merge`.

## Decisions (engineer, 2026-11-26)
- **Mohammad is the only approver and the only one who merges.** No teammate review is required. Branch
  protection keeps 0 required reviews, because GitHub does not let an author approve their own PR. The
  required checks, including the new `pr-policy`, are the gate, and Mohammad's merge is the approval.
- An Enhanced or High-risk plan counts as approved only with an `**Approved:**` line naming Mohammad
  (`@superMohammad`).
- **Agents may merge only when Mohammad asks in the session**, and only if every required check is
  green. Agents never use the admin bypass (`--admin`).
- **PR #8 is reverted, then rebuilt** through the full skill workflow under the new gate.
- No Codex subscription: the "review in the other tool" step becomes "the other tool, or a second
  fresh-context `review-change` pass", and Mohammad's review before merging.

## Acceptance criteria → checks

| # | Given / when / then | Check |
|---|---|---|
| 1 | Given a PR description, when its tier is missing, a checkbox is empty without "n/a: <reason>", or a required section is empty, then the `pr-policy` CI job fails and names the item | `scripts/test/workflow.test.mjs` cases on fixture bodies |
| 2 | Given a diff that touches a High-risk path (list in AGENTS.md), when the declared tier is lower, then `pr-policy` fails ("declared Standard, diff needs High-risk: scripts/x.mjs"). Multi-package, migration, prompt/model or >400 changed lines need at least Enhanced | unit tests on path lists |
| 3 | Given Enhanced or High-risk, when the PR adds or links no `docs/plans/*.md` whose `**Approved:**` line names Mohammad (`@superMohammad`), then `pr-policy` fails | unit test |
| 4 | Given Standard or higher, when the "Skills used" section lacks `plan-change`, `review-change`/`reviewer` or `pr-ready`, or lacks `verify-app` while the diff touches `web/src/app/**` or `web/src/components/**`, then `pr-policy` fails | unit test |
| 5 | Given a Claude Code session, when the Skill tool loads a skill, then `.git/hl-skills/<branch>.jsonl` gets a line, and `pr-ready` writes the "Skills used" section from that log, not from memory | hook unit test + manual run |
| 6 | Given an agent, when it runs `gh pr create` on a Standard+ branch whose skill log lacks `plan-change` or `pr-ready`, then the bash guard denies it with the missing skill names | `workflow.test.mjs` guard cases |
| 7 | Given an agent, when it runs `gh pr merge … --admin` or merges a PR whose required checks are not all green, then the guard denies it. A plain merge of an all-green PR is allowed (the human asks in the session) | guard cases (check status read with `gh pr checks`) |
| 8 | Given `main`, after this PR merges, then branch protection requires `pr-policy` plus the 8 existing checks (0 required reviews, admin bypass kept) | `gh api …/branches/main/protection` output in the PR |
| 9 | Given the PR template, then it has a "Skills used" section and the Codex-less review rule | read in review |

## Files
- `scripts/pr-policy.mjs` (new): reads the PR body and changed files from the GitHub event payload and `git diff`. It is pure functions plus a thin CLI. The body is treated only as data, never executed.
- `scripts/lib/policy.mjs` (new): tier floor from paths, checkbox and section parsing, required skills per tier.
- `scripts/agent-skill-log-hook.mjs` (new): a PostToolUse hook for the Skill tool that appends `{skill, at}` to `.git/hl-skills/<branch>.jsonl`. It stays inside `.git`, so it is never committed.
- `scripts/agent-bash-guard-hook.mjs`: add the `gh pr create` skill-log check, deny `--admin` on `gh pr merge`, and deny a merge with non-green checks.
- `scripts/test/workflow.test.mjs`: cases for criteria 1–7.
- `.claude/settings.json`: register the PostToolUse `Skill` hook.
- `.codex/hooks.json`: no skill hook. Codex does not expose skill loads to hooks (to be confirmed in the Codex docs during the build), so for Codex users the CI `pr-policy` job is the gate.
- `.github/workflows/ci.yml`: new `pr-policy` job on `pull_request` (not `pull_request_target`; no secrets).
- `.github/pull_request_template.md`: add a "Skills used" section (machine-readable list) and the review rule.
- `.agents/skills/pr-ready/SKILL.md`: fill "Skills used" from the log, and run `pr-policy` locally before pushing.
- `AGENTS.md`: the workflow section states the gate. The "other tool" review becomes the other tool or a second `review-change` pass; Mohammad is the only approver and merger.
- GitHub setting, applied with `gh api` **after** this PR merges: add `pr-policy` to the required checks on `main` (criterion 8).

Feature-map rows: none; there are no app changes in this PR.

## Threat model
- **Self-reported approval:** the plan's `**Approved:**` line is typed by whoever writes the plan, agent included.
  It records the decision; Mohammad's own merge is the real approval, and he reviews the plan in the PR diff.
- **A false "Skills used" claim:** a human can type it. Mitigations:
  - for agents, it is generated from the hook log;
  - Mohammad reviews the plan, the evidence and the diff before merging;
  - the attestation is not the only gate.
- **An agent weakening the gate in the same PR** (editing `scripts/**` or `ci.yml`): CI runs the PR's own version. Mitigations:
  - Mohammad reviews every merge;
  - `pr-policy` itself declares any change under `scripts/` or `.github/` High-risk, so it needs a plan approved by Mohammad.
- **Injection through the PR body:** the body is parsed as text only, never passed to a shell. Jobs use `pull_request` with read-only `contents` permission.
- **Admin bypass misuse:** a human-only emergency path. The agent guard denies `--admin` in commands it can read.
  A script file the agent writes and then runs is not read (a documented limit), and it runs with Mohammad's
  gh login, which has admin rights: there, only Mohammad's review of merges catches an `--admin` merge.
- **Lock-out:** if `pr-policy` has a bug, every PR is blocked. The admin bypass and the rollback below resolve it.

## Order of work (each its own PR, through the skills)
1. **PR A, this gate** (High-risk). Path: plan approval → tests first → implement → `node scripts/check.mjs` → `/security-review` → `reviewer` → `pr-ready` → Mohammad merges, or I merge on his word if all is green → add `pr-policy` to branch protection (criterion 8).
2. **PR B, revert #8** (Enhanced: multi-package): `git revert 679f666`. Evidence: `check.mjs`, and the dev eval skips scans again.
3. **PR C, rebuild local OvisOCR3** (Enhanced), through every skill:
   - `plan-change`;
   - tests first (`fix-bug` style);
   - implementation;
   - `docproc eval --real` before and after;
   - `verify-app` for F03 (scan upload) and a walk of all feature-map rows in AR and EN, in the Playwright MCP browser, with the **DEMO_PASSWORD you give me** (never read from `.env*`);
   - `reviewer` plus a second `review-change` pass;
   - `pr-ready`;
   - merge when all green and Mohammad says so.

## Rollback
- **PR A:** revert the PR and remove `pr-policy` from the required checks. The protection on `main` before this
  change (read 2026-11-26), to restore with `gh api -X PUT repos/superMohammad/HungerLearn/branches/main/protection`:
  ```json
  {"required_status_checks": {"strict": true, "contexts": ["web", "docproc", "docproc-postgres", "secrets", "web-e2e",
    "workflow-scripts (ubuntu-latest)", "workflow-scripts (macos-latest)", "workflow-scripts (windows-latest)"]},
   "enforce_admins": false,
   "required_pull_request_reviews": {"required_approving_review_count": 0, "require_code_owner_reviews": false,
    "dismiss_stale_reviews": false},
   "restrictions": null, "allow_force_pushes": false, "allow_deletions": false}
  ```
- **PR B/C:** ordinary reverts.

## Open questions
- Teammates keep write access, so GitHub still technically lets them merge. Making that impossible means
  lowering them to read/triage and having them open PRs from forks. That's Mohammad's call; until then it is a
  team rule in AGENTS.md.
- Codex hooks: confirm during the build whether Codex can log skill loads. Until then, Codex users are gated
  by `pr-policy` only.
