// @ts-check
/**
 * PostToolUse hook (Claude Code): logs each repo skill load (Skill tool) and each reviewer subagent run to the
 * current branch's skill log, so `gh pr create` and the PR's "skills:" line rest on what actually happened.
 * Codex does not report skill loads as tool calls; there each skill's first step runs scripts/skill-log.mjs.
 * Unreadable input is an error (exit 1, shown to the agent), never silently skipped.
 */
import { readFileSync } from "node:fs";
import { recordSkill, skillFromHookInput } from "./lib/skill-log.mjs";

/** @type {import("./lib/skill-log.mjs").HookInput} */
let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch (error) {
  console.error(`agent-skill-log-hook: could not read the hook input (${error instanceof Error ? error.message : String(error)}).`);
  process.exit(1);
}
const skill = skillFromHookInput(input);
if (skill !== null) recordSkill(skill, "hook");
