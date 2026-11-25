// @ts-check
/**
 * Stop hook for Claude Code and Codex: an agent may not finish a turn with red checks.
 * Runs check-fast when the working tree changed since the last run. On failure it exits 2 with the
 * failing output on stderr, which sends the agent back to work (both tools document this).
 * It hands over to the human instead of looping when the tree is unchanged since the last red run
 * (the failure is already known) or after MAX_ATTEMPTS red runs in a row.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git, REPO, untrackedFiles } from "./lib/hl.mjs";

const MAX_ATTEMPTS = 5;
readFileSync(0); // the hook input is not needed

const stateDir = path.resolve(REPO, git(["rev-parse", "--git-path", "hl-agent-check"]).trim());
mkdirSync(stateDir, { recursive: true });
/** @param {string} name */
const statePath = (name) => path.join(stateDir, name);
/** @param {string} name */
function readState(name) {
  try {
    return readFileSync(statePath(name), "utf8").trim();
  } catch {
    return "";
  }
}

const hash = createHash("sha256");
hash.update(git(["rev-parse", "HEAD"]));
hash.update(git(["diff", "--no-color", "--no-ext-diff", "HEAD"]));
for (const f of untrackedFiles()) {
  const full = path.join(REPO, f);
  hash.update(f);
  // lstat: a dangling untracked symlink must not crash the hook (a crash would let the turn end silently).
  if (lstatSync(full).isFile()) hash.update(readFileSync(full));
}
const treeHash = hash.digest("hex");

/** Both tools accept an empty JSON object on stdout for "let the turn end". @returns {never} */
function allowStop() {
  console.log("{}");
  process.exit(0);
}

if (readState("green") === treeHash || readState("red") === treeHash) allowStop();

const logFile = statePath("last.log");
const result = spawnSync(process.execPath, [path.join(REPO, "scripts", "check-fast.mjs")], { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const output = `${result.stdout}${result.stderr}`;
writeFileSync(logFile, output);
if (result.status === 0) {
  writeFileSync(statePath("green"), treeHash);
  rmSync(statePath("red"), { force: true });
  rmSync(statePath("attempts"), { force: true });
  allowStop();
}

writeFileSync(statePath("red"), treeHash);
const attempts = Number(readState("attempts") || "0") + 1;
writeFileSync(statePath("attempts"), String(attempts));
if (attempts > MAX_ATTEMPTS) {
  console.error(`check-fast is still failing after ${MAX_ATTEMPTS} attempts (${logFile}). Stopping so a human can decide.`);
  rmSync(statePath("attempts"), { force: true });
  allowStop();
}
const tail = output.split("\n").slice(-60).join("\n");
console.error(
  `scripts/check-fast.mjs failed (attempt ${attempts} of ${MAX_ATTEMPTS}), so the task is not done. ` +
    `Fix the root cause (never skip tests, add suppressions or edit CI/hooks), then finish.\nLast 60 lines of ${logFile}:\n${tail}`,
);
process.exit(2);
