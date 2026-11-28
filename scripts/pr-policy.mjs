// @ts-check
/**
 * Fails when a pull request does not follow the workflow in AGENTS.md: tier at least what the diff needs,
 * checkboxes ticked or "n/a: <reason>", required sections filled, check.mjs evidence, the PR's own approved
 * plan for Enhanced+ (approved by a teammate's GitHub review), and the skills the tier needs on the "skills:" line.
 * CI runs it on every PR description edit, push and review (required check pr-policy).
 * Usage: node scripts/pr-policy.mjs <pr-body-file> <pr-meta-file>   # compares this checkout with the merge-base of origin/main
 * The meta file is the PR's author and reviews: `node scripts/pr-meta.mjs <pr-number> <file>`, or before the PR
 * exists `gh api user --jq '{author: .login, headSha: "none", reviews: []}' > <file>`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { baseRev, changedFiles, changedLineCount, CheckFailed, isRegularFile, readonlySurfaceFiles, REPO, runMain } from "./lib/hl.mjs";
import { changedPlans, parsePrMeta, policyProblems, requiredTier } from "./lib/policy.mjs";

runMain(() => {
  const [bodyFile, metaFile] = process.argv.slice(2);
  if (bodyFile === undefined || metaFile === undefined) throw new CheckFailed("Usage: node scripts/pr-policy.mjs <pr-body-file> <pr-meta-file>");
  const body = readFileSync(bodyFile, "utf8");
  const meta = parsePrMeta(readFileSync(metaFile, "utf8"));
  const base = baseRev();
  const diff = { files: changedFiles(base), changedLines: changedLineCount(base), readonlySurface: readonlySurfaceFiles(base) };
  /** @type {Record<string, string>} */
  const plans = {};
  // changedFiles lists deletions too (they still count for the tier); a plan this PR deletes cannot be its plan,
  // and neither can a symlink or directory.
  for (const plan of changedPlans(diff.files).filter(isRegularFile)) {
    plans[plan] = readFileSync(path.join(REPO, plan), "utf8");
  }
  const needed = requiredTier(diff);
  console.log(`pr-policy: ${diff.files.length} files, ${diff.changedLines} changed lines since ${base.slice(0, 12)}; the diff needs ${needed.tier}.`);
  const problems = policyProblems({ ...diff, body, plans, meta });
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  if (problems.length > 0) throw new CheckFailed(`pr-policy: ${problems.length} problem(s); fix the PR description or the diff (AGENTS.md → Workflow).`);
  console.log("pr-policy: passed");
});
