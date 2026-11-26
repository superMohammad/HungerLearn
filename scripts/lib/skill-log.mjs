// @ts-check
/**
 * Which repo skills an agent loaded on a branch. Claude Code logs them automatically (PostToolUse hook on
 * the Skill tool and on the reviewer subagent: source "hook"); every skill's first step also runs
 * scripts/skill-log.mjs (source "manual"), which covers Codex, whose skill loads are not tool calls.
 * Manual entries are shown as such on the PR's "skills:" line, so the human sees what was self-reported.
 * The log lives in the shared git dir (.git/hl-skills/), never in the tree, and is shared by worktrees.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { git, REPO } from "./hl.mjs";

/** The PostToolUse fields this file reads (Skill: skill; Agent: subagent_type; Bash: command). */
/** @typedef {{ tool_name?: unknown; tool_input?: { skill?: unknown; subagent_type?: unknown; command?: unknown } }} HookInput */
/** @typedef {"hook" | "manual"} SkillSource */
/** @typedef {{ skill: string; source: SkillSource }} SkillEntry */

/** File name for a branch's log; distinct branches never share a file ("feat/x" → "feat%2Fx.jsonl"). @param {string} branch */
export function skillLogName(branch) {
  return `${encodeURIComponent(branch)}.jsonl`;
}

/** Entries of a log, in load order. @param {string} text @returns {SkillEntry[]} */
export function parseSkillLog(text) {
  return text.split("\n").flatMap((line, i) => {
    if (line.trim() === "") return [];
    /** @type {{ skill?: unknown; source?: unknown }} */
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      throw new Error(`skill log line ${i + 1} is not JSON (${error instanceof Error ? error.message : String(error)}): ${line}`);
    }
    if (typeof entry.skill !== "string" || (entry.source !== "hook" && entry.source !== "manual")) {
      throw new Error(`skill log line ${i + 1} needs a string "skill" and a "source" of hook or manual: ${line}`);
    }
    return [{ skill: entry.skill, source: entry.source }];
  });
}

/** The skill a tool call loaded: the Skill tool's skill, or "reviewer" for the reviewer subagent. @param {HookInput} input */
export function skillFromHookInput(input) {
  if (input.tool_name === "Skill" && typeof input.tool_input?.skill === "string") return input.tool_input.skill;
  if (input.tool_name === "Agent" && input.tool_input?.subagent_type === "reviewer") return "reviewer";
  return null;
}

/** Distinct skills in load order. @param {readonly SkillEntry[]} entries @returns {string[]} */
export function distinctSkills(entries) {
  return [...new Set(entries.map((e) => e.skill))];
}

/** The PR description's "skills:" line; a skill only ever recorded by hand is marked "(manual)". @param {readonly SkillEntry[]} entries */
export function skillsUsedLine(entries) {
  const names = distinctSkills(entries).map((s) => (entries.some((e) => e.skill === s && e.source === "hook") ? s : `${s} (manual)`));
  return `skills: ${names.join(", ")}`;
}

function currentLogPath() {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch === "HEAD") throw new Error("detached HEAD: switch to a branch before using the skill log");
  const commonDir = path.resolve(REPO, git(["rev-parse", "--git-common-dir"]).trim());
  return path.join(commonDir, "hl-skills", skillLogName(branch));
}

/** Append a skill load to the current branch's log. @param {string} skill @param {SkillSource} source */
export function recordSkill(skill, source) {
  const file = currentLogPath();
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ skill, source, at: new Date().toISOString() })}\n`);
}

/** Entries logged on the current branch. @returns {SkillEntry[]} */
export function loggedEntries() {
  const file = currentLogPath();
  return existsSync(file) ? parseSkillLog(readFileSync(file, "utf8")) : [];
}

/** Distinct skills loaded on the current branch. @returns {string[]} */
export function loggedSkills() {
  return distinctSkills(loggedEntries());
}
