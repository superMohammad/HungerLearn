// @ts-check
/**
 * Fast loop: lint, types and unit tests of the packages changed on this branch (committed, uncommitted
 * and untracked), plus guard-diff. No web build. The pre-commit hook and the agents' Stop hook run it.
 *
 * Usage: node scripts/check-fast.mjs
 */
import { checkGuard, checkPackageFast } from "./lib/checks.mjs";
import { baseRev, changedFiles, packagesOf, runMain } from "./lib/hl.mjs";

runMain(() => {
  const packages = packagesOf(changedFiles(baseRev()));
  if (packages.length === 0) console.log("== no package changed; only guard-diff runs");
  for (const pkg of packages) checkPackageFast(pkg);
  checkGuard();
  console.log(`== check-fast passed: ${packages.join(" ") || "(no packages)"}`);
});
