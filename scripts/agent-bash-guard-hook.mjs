// @ts-check
/**
 * PreToolUse hook (shell tool) for Claude Code and Codex. Blocks commands that bypass the team's safety
 * rails: pushing to main, force-pushing, skipping git hooks, and changing git's hook path.
 * Each command segment (split on && || ; | and newlines) is checked on its own, so a normal
 * `git push -u origin feat && gh pr create --base main` passes. .githooks/pre-push is the backstop for
 * any push to main this misses. Exit 2 with the reason on stderr denies the call in both tools.
 */
import { readFileSync } from "node:fs";

/** @param {string} reason @returns {never} */
function deny(reason) {
  console.error(`Blocked by scripts/agent-bash-guard-hook.mjs: ${reason} Ask the human to do it if it is really needed.`);
  process.exit(2);
}

/** @type {{ tool_input?: { command?: unknown } }} */
const input = JSON.parse(readFileSync(0, "utf8"));
const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";

const GIT_CALL = /^\s*(?:sudo\s+)?git(?:\s+(?:-C|-c)\s+\S+)*\s+(\S+)(.*)$/;
const HOOKED = new Set(["push", "commit", "merge", "rebase", "cherry-pick", "am", "revert"]);

for (const segment of command.split(/&&|\|\||;|\||\n/)) {
  const match = GIT_CALL.exec(segment);
  if (match === null) continue;
  const [, sub, rest] = match;
  const args = ` ${rest} `;
  if (sub === "push") {
    if (/\s(--force\S*|-[a-zA-Z]*f[a-zA-Z]*|\+\S+)\s/.test(args)) deny("agents never force-push.");
    if (/\s(\S*:)?(refs\/heads\/)?main\s/.test(args)) deny("agents never push to main; push a branch and open a PR.");
  }
  if (HOOKED.has(sub) && /\s--no-verify\s/.test(args)) deny("agents never skip git hooks.");
  if (sub === "config" && /core\.hooksPath/i.test(args) && !/\s(--get|--list|-l)\s/.test(args)) deny("agents never change core.hooksPath.");
}
