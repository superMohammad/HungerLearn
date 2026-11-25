// @ts-check
/** Tests for the workflow scripts. CI runs them on Linux, macOS and Windows: node scripts/check.mjs scripts */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { packagesOf, quoteForCmd, REPO } from "../lib/hl.mjs";

const GUARD = path.join(REPO, "scripts", "agent-bash-guard-hook.mjs");

/** @param {string} input @returns {number | null} */
function guardExitFor(input) {
  return spawnSync(process.execPath, [GUARD], { input, encoding: "utf8" }).status;
}

/** @param {string} command */
function guardExit(command) {
  return guardExitFor(JSON.stringify({ tool_input: { command } }));
}

const BLOCKED = [
  "git push origin main",
  "git -C x push origin HEAD:main",
  "git push origin HEAD:refs/heads/main",
  "git push --force origin feat",
  "git push -f",
  "git push origin +feat",
  "git commit --no-verify -m x",
  "git commit -n -m wip",
  "git commit -anm wip",
  "git -c core.hooksPath=/dev/null commit -m wip",
  "git config core.hooksPath x",
  "cd web && git push --force-with-lease origin feat",
  "GIT_TRACE=1 git push origin main",
  "HL_ALLOW_MAIN_PUSH=1 git push origin feat",
  "HL_ALLOW_WEAKENING=x git commit -m wip",
  "export HL_ALLOW_WEAKENING=because",
  "$env:HL_ALLOW_WEAKENING = 'x'",
];
const ALLOWED = [
  "git push -u origin feat/x && gh pr create --base main --fill",
  "git fetch origin main && git push -u origin feat/x",
  "git checkout main && git pull && git push -u origin feat",
  "git push origin feat/x 2>&1 | tail -f",
  "git push origin feat/x; ls -lf",
  "git push -n origin feat",
  "git revert -n HEAD",
  'git commit -m "push to main later"',
  'git commit -m "add the -n flag to docproc"',
  'git commit -m "document HL_ALLOW_WEAKENING=reason"',
  'rg -n "core.hooksPath" scripts',
  'rg -n "HL_ALLOW_WEAKENING" scripts',
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
  assert.equal(guardExitFor("{}"), 0);
});

test("guard fails closed on unreadable input", () => {
  assert.equal(guardExitFor("not json"), 2);
});

test("cmd.exe arguments are quoted only when needed", () => {
  assert.equal(quoteForCmd("lint"), "lint");
  assert.equal(quoteForCmd("C:\\Users\\First Last\\repo"), '"C:\\Users\\First Last\\repo"');
  assert.equal(quoteForCmd(".[dev,pg]"), '".[dev,pg]"');
  assert.equal(quoteForCmd('say "hi"'), '"say ""hi"""');
});

test("changed files map to their packages", () => {
  assert.deepEqual(packagesOf(["web/src/a.ts", "-/docproc/src/x.py", "docs/feature-map.md", "scripts/check.mjs"]), ["web", "docproc", "scripts"]);
  assert.deepEqual(packagesOf(["README.md"]), []);
});
