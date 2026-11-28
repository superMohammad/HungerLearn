// @ts-check
/**
 * The agent guard's rules (scripts/agent-bash-guard-hook.mjs is only the entry point). The command is parsed
 * into words (scripts/lib/shell.mjs) with bash rules and with PowerShell rules, and every simple command is
 * checked in both readings. A `git`, `gh`, shell or `eval` word is checked wherever it stands in a command
 * (`then gh …`, `xargs gh …`, `timeout 30 git …`), so quoting, wrappers, keywords and paths cannot hide it.
 * Code run elsewhere is checked the same way: `bash -c`, a shell's heredoc or here-string stdin, `pwsh`
 * arguments, `cmd /c`, `eval`, `Start-Process`, `$(…)`, backticks and unquoted heredocs. Code piped into a
 * shell is denied. Each distinct command is checked once, and `gh pr checks` runs at most once per target.
 * Known limits (a rail, not a sandbox): aliases defined in earlier commands, script files a command runs,
 * GraphQL queries read from files, and variable values are not read. Such a script runs with the owner's gh
 * login, which has admin rights, so an `--admin` merge inside it is caught only by the team reviewing merges;
 * .githooks/pre-push and branch protection remain the backstops for pushes.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { baseRev, changedFiles, changedLineCount, readonlySurfaceFiles, REPO } from "./hl.mjs";
import { mergeProblem, mergeTarget, missingSkills, requiredSkills, requiredTier, usesAdminBypass } from "./policy.mjs";
import { BASH, parseCommand, POWERSHELL } from "./shell.mjs";
import { loggedSkills } from "./skill-log.mjs";

/** A command the rules do not allow; the message says which rule and what to do. */
export class GuardDenied extends Error {}

/** @param {string} reason @returns {never} */
function denyWith(reason) {
  throw new GuardDenied(reason);
}

/** Per-run state: each command is checked once, and `gh pr checks` runs once per target. */
/** @typedef {{ seen: Set<string>; checks: Map<string, number | null>; createChecked: boolean }} Run */

/** Nested shells deeper than this are not read; they are denied. */
const MAX_DEPTH = 4;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const POWERSHELLS = new Set(["pwsh", "powershell"]);
const START_PROCESS = new Set(["start-process", "saps", "start"]);
/** Commands whose arguments are variable assignments. */
const ASSIGNERS = new Set(["export", "declare", "typeset", "local", "readonly", "env", "set", "setx"]);
const NO_VERIFY_SUBCOMMANDS = new Set(["push", "commit", "merge", "rebase", "cherry-pick", "am", "revert"]);
/** git global options whose value is the next word. */
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);
/** gh flags before the subcommand whose value is the next word. */
const GH_REPO_FLAGS = new Set(["-R", "--repo"]);
/** One `gh pr checks` call stays well inside the hook's 10 s timeout. */
const GH_TIMEOUT_MS = 6000;
const PULL_MERGE_URL = /\/pulls\/\d+\/merge\b/;
/** Commands that send HTTP requests: a merge URL in their words is a merge. */
const HTTP_CLIENTS = new Set(["curl", "wget", "http", "https", "invoke-restmethod", "irm", "invoke-webrequest", "iwr"]);

