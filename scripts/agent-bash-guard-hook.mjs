// @ts-check
/**
 * PreToolUse hook (shell tool) for Claude Code and Codex. Blocks commands that bypass the team's safety
 * rails: pushing to main, force-pushing, skipping or redirecting git hooks, setting the human-only overrides
 * (HL_ALLOW_*), opening a PR before the tier's skills were used, and merging with the admin bypass, while a
 * required check is not green, or through another route (gh api, gh alias). The rules are in
 * scripts/lib/bash-guard.mjs. Exit 2 with the reason on stderr denies the call in both tools. Anything that
 * goes wrong here, including a rule module that fails to load, denies too (fail closed): only Node built-ins
 * are imported statically.
 */
import { readFileSync } from "node:fs";

/** @param {string} reason @returns {never} */
function deny(reason) {
  console.error(`Blocked by scripts/agent-bash-guard-hook.mjs: ${reason} Ask the human to do it if it is really needed.`);
  process.exit(2);
}

try {
  /** @type {{ tool_input?: { command?: unknown } }} */
  const input = JSON.parse(readFileSync(0, "utf8"));
  const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  const { checkCommand, GuardDenied } = await import("./lib/bash-guard.mjs");
  try {
    checkCommand(command);
  } catch (error) {
    if (error instanceof GuardDenied) deny(error.message);
    throw error;
  }
} catch (error) {
  deny(`the guard could not check the command (${error instanceof Error ? error.message : String(error)}), so it is not allowed.`);
}
