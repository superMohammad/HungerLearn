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
  // Escaped quotes are literal characters to bash; they must not hide the segments between them.
  "echo \\'; git push --force origin main; echo \\'",
  "echo \\'; git push --no-verify origin main; echo \\'",
  "echo \\'; export HL_ALLOW_MAIN_PUSH=1; echo \\'",
  'echo \\"; git push -f origin x; echo \\"',
  "echo $'a\\'b'; git push -f origin x",
  "echo \\'; gh pr merge 12 --admin; echo \\'",
  // An unbalanced quote cannot be read reliably: fail closed.
  "echo 'unterminated; git status",
  // The command name hidden by quotes, escapes, subshells, wrappers or a path.
  '"gh" pr merge 8 --admin',
  "\\gh pr merge 8 --admin",
  "(gh pr merge 8 --admin)",
  "command gh pr merge 8 --admin",
  "/usr/bin/gh pr merge 8 --admin",
  'g"it" push --force origin x',
  // Code run by another shell or substitution is checked as code.
  "bash -c 'gh pr merge 8 --admin'",
  'sh -lc "git push --force origin x"',
  'eval "git push --force origin x"',
  'pwsh -Command "git push --force origin x"',
  'echo "$(gh pr merge 8 --admin)"',
  "echo `git push --force origin x`",
  "cat <<E\n$(git push --force origin x)\nE",
  // A comment's apostrophe does not open a quote.
  "ls # it's here\ngit push --force origin x\necho '",
  // PowerShell reads backslashes literally: this runs three statements there.
  'echo "C:\\"; gh pr merge 8 --admin; echo "\\"',
  // Other ways to merge, and dynamic merge arguments.
  "gh api -X PUT repos/o/r/pulls/8/merge",
  "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
  "gh alias set m 'pr merge --admin'",
  "gh pr merge 8 $FLAGS",
  // A command in any position: keywords, xargs, wrappers with flags, PowerShell blocks and Start-Process.
  "if true; then gh pr merge 8 --admin; fi",
  "for b in x; do git push --force origin $b; done",
  "echo 8 | xargs gh pr merge --admin",
  "timeout 30 git push -f origin x",
  "env -i git push -f origin x",
  "sudo -u x gh pr merge 8 --admin",
  "1 | % { gh pr merge 8 --admin }",
  'Start-Process gh -ArgumentList "pr merge 8 --admin"',
  // gh flags before the subcommand.
  "gh -R o/r pr merge 8 --admin",
  "gh pr -R o/r merge 8 --admin",
  // Code a shell reads from stdin, and PowerShell's other ways to take a command.
  "bash <<'E'\ngh pr merge 8 --admin\nE",
  "echo 'gh pr merge 8 --admin' | sh",
  'sh <<< "git push --force origin x"',
  'powershell "gh pr merge 8 --admin"',
  'pwsh -co "git push -f origin x"',
  "pwsh -ec ZQBjAGgAbwA=",
  'cmd /c"git push -f origin x"',
  '$x = @"\n"\n"@; gh pr merge 8 --admin #"',
  // git aliases and global options that take a value.
  "git -c alias.p='push --force' p origin x",
  "git --git-dir .git push --force origin x",
  'git config alias.p "push --force"',
  "git push --all origin",
  "git push origin main>/dev/null",
  // Other merge routes and override spellings.
  "curl -X PUT https://api.github.com/repos/o/r/pulls/8/merge",
  "${env:HL_ALLOW_X}=1",
  "Set-Item Env:HL_ALLOW_X 1",
  "gh pr merge --squash --admin 2>&1",
  // Exotic spellings with cheap fixes: PowerShell block comments, code inside arithmetic, one merge per command.
  "<# #> gh pr merge 8 --admin",
  "echo $(( $(gh pr merge 8 --admin) ))",
  "gh pr merge 1 --squash && gh pr merge 2 --squash",
  "cat <<\\EOF\nx\nEOF\ngit push --force origin x",
];
const ALLOWED = [
  // gh pr create is gated by the skill log; see the "gh pr create" guard test in policy.test.mjs.
  "git push -u origin feat/x && gh pr view --web",
  'git commit -m "a && git push --force origin main"',
  // node -e takes JavaScript, not shell: its text is data to the guard.
  'node -e "x && gh pr merge 1 --admin"',
  // A quoted heredoc delimiter makes the body data.
  "cat > /tmp/msg <<'E'\nit's fine: git push --force origin main\nE\ngit status",
  "ls # a comment with it's\ngit status",
  // The forms agents use every day must stay allowed.
  "git commit -m \"$(cat <<'EOF'\nFix the guard's parser: 1) a :)\nEOF\n)\"",
  "gh pr edit 9 --body \"$(cat <<'EOF'\nit's (#8) 1) x\nEOF\n)\"",
  'echo "$(echo ")")"',
  'jq . <<< "$json"',
  "cat <<< hello",
  "cat > /tmp/n.md <<'E'\ngit push origin main\nE",
  "git status 2>&1 | tail -5",
  'git commit -m "HL_ALLOW_WEAKENING=x is human-only"',
  "echo $((1 << 2))",
  "git config --get alias.co",
  // A shell running a script file reads the file, not the pipe (the CI pre-push smoke test).
  "printf 'refs/heads/feat a refs/heads/feat b\\n' | sh .githooks/pre-push",
  "echo y | bash scripts/x.sh",
  // A message that quotes a merge URL is text, not a request.
  'git commit -m "deny curl to repos/o/r/pulls/8/merge"',
  "cat <<\\EOF\nliteral $(not run)\nEOF",
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
