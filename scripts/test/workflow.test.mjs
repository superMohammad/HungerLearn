// @ts-check
/** Tests for the workflow scripts. CI runs them on Linux, macOS and Windows: node scripts/check.mjs scripts */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { IS_WINDOWS, packagesOf, quoteForCmd, REPO, WEB } from "../lib/hl.mjs";

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

/** @typedef {{ command: string, commandWindows: string }} CodexHook */
/** @returns {CodexHook[]} */
function codexHooks() {
  /** @type {{ hooks: Record<string, { hooks: CodexHook[] }[]> }} */
  const config = JSON.parse(readFileSync(path.join(REPO, ".codex", "hooks.json"), "utf8"));
  return Object.values(config.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));
}

/** Run a hook command line the way Codex does: `cmd.exe /C "<line>"` on Windows, `sh -c` elsewhere. @param {string} line @param {string} input */
function runHookLine(line, input) {
  const options = { cwd: WEB, input, encoding: /** @type {const} */ ("utf8") };
  return IS_WINDOWS
    ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/C", `"${line}"`], { ...options, windowsVerbatimArguments: true })
    : spawnSync("sh", ["-c", line], options);
}

test("every Codex hook has a commandWindows that cmd.exe can run (no $(...))", () => {
  for (const hook of codexHooks()) {
    assert.ok(hook.commandWindows, `missing commandWindows for: ${hook.command}`);
    assert.doesNotMatch(hook.commandWindows, /\$\(|[&|<>^%]/);
    assert.equal(hook.commandWindows.match(/scripts\/[\w-]+\.mjs/)?.[0], hook.command.match(/scripts\/[\w-]+\.mjs/)?.[0]);
  }
});

test("the Codex guard hook command blocks a force-push from a subdirectory on this OS", () => {
  const guard = codexHooks().find((h) => h.command.includes("agent-bash-guard-hook.mjs"));
  assert.ok(guard);
  const line = IS_WINDOWS ? guard.commandWindows : guard.command;
  const blocked = runHookLine(line, JSON.stringify({ tool_input: { command: "git push --force origin x" } }));
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(runHookLine(line, JSON.stringify({ tool_input: { command: "git status" } })).status, 0);
});
