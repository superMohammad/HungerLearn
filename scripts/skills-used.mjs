// @ts-check
/**
 * Prints the "skills:" line for the PR description from the current branch's skill log (pr-ready skill).
 * Skills only ever recorded by hand are marked "(manual)".
 * Usage: node scripts/skills-used.mjs
 */
import { runMain } from "./lib/hl.mjs";
import { loggedEntries, skillsUsedLine } from "./lib/skill-log.mjs";

runMain(() => {
  console.log(skillsUsedLine(loggedEntries()));
});
