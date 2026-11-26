// @ts-check
/**
 * The PR policy: what AGENTS.md (Workflow → Risk tiers, Definition of done) demands of a pull request,
 * as pure functions over its description, changed files and size. scripts/pr-policy.mjs runs it in CI
 * and locally; the agent guard uses the tier and skill rules before `gh pr create`.
 * The PR description is data: it is only parsed, never executed.
 */
import { packagesOf } from "./hl.mjs";

/** @typedef {"Minimal" | "Standard" | "Enhanced" | "High-risk"} Tier */
/** @type {readonly Tier[]} */
export const TIERS = ["Minimal", "Standard", "Enhanced", "High-risk"];
/** The only human who approves plans and merges (AGENTS.md → Always human-controlled). */
export const APPROVER = "@superMohammad";
/** Enhanced starts above this many changed lines (AGENTS.md: "diff over ~400 lines"). */
const MAX_STANDARD_LINES = 400;

/**
 * AGENTS.md High-risk paths, plus what controls the rules themselves (AGENTS.md/CLAUDE.md, the skills and
 * their symlinks, lint/type config), the shared database and docproc's schema. A test keeps this in step
 * with .github/CODEOWNERS.
 */
const HIGH_RISK = [
  /^web\/src\/lib\/(session|accounts|db|sql-guard|readiness)\.ts$/,
  /^web\/db\/migrations\//,
  /^\.github\//,
  /^\.githooks\//,
  /^scripts\//,
  /^\.claude\//,
  /^\.codex\//,
  /^\.agents\/skills\//,
  /^skills\//,
  /(^|\/)(AGENTS|CLAUDE)\.md$/,
  /^web\/(eslint\.config\.mjs|tsconfig\.json)$/,
  /(^|\/)docker-compose\.yml$/,
  /^-\/docproc\/src\/docproc\/storage\/schema_\w+\.sql$/,
];
/** Prompt, model, generation, pipeline, docproc identity and evaluation changes (AGENTS.md → Enhanced). */
const ENHANCED = [
  /^hunger-learn-training-generator-prompt\.md$/,
  /^web\/src\/lib\/(generation|pipeline|ai)\.ts$/,
  /^-\/docproc\/src\/docproc\/(graphs|llm|ocr|loaders|embeddings)\//,
  /^-\/docproc\/src\/docproc\/(matching|pipeline|normalize|evaluation)\.py$/,
  /^data\/synthetic_sops\//,
];
const APP_CODE = /^(web|-\/docproc|media)\//;
/** Files a user sees: these need verify-app evidence. */
const UI = [/^web\/src\/app\//, /^web\/src\/components\//, /^web\/src\/lib\/i18n\//, /^web\/src\/proxy\.ts$/];
const PLAN_FILE = /^docs\/plans\/[\w.-]+\.md$/;
const NA_WITH_REASON = /\bn\/a\b[\s:,(—–-]+\S{2,}/i;
/** Task-list items in every markdown spelling: `- [ ]`, `* [ ]`, `+ [ ]`, `1. [ ]`. */
const UNTICKED = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s*(.*)$/;

/** @param {Tier} tier */
function rank(tier) {
  return TIERS.indexOf(tier);
}

/** @param {Tier} a @param {Tier} b @returns {Tier} */
function higher(a, b) {
  return rank(a) >= rank(b) ? a : b;
}

/** Descriptions edited on github.com arrive with CRLF line ends; comments are not content. @param {string} text */
function normalized(text) {
  return text.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
}

/** The tier on the `**Risk tier:**` line, or null when it is missing or still lists several. @param {string} body @returns {Tier | null} */
export function declaredTier(body) {
  const line = normalized(body).split("\n").find((l) => l.includes("**Risk tier:**"));
  if (line === undefined) return null;
  const found = TIERS.filter((t) => new RegExp(`(^|[^\\w-])${t}($|[^\\w-])`).test(line.slice(line.indexOf("**Risk tier:**"))));
  return found.length === 1 ? found[0] : null;
}

/** @typedef {{ files: readonly string[]; changedLines: number; readonlySurface: readonly string[] }} Diff */

/**
 * The lowest tier the diff allows, with the files or facts that force it. `readonlySurface` lists files whose
 * changed lines mention hl_readonly / readiness_v (AGENTS.md: High-risk).
 * @param {Diff} diff @returns {{ tier: Tier; reasons: string[] }}
 */
export function requiredTier(diff) {
  const highRisk = [...diff.files.filter((f) => HIGH_RISK.some((p) => p.test(f))), ...diff.readonlySurface.map((f) => `${f} (read-only SQL surface)`)];
  if (highRisk.length > 0) return { tier: "High-risk", reasons: highRisk };
  /** @type {string[]} */
  const reasons = diff.files.filter((f) => ENHANCED.some((p) => p.test(f)));
  const apps = packagesOf(diff.files).filter((p) => p !== "scripts");
  if (apps.length > 1) reasons.push(`packages ${apps.join(" + ")}`);
  if (diff.changedLines > MAX_STANDARD_LINES) reasons.push(`${diff.changedLines} changed lines`);
  if (reasons.length > 0) return { tier: "Enhanced", reasons };
  const code = diff.files.filter((f) => APP_CODE.test(f));
  return code.length > 0 ? { tier: "Standard", reasons: code } : { tier: "Minimal", reasons: [] };
}

/**
 * Skills the change must have used: each entry lists alternatives, one of which is enough.
 * @param {Tier} tier @param {readonly string[]} files @returns {string[][]}
 */
export function requiredSkills(tier, files) {
  if (tier === "Minimal") return [];
  const skills = [["plan-change"], ["review-change", "reviewer"], ["pr-ready"]];
  if (tier === "High-risk") skills.push(["security-review"]);
  if (files.some((f) => UI.some((p) => p.test(f)))) skills.push(["verify-app"]);
  return skills;
}

/** @param {string[][]} required @param {readonly string[]} used @returns {string[]} */
export function missingSkills(required, used) {
  return required.filter((options) => !options.some((s) => used.includes(s))).map((options) => options.join("|"));
}

/** Unticked checkboxes without "n/a" and a reason. @param {string} body @returns {string[]} */
export function uncheckedBoxes(body) {
  return normalized(body)
    .split("\n")
    .map((l) => UNTICKED.exec(l))
    .filter((m) => m !== null && !NA_WITH_REASON.test(m[1]))
    .map((m) => /** @type {RegExpExecArray} */ (m)[1].trim());
}

/** Text of a `## <heading>` section. @param {string} body @param {string} heading */
function section(body, heading) {
  const text = normalized(body);
  const start = text.search(new RegExp(`^## ${heading}[ \\t]*$`, "m"));
  if (start < 0) return "";
  const rest = text.slice(start).split("\n").slice(1).join("\n");
  const end = rest.search(/^## /m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/** Sections that must have content for a tier (the PR template's own rules). @param {Tier} tier @returns {string[]} */
export function requiredSections(tier) {
  return rank(tier) >= rank("Enhanced") ? ["What changes for users", "Evidence", "Risks and rollback"] : ["What changes for users", "Evidence"];
}

/** Skill names on the `skills:` line of `## Skills used` ("plan-change (manual)" counts as plan-change). @param {string} body @returns {string[]} */
export function skillsListed(body) {
  const line = section(body, "Skills used").split("\n").find((l) => /^skills:/i.test(l.trim()));
  if (line === undefined) return [];
  return line.trim().slice("skills:".length).split(",").map((s) => s.replace(/\(.*?\)/g, "").trim()).filter((s) => s !== "");
}

/** Plan files this PR adds or changes. @param {readonly string[]} files @returns {string[]} */
export function changedPlans(files) {
  return files.filter((f) => PLAN_FILE.test(f));
}

/** A plan is approved when its `**Approved:**` line names the approver. @param {string} text */
export function isApprovedPlan(text) {
  return normalized(text).split("\n").some((l) => l.startsWith("**Approved:**") && l.includes(APPROVER));
}

/**
 * Every way the PR breaks the policy, as actionable messages; empty means it passes.
 * `plans` maps each plan file this PR changes to its text.
 * @param {Diff & { body: string; plans: Record<string, string> }} pr
 * @returns {string[]}
 */
export function policyProblems(pr) {
  /** @type {string[]} */
  const problems = [];
  const needed = requiredTier(pr);
  const declared = declaredTier(pr.body);
  if (declared === null) problems.push("Risk tier: write exactly one of Minimal, Standard, Enhanced, High-risk on the **Risk tier:** line.");
  else if (rank(declared) < rank(needed.tier)) {
    problems.push(`Risk tier: declared ${declared}, but the diff needs ${needed.tier} (${needed.reasons.join(", ")}).`);
  }
  const tier = declared === null ? needed.tier : higher(declared, needed.tier);
  for (const box of uncheckedBoxes(pr.body)) problems.push(`Checklist: unchecked "${box}"; tick it or write "n/a: <reason>".`);
  for (const heading of requiredSections(tier)) {
    if (section(pr.body, heading) === "") problems.push(`Section "## ${heading}" is empty; a ${tier} PR needs it.`);
  }
  if (!section(pr.body, "Evidence").includes("check.mjs")) {
    problems.push("Evidence: show the `node scripts/check.mjs` result (AGENTS.md → Definition of done).");
  }
  if (rank(tier) >= rank("Enhanced") && !changedPlans(pr.files).some((p) => isApprovedPlan(pr.plans[p] ?? ""))) {
    problems.push(`Plan: this ${tier} PR needs its own plan in docs/plans/, added or changed in this PR, with an **Approved:** line naming ${APPROVER}.`);
  }
  const missing = missingSkills(requiredSkills(tier, pr.files), skillsListed(pr.body));
  if (missing.length > 0) problems.push(`Skills used: skills missing for ${tier}: ${missing.join(", ")} (the "skills:" line of ## Skills used).`);
  return problems;
}
