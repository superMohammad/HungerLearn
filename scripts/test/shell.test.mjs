// @ts-check
/** Tests for the shell lexer the agent guard uses (scripts/lib/shell.mjs). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BASH, parseCommand, POWERSHELL } from "../lib/shell.mjs";

test("bash words: quotes removed but words kept whole; separators only outside quotes", () => {
  assert.deepEqual(parseCommand('git commit -m "a && b"; git push origin x', BASH)?.commands,
    [["git", "commit", "-m", "a && b"], ["git", "push", "origin", "x"]]);
  assert.deepEqual(parseCommand('"gh" pr merge; g"h" x; \\gh y', BASH)?.commands, [["gh", "pr", "merge"], ["gh", "x"], ["gh", "y"]]);
  assert.deepEqual(parseCommand("echo \\'; git push -f; echo \\'", BASH)?.commands, [["echo", "'"], ["git", "push", "-f"], ["echo", "'"]]);
  assert.deepEqual(parseCommand("echo $'it\\'s'; ls", BASH)?.commands, [["echo", "it's"], ["ls"]]);
  assert.deepEqual(parseCommand("a & b | c || d\ne (f)", BASH)?.commands, [["a"], ["b"], ["c"], ["d"], ["e"], ["f"]]);
  assert.equal(parseCommand("echo 'open", BASH), null);
  assert.equal(parseCommand('echo "open', BASH), null);
});

test("bash comments: skipped to the end of the line, apostrophes inside them open nothing", () => {
  assert.deepEqual(parseCommand("ls # it's here\ngit status", BASH)?.commands, [["ls"], ["git", "status"]]);
  assert.deepEqual(parseCommand("echo a#b", BASH)?.commands, [["echo", "a#b"]]);
});

test("bash code inside words: $(...) and backticks are collected as nested commands, also inside double quotes", () => {
  assert.deepEqual(parseCommand('echo "$(gh pr merge 8 --admin)" `git push -f`', BASH)?.nested, ["gh pr merge 8 --admin", "git push -f"]);
  assert.deepEqual(parseCommand("echo '$(not code)'", BASH)?.nested, []);
  assert.deepEqual(parseCommand("x $(a $(b) c)", BASH)?.nested, ["a $(b) c"]);
});

test("bash heredocs: a quoted delimiter makes the body data; an unquoted one still runs $(...)", () => {
  const quoted = parseCommand("cat > f <<'E'\nit's text; git push --force origin main\nE\nls", BASH);
  assert.deepEqual(quoted?.commands, [["cat"], ["ls"]]);
  assert.deepEqual(parseCommand("cat <<E\n$(gh pr merge 1 --admin)\nE", BASH)?.nested, ["gh pr merge 1 --admin"]);
  assert.equal(parseCommand("cat <<'E'\nnever closed", BASH), null);
});

test("bash $(...) is scanned with the full rules: heredocs, quotes, comments and odd parentheses inside", () => {
  const commit = "git commit -m \"$(cat <<'EOF'\nFix the guard's parser: 1) a :)\nEOF\n)\"";
  const parsed = parseCommand(commit, BASH);
  assert.equal(parsed?.commands[0][0], "git");
  assert.deepEqual(parsed?.nested.length, 1);
  assert.deepEqual(parseCommand('echo "$(echo ")")"', BASH)?.commands, [["echo", '$(echo ")")']]);
  assert.deepEqual(parseCommand("echo $((1 << 2))", BASH)?.nested, []);
});

test("bash redirections are not words; here-strings are not heredocs; pipes are recorded", () => {
  assert.deepEqual(parseCommand("gh pr merge --squash 2>&1 | tail -5", BASH)?.commands, [["gh", "pr", "merge", "--squash"], ["tail", "-5"]]);
  assert.deepEqual(parseCommand("git push origin main>/dev/null", BASH)?.commands, [["git", "push", "origin", "main"]]);
  assert.deepEqual(parseCommand("cmd &> log; x > out.txt y", BASH)?.commands, [["cmd"], ["x", "y"]]);
  const here = parseCommand('jq . <<< "$json"; sh <<< hello', BASH);
  assert.deepEqual(here?.commands, [["jq", "."], ["sh"]]);
  assert.deepEqual(here?.stdin, [["$json"], ["hello"]]);
  assert.deepEqual(parseCommand("echo x | sh", BASH)?.piped, [false, true]);
});

test("bash heredoc bodies are kept with the command that reads them", () => {
  const parsed = parseCommand("bash <<'E'\ngh pr merge 8 --admin\nE\nls", BASH);
  assert.deepEqual(parsed?.commands, [["bash"], ["ls"]]);
  assert.deepEqual(parsed?.stdin, [["gh pr merge 8 --admin\n"], []]);
});

test("PowerShell rejects an unquoted <, so a bash heredoc has no PowerShell reading", () => {
  assert.equal(parseCommand("cat > n.md <<'E'\ngit push origin main\nE", POWERSHELL), null);
});

test("PowerShell here-strings: @'...'@ is data, @\"...\"@ collects $(...) code", () => {
  const parsed = parseCommand('$x = @"\n"\n"@; gh pr merge 8 --admin #"', POWERSHELL);
  assert.deepEqual(parsed?.commands.at(-1), ["gh", "pr", "merge", "8", "--admin"]);
  assert.deepEqual(parseCommand('$x = @"\n$(git push -f)\n"@', POWERSHELL)?.nested, ["git push -f"]);
});

test("PowerShell words: backtick escapes, doubled quotes, backslash is literal", () => {
  assert.deepEqual(parseCommand('echo "C:\\"; gh pr merge 8 --admin; echo "\\"', POWERSHELL)?.commands,
    [["echo", "C:\\"], ["gh", "pr", "merge", "8", "--admin"], ["echo", "\\"]]);
  assert.deepEqual(parseCommand("echo 'it''s' `; x", POWERSHELL)?.commands, [["echo", "it's", ";", "x"]]);
  assert.deepEqual(parseCommand("$env:HL_ALLOW_X = 'y'", POWERSHELL)?.commands, [["$env:HL_ALLOW_X", "=", "y"]]);
});
