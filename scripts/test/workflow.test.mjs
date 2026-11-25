// @ts-check
/** Tests for the workflow scripts. CI runs them on Linux, macOS and Windows: node scripts/check.mjs scripts */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { packagesOf, REPO } from "../lib/hl.mjs";

const GUARD = path.join(REPO, "scripts", "agent-bash-guard-hook.mjs");

/** @param {string} command @returns {number | null} */
function guardExit(command) {
  return spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_input: { command } }), encoding: "utf8" }).status;
}

const BLOCKED = [
  "git push origin main",
  "git -C x push origin HEAD:main",
  "git push origin HEAD:refs/heads/main",
  "git push --force origin feat",
  "git push -f",
  "git push origin +feat",
  "git commit --no-verify -m x",
  "git config core.hooksPath x",
  "cd web && git push --force-with-lease origin feat",
];
const ALLOWED = [
  "git push -u origin feat/x && gh pr create --base main --fill",
  "git fetch origin main && git push -u origin feat/x",
  "git checkout main && git pull && git push -u origin feat",
  "git push origin feat/x 2>&1 | tail -f",
  "git push origin feat/x; ls -lf",
  'git commit -m "push to main later"',
  'rg -n "core.hooksPath" scripts',
  "rg -- --no-verify .",
  "git config --get core.hooksPath",
  "git status",
];

for (const command of BLOCKED) {
  test(`guard blocks: ${command}`, () => assert.equal(guardExit(command), 2));
}
for (const command of ALLOWED) {
  test(`guard allows: ${command}`, () => assert.equal(guardExit(command), 0));
}

test("guard allows hook input without a command", () => {
  assert.equal(spawnSync(process.execPath, [GUARD], { input: "{}" }).status, 0);
});

test("changed files map to their packages", () => {
  assert.deepEqual(packagesOf(["web/src/a.ts", "-/docproc/src/x.py", "docs/feature-map.md", "scripts/check.mjs"]), ["web", "docproc", "scripts"]);
  assert.deepEqual(packagesOf(["README.md"]), []);
});
