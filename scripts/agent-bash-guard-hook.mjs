// @ts-check
/**
 * PreToolUse hook (shell tool) for Claude Code and Codex. Blocks commands that bypass the team's safety
 * rails: pushing to main, force-pushing, skipping or redirecting git hooks, and setting the human-only
 * overrides (HL_ALLOW_*). Each command segment (split on && || ; | and newlines) is checked on its own,
 * so a normal `git push -u origin feat && gh pr create --base main` passes. .githooks/pre-push is the
 * backstop for any push to main this misses. Exit 2 with the reason on stderr denies the call in both
 * tools; unreadable input is denied too (fail closed).
 */
import { readFileSync } from "node:fs";

/** @param {string} reason @returns {never} */
function deny(reason) {
  console.error(`Blocked by scripts/agent-bash-guard-hook.mjs: ${reason} Ask the human to do it if it is really needed.`);
  process.exit(2);
}

/** @returns {string} */
function readCommand() {
  try {
    /** @type {{ tool_input?: { command?: unknown } }} */
    const input = JSON.parse(readFileSync(0, "utf8"));
    return typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  } catch (error) {
    return deny(`could not read the hook input (${error instanceof Error ? error.message : String(error)}).`);
  }
}

/** Human-only overrides: HL_ALLOW_WEAKENING (guard-diff), HL_ALLOW_MAIN_PUSH (pre-push). Bash, env, set, PowerShell. */
const HUMAN_OVERRIDE = /(^|\s)(export\s+|env\s+|set\s+)?HL_ALLOW_\w*=|\$env:HL_ALLOW_\w*\s*=/i;
/** `[VAR=value ...] [env|sudo] git [-C dir | -c key=value | -c key value]... <subcommand> <args>` */
const GIT_CALL = /^\s*(?:(?:\w+=\S*|env|sudo)\s+)*git((?:\s+-C\s+\S+|\s+-c\s*\S+(?:\s+(?!-)\S+)?)*)\s+(\S+)(.*)$/;
const NO_VERIFY_LONG = new Set(["push", "commit", "merge", "rebase", "cherry-pick", "am", "revert"]);

/** Quoted text (commit messages, search patterns) is data, not flags: blank it before matching. */
const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g;

const command = readCommand();
for (const rawSegment of command.split(/&&|\|\||;|\||\n/)) {
  const segment = rawSegment.replace(QUOTED, '""');
  if (HUMAN_OVERRIDE.test(segment)) deny("HL_ALLOW_* overrides are set only by a human.");
  const match = GIT_CALL.exec(segment);
  if (match === null) continue;
  const [, globals, sub, rest] = match;
  const args = ` ${rest} `;
  if (/core\.hooksPath/i.test(globals)) deny("agents never redirect git hooks (-c core.hooksPath).");
  if (sub === "push") {
    if (/\s(--force\S*|-[a-zA-Z]*f[a-zA-Z]*|\+\S+)\s/.test(args)) deny("agents never force-push.");
    if (/\s(\S*:)?(refs\/heads\/)?main\s/.test(args)) deny("agents never push to main; push a branch and open a PR.");
  }
  if (NO_VERIFY_LONG.has(sub) && /\s--no-verify\s/.test(args)) deny("agents never skip git hooks.");
  // Only for commit does -n mean --no-verify (push -n is a dry run, revert -n is --no-commit).
  if (sub === "commit" && /\s-[a-zA-Z]*n[a-zA-Z]*\s/.test(args)) deny("agents never skip git hooks (commit -n).");
  if (sub === "config" && /core\.hooksPath/i.test(args) && !/\s(--get|--list|-l)\s/.test(args)) deny("agents never change core.hooksPath.");
}