/** Command name as the OS resolves it: no directory, no .exe/.cmd, lower case. @param {string} word */
function commandName(word) {
  return path.basename(word.replaceAll("\\", "/")).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

/** Setting HL_ALLOW_* in any shell: prefix assignments, export/env/set arguments, PowerShell env writes. @param {readonly string[]} words */
function checkHumanOverrides(words) {
  const isOverride = (/** @type {string} */ w) => /^HL_ALLOW_\w*=/i.test(w);
  const prefix = words.findIndex((w) => !/^\w+=/.test(w));
  if (words.slice(0, prefix < 0 ? words.length : prefix).some(isOverride)) denyWith("HL_ALLOW_* overrides are set only by a human.");
  words.forEach((w, k) => {
    if (ASSIGNERS.has(commandName(w)) && words.slice(k + 1).some(isOverride)) denyWith("HL_ALLOW_* overrides are set only by a human.");
  });
  if (words.some((w) => /^(\$\{?)?env:HL_ALLOW_/i.test(w)) || (words.some((w) => /SetEnvironmentVariable/i.test(w)) && words.some((w) => /HL_ALLOW_/i.test(w)))) {
    denyWith("HL_ALLOW_* overrides are set only by a human.");
  }
}

/** @param {string} sub @param {readonly string[]} args */
function checkGitSubcommand(sub, args) {
  if (sub === "push") {
    if (args.some((a) => /^--force/.test(a) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) || a.startsWith("+"))) denyWith("agents never force-push.");
    if (args.some((a) => /^(\S*:)?(refs\/heads\/)?main$/.test(a))) denyWith("agents never push to main; push a branch and open a PR.");
    if (args.some((a) => a === "--all" || a === "--mirror")) denyWith("agents push one branch at a time (--all/--mirror also push main).");
  }
  if (NO_VERIFY_SUBCOMMANDS.has(sub) && args.includes("--no-verify")) denyWith("agents never skip git hooks.");
  // Only for commit does -n mean --no-verify (push -n is a dry run, revert -n is --no-commit).
  if (sub === "commit" && args.some((a) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a))) denyWith("agents never skip git hooks (commit -n).");
  const reading = args.some((a) => ["--get", "--get-all", "--list", "-l", "--get-regexp"].includes(a));
  if (sub === "config" && args.some((a) => /core\.hookspath/i.test(a)) && !reading) denyWith("agents never change core.hooksPath.");
  if (sub === "config" && args.some((a) => /^alias\./i.test(a)) && !reading) denyWith("agents never define git aliases (an alias can hide a push).");
}

/** `git [global options]… <subcommand> <args>`; `words[0]` is git. @param {readonly string[]} words */
function checkGit(words) {
  let i = 1;
  while (i < words.length && words[i].startsWith("-")) {
    const option = words[i];
    const value = GIT_VALUE_OPTIONS.has(option) ? (words[i + 1] ?? "") : option.slice(option.indexOf("=") + 1);
    if (option === "-c" || option.startsWith("-c") || option.startsWith("--config-env")) {
      if (/core\.hookspath/i.test(value) || /core\.hookspath/i.test(option)) denyWith("agents never redirect git hooks (-c core.hooksPath).");
      if (/^alias\./i.test(value) || /^-calias\./i.test(option)) denyWith("agents never define git aliases (an alias can hide a push).");
    }
    i += GIT_VALUE_OPTIONS.has(option) ? 2 : 1;
  }
  if (i < words.length) checkGitSubcommand(words[i], words.slice(i + 1));
}

/** Deny `gh pr create` until the skills this branch's tier needs are in its skill log. @param {Run} run */
function checkPrCreate(run) {
  if (run.createChecked) return;
  run.createChecked = true;
  const base = baseRev();
  const files = changedFiles(base);
  const { tier } = requiredTier({ files, changedLines: changedLineCount(base), readonlySurface: readonlySurfaceFiles(base) });
  const missing = missingSkills(requiredSkills(tier, files), loggedSkills());
  if (missing.length > 0) {
    denyWith(`this ${tier} branch has not loaded the skills ${missing.join(", ")} (scripts/lib/skill-log.mjs); follow them before opening the PR.`);
  }
}

/** Deny `gh pr merge` with dynamic arguments or while a required check is not green. @param {string[]} args @param {Run} run */
function checkPrMerge(args, run) {
  if (args.some((a) => a.includes("$") || a.includes("`"))) denyWith("pass gh pr merge arguments literally ($ or backticks could add --admin at run time).");
  const target = mergeTarget(args);
  const key = target.join(" ");
  // One merge per command keeps the gh pr checks calls inside the hook's timeout.
  if (!run.checks.has(key) && run.checks.size > 0) denyWith("merge one PR per command.");
  if (!run.checks.has(key)) {
    const checks = spawnSync("gh", ["pr", "checks", ...target, "--required"], { cwd: REPO, encoding: "utf8", timeout: GH_TIMEOUT_MS });
    run.checks.set(key, checks.status);
  }
  const problem = mergeProblem(args, run.checks.get(key) ?? null);
  if (problem !== null) denyWith(problem);
}

