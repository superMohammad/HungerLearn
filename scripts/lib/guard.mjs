// @ts-check
/**
 * Guard the guards: finds changes that weaken checks instead of fixing code. Scans lines added since a
 * base revision (committed, uncommitted and untracked code files) for skipped/focused tests, lint and
 * type suppressions and disabled strictness, and lists deleted test files.
 */
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { git, lines, REPO, untrackedFiles } from "./hl.mjs";

const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|json)$/;
const TEST_FILE = /(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py|[^/]*\.(test|spec)\.(ts|tsx|mts|js|mjs))$/;
const WEAKENING = new RegExp(
  [
    String.raw`\b(it|test|describe)\.(skip|only|todo)\(`,
    String.raw`\{ *(skip|only|todo): *true`,
    String.raw`\bt\.skip\(`,
    "eslint-disable",
    "@ts-ignore",
    "@ts-expect-error",
    "@ts-nocheck",
    String.raw`pytest\.mark\.(skip|xfail)\b`,
    String.raw`pytest\.skip\(`,
    "type: *ignore",
    "pyright: *ignore",
    "# *noqa",
    `"strict": *false`,
    `"noImplicitAny": *false`,
  ].join("|"),
);
/** The guard's own source names every pattern; scanning it would always fail. */
const SELF = "scripts/lib/guard.mjs";

/** @typedef {{ file: string; line: string }} AddedLine */
/** @typedef {{ suppressions: AddedLine[]; deletedTests: string[] }} GuardResult */

/** @param {string} base @returns {AddedLine[]} */
function addedLines(base) {
  /** @type {AddedLine[]} */
  const added = [];
  let file = "";
  const diff = git(["diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "-U0", base]);
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) file = line.startsWith("+++ b/") ? line.slice(6) : "";
    else if (line.startsWith("+") && !line.startsWith("+++")) added.push({ file, line: line.slice(1) });
  }
  for (const f of untrackedFiles()) {
    const full = path.join(REPO, f);
    if (!CODE_FILE.test(f) || !lstatSync(full).isFile()) continue;
    for (const line of readFileSync(full, "utf8").split("\n")) added.push({ file: f, line });
  }
  return added;
}

/** @param {string} base @returns {GuardResult} */
export function findWeakening(base) {
  const suppressions = addedLines(base).filter((a) => a.file !== SELF && CODE_FILE.test(a.file) && WEAKENING.test(a.line));
  const deletedTests = lines(git(["diff", "--name-only", "--no-renames", "--diff-filter=D", base])).filter((f) => TEST_FILE.test(f));
  return { suppressions, deletedTests };
}

/**
 * Prints the result; returns true when the change may proceed. HL_ALLOW_WEAKENING (set by a human,
 * or by the CI label allow-weakening) lets it pass with the findings printed.
 * @param {GuardResult} result
 */
export function reportWeakening(result) {
  if (result.suppressions.length === 0 && result.deletedTests.length === 0) {
    console.log("guard-diff: no weakened checks");
    return true;
  }
  console.error("guard-diff: this change weakens checks.");
  if (result.suppressions.length > 0) {
    console.error("Added suppressions / skipped tests:");
    for (const s of result.suppressions) console.error(`  ${s.file}: ${s.line.trim()}`);
  }
  if (result.deletedTests.length > 0) {
    console.error("Deleted test files:");
    for (const f of result.deletedTests) console.error(`  ${f}`);
  }
  console.error("Fix the root cause instead: make the test pass, fix the type, satisfy the lint rule.");
  console.error('If the weakening is truly needed, a human sets HL_ALLOW_WEAKENING="<reason>" (CI: label allow-weakening) and links an issue.');
  const allowed = process.env.HL_ALLOW_WEAKENING;
  if (allowed !== undefined && allowed !== "") {
    console.error(`guard-diff: allowed by a human: ${allowed}`);
    return true;
  }
  return false;
}
