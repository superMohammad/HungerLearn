// @ts-check
/**
 * THE verification entrypoint. Agents, git hooks, CI and humans all run it; "done" means it passes.
 * Lint, types, unit tests and the web build for the named packages, then guard-diff.
 *
 * Usage: node scripts/check.mjs                 # every package
 *        node scripts/check.mjs web docproc     # only these packages (CI runs one package per job)
 */
import { checkGuard, checkPackageFast, checkWebBuild } from "./lib/checks.mjs";
import { CheckFailed, isPackage, PACKAGES, runMain } from "./lib/hl.mjs";

runMain(() => {
  const names = process.argv.slice(2);
  const unknown = names.filter((n) => !isPackage(n));
  if (unknown.length > 0) throw new CheckFailed(`Unknown package(s): ${unknown.join(", ")} (expected: ${PACKAGES.join(", ")})`);
  const packages = names.length === 0 ? PACKAGES : names.filter(isPackage);
  for (const pkg of packages) {
    checkPackageFast(pkg);
    if (pkg === "web") checkWebBuild();
  }
  checkGuard();
  console.log(`== check passed: ${packages.join(" ")}`);
});
