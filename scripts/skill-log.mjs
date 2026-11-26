// @ts-check
/**
 * Records that a repo skill was loaded on the current branch. Every skill's first step runs it, so both
 * Claude Code and Codex leave the same trail; the agent guard reads it before `gh pr create`.
 * Usage: node scripts/skill-log.mjs <skill-name>
 */
import { CheckFailed, runMain } from "./lib/hl.mjs";
import { recordSkill } from "./lib/skill-log.mjs";

runMain(() => {
  const skill = process.argv[2];
  if (skill === undefined || !/^[\w:-]+$/.test(skill)) throw new CheckFailed("Usage: node scripts/skill-log.mjs <skill-name>");
  recordSkill(skill, "manual");
});
