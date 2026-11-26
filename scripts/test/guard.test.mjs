// @ts-check
/**
 * End-to-end tests of the agent guard hook (scripts/agent-bash-guard-hook.mjs) on gates that depend on the
 * repository: each test copies scripts/ into a throwaway git repo, so the guard reads that repo's diff and
 * skill log, never this machine's.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO } from "../lib/hl.mjs";

/** @typedef {{ dir: string; guard: (command: string) => import("node:child_process").SpawnSyncReturns<string>; logFile: string }} Sandbox */

/** A repo on branch feat/x whose only change is under scripts/ (High-risk), with this guard copied in. @returns {Sandbox} */
function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hl-guard-"));
  cpSync(path.join(REPO, "scripts"), path.join(dir, "scripts"), { recursive: true });
  /** @param {string[]} args */
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.test", ...args], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  };
  writeFileSync(path.join(dir, "README.md"), "x\n");
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-q", "-c", "feat/x");
  writeFileSync(path.join(dir, "scripts", "new-check.mjs"), "// a High-risk change\n");
  const hook = path.join(dir, "scripts", "agent-bash-guard-hook.mjs");
  return {
    dir,
    logFile: path.join(dir, ".git", "hl-skills", "feat%2Fx.jsonl"),
    guard: (command) => spawnSync(process.execPath, [hook], { cwd: dir, input: JSON.stringify({ tool_input: { command } }), encoding: "utf8" }),
  };
}

/** @param {Sandbox} box @param {string[]} skills */
function logSkills(box, skills) {
  mkdirSync(path.dirname(box.logFile), { recursive: true });
  for (const skill of skills) appendFileSync(box.logFile, `${JSON.stringify({ skill, source: "hook", at: "t" })}\n`);
}

test("guard: gh pr create and gh pr new need the tier's skills in the branch's skill log", (t) => {
  const box = sandbox();
  t.after(() => rmSync(box.dir, { recursive: true, force: true }));
  for (const command of ["git push -u origin feat/x && gh pr create --fill", "gh pr new --fill"]) {
    const denied = box.guard(command);
    assert.equal(denied.status, 2, command);
    assert.match(denied.stderr, /High-risk branch has not loaded the skills plan-change, review-change\|reviewer, pr-ready, security-review/);
  }
  logSkills(box, ["plan-change", "reviewer", "pr-ready", "security-review"]);
  const allowed = box.guard("gh pr create --fill");
  assert.equal(allowed.status, 0, allowed.stderr);
});

test("guard: a broken skill log or rule module denies (fail closed), never lets the command through", (t) => {
  const box = sandbox();
  t.after(() => rmSync(box.dir, { recursive: true, force: true }));
  logSkills(box, ["plan-change"]);
  appendFileSync(box.logFile, "not json\n");
  const badLog = box.guard("gh pr create --fill");
  assert.equal(badLog.status, 2);
  assert.match(badLog.stderr, /could not check the command.*skill log line 2/);
  writeFileSync(path.join(box.dir, "scripts", "lib", "bash-guard.mjs"), "export const = ;\n");
  const badModule = box.guard("git status");
  assert.equal(badModule.status, 2);
  assert.match(badModule.stderr, /could not check the command/);
});

test("readonlySurfaceFiles: a removed SQL comment mentioning readiness_v counts, and names its file", (t) => {
  const box = sandbox();
  t.after(() => rmSync(box.dir, { recursive: true, force: true }));
  const git = (/** @type {string[]} */ ...args) => spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.test", ...args], { cwd: box.dir, encoding: "utf8" });
  writeFileSync(path.join(box.dir, "q.sql"), "-- reads readiness_v\nSELECT 1;\n");
  git("add", "q.sql");
  git("commit", "-q", "-m", "sql");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(path.join(box.dir, "q.sql"), "SELECT 1;\n");
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { readonlySurfaceFiles, baseRev } from ${JSON.stringify(pathToFileURL(path.join(box.dir, "scripts", "lib", "hl.mjs")).href)};
     console.log(JSON.stringify(readonlySurfaceFiles(baseRev())));`], { cwd: box.dir, encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(JSON.parse(probe.stdout), ["q.sql"]);
});

const GUARD = path.join(REPO, "scripts", "agent-bash-guard-hook.mjs");
/** @param {string} command */
function guardRun(command) {
  return spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_input: { command } }), encoding: "utf8" });
}

test("guard: agents never use the admin bypass to merge, in any spelling", () => {
  for (const command of ["gh pr merge 8 --squash --admin", "gh pr merge --admin", "cd web && gh pr merge 3 --admin --squash",
    "gh pr merge 8 --squash --admin=true", "gh pr merge 8 --admin=1", 'gh pr merge 8 "--admin"', "gh pr merge 8 --adm'in'"]) {
    const r = guardRun(command);
    assert.equal(r.status, 2, command);
    assert.match(r.stderr, /admin/, command);
  }
});