/** `gh [-R repo] <group> [-R repo] <action> <args>`; `words[0]` is gh. @param {readonly string[]} words @param {Run} run */
function checkGh(words, run) {
  if (words.includes("merge") && usesAdminBypass(words)) denyWith(/** @type {string} */ (mergeProblem(["--admin"], 0)));
  /** @type {string[]} */
  const positional = [];
  /** @type {string[]} */
  const repo = [];
  let i = 1;
  for (; i < words.length && positional.length < 2; i += 1) {
    const w = words[i];
    if (GH_REPO_FLAGS.has(w)) {
      repo.push("--repo", words[i + 1] ?? "");
      i += 1;
    } else if (w.startsWith("--repo=")) repo.push("--repo", w.slice("--repo=".length));
    else if (!w.startsWith("-")) positional.push(w);
  }
  const [group, action] = positional;
  if (group === "pr" && (action === "create" || action === "new")) checkPrCreate(run);
  if (group === "pr" && action === "merge") checkPrMerge([...words.slice(i), ...repo], run);
  if (group === "api" && words.some((w) => /mergePullRequest/.test(w) || PULL_MERGE_URL.test(w))) {
    denyWith("agents merge only with gh pr merge, which checks the required checks.");
  }
  if (group === "alias" && (action === "set" || action === "import")) denyWith("agents never define gh aliases (an alias can hide a merge).");
}

/**
 * The code a shell-like command runs, from its words (`words[0]` is the command), or null.
 * @param {string} name @param {readonly string[]} words
 */
function codeArgument(name, words) {
  const rest = words.slice(1);
  if (name === "eval") return rest.join(" ");
  if (SHELLS.has(name)) {
    const flag = rest.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w));
    return flag < 0 ? null : rest.slice(flag + 1).join(" ");
  }
  if (POWERSHELLS.has(name)) {
    if (rest.some((w) => /^[-/]{1,2}e(c|n\w*)?$/i.test(w))) denyWith("agents never pass encoded PowerShell commands.");
    const flag = rest.findIndex((w) => /^[-/]{1,2}c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(w));
    return flag < 0 ? rest.filter((w) => !/^[-/]/.test(w)).join(" ") : rest.slice(flag + 1).join(" ");
  }
  if (name === "cmd") {
    const flag = rest.findIndex((w) => /^\/[ck]/i.test(w));
    return flag < 0 ? null : [rest[flag].slice(2), ...rest.slice(flag + 1)].join(" ");
  }
  if (START_PROCESS.has(name)) return rest.filter((w) => !w.startsWith("-")).join(" ");
  return null;
}

/**
 * @param {string[]} words one simple command @param {readonly string[]} stdin heredoc / here-string bodies it reads
 * @param {boolean} piped a pipe feeds its stdin @param {number} depth @param {Run} run
 */
function checkSimpleCommand(words, stdin, piped, depth, run) {
  const key = JSON.stringify([words, stdin, piped]);
  if (run.seen.has(key)) return;
  run.seen.add(key);
  checkHumanOverrides(words);
  words.forEach((word, k) => {
    const name = commandName(word);
    const at = words.slice(k);
    if (name === "git") checkGit(at);
    if (name === "gh") checkGh(at, run);
    if (HTTP_CLIENTS.has(name) && at.some((w) => PULL_MERGE_URL.test(w))) denyWith("agents merge only with gh pr merge, which checks the required checks.");
    const code = codeArgument(name, at);
    if (code !== null) checkText(code, depth + 1, run);
    // A shell with a script operand runs the file (a known limit); without one, or with -s, it runs its stdin.
    const readsStdin = SHELLS.has(name) && code === null && (at.slice(1).every((w) => w.startsWith("-")) || at.includes("-s"));
    if (readsStdin) {
      if (piped && k === 0) denyWith("agents never pipe code into a shell; write it to a file or use bash -c so it can be checked.");
      for (const body of stdin) checkText(body, depth + 1, run);
    }
  });
}

/** Check a command line in both dialects, then the code nested in it. @param {string} text @param {number} depth @param {Run} run */
function checkText(text, depth, run) {
  if (depth > MAX_DEPTH) denyWith("the command nests shells too deeply to be checked.");
  const bash = parseCommand(text, BASH);
  if (bash === null) denyWith("a quote, substitution or heredoc in the command does not close, so it cannot be checked safely.");
  // A command PowerShell cannot parse does not run there either, so only a parsed reading is checked.
  const powershell = parseCommand(text, POWERSHELL);
  for (const parsed of powershell === null ? [bash] : [bash, powershell]) {
    parsed.commands.forEach((words, k) => checkSimpleCommand(words, parsed.stdin[k], parsed.piped[k], depth, run));
    for (const nested of parsed.nested) checkText(nested, depth + 1, run);
  }
}

/** Throws GuardDenied when the command line breaks a rule. @param {string} command */
export function checkCommand(command) {
  checkText(command, 0, { seen: new Set(), checks: new Map(), createChecked: false });
}
