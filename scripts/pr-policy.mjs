// @ts-check
/**
 * Fails when a pull request does not follow the workflow in AGENTS.md: tier at least what the diff needs,
 * checkboxes ticked or "n/a: <reason>", required sections filled, check.mjs evidence, the PR's own approved
 * plan for Enhanced+, and the skills the tier needs on the "skills:" line. CI runs it on every PR description
 * edit and push (required check pr-policy).
 * Usage: node scripts/pr-policy.mjs <pr-body-file>     # compares this checkout with the merge-base of origin/main
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { baseRev, changedFiles, changedLineCount, CheckFailed, readonlySurfaceFiles, REPO, runMain } from "./lib/hl.mjs";
import { changedPlans, policyProblems, requiredTier } from "./lib/policy.mjs";

runMain(() => {
  const bodyFile = process.argv[2];
  if (bodyFile === undefined) throw new CheckFailed("Usage: node scripts/pr-policy.mjs <pr-body-file>");
  const body = readFileSync(bodyFile, "utf8");
  const base = baseRev();
  const diff = { files: changedFiles(base), changedLines: changedLineCount(base), readonlySurface: readonlySurfaceFiles(base) };
  /** @type {Record<string, string>} */
  const plans = {};
  for (const plan of changedPlans(diff.files)) plans[plan] = readFileSync(path.join(REPO, plan), "utf8");
  const needed = requiredTier(diff);
  console.log(`pr-policy: ${diff.files.length} files, ${diff.changedLines} changed lines since ${base.slice(0, 12)}; the diff needs ${needed.tier}.`);
  const problems = policyProblems({ ...diff, body, plans });
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  if (problems.length > 0) throw new CheckFailed(`pr-policy: ${problems.length} problem(s); fix the PR description or the diff (AGENTS.md → Workflow).`);
  console.log("pr-policy: passed");
});
