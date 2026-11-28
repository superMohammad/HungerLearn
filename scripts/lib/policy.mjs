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
/**
 * The project owner: the one author whose own `**Approved:**` line counts, because GitHub does not let an author
 * approve their own PR. Everyone else's plan needs an approving review by a teammate other than the author.
 */
export const OWNER = "superMohammad";
/**
 * GitHub author associations of people on the team. The repo is user-owned, where every COLLABORATOR has write
 * access; on an organisation repo COLLABORATOR also covers read-only access and this check would need the permission.
 */
const TEAM = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
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

/**
 * One GitHub review of the PR: who wrote it, its state (APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING),
 * the reviewer's author association with the repo, and the commit it reviewed.
 * @typedef {{ login: string; state: string; association: string; commitId: string }} Review
 */
/**
 * The PR's author, head commit and reviews (oldest first), as `scripts/pr-meta.mjs` reads them from GitHub.
 * @typedef {{ author: string; headSha: string; reviews: readonly Review[] }} PrMeta
 */

/** @param {Record<string, unknown>} obj @param {string} key @param {string} where @returns {string} */
function stringField(obj, key, where) {
  const value = obj[key];
  if (typeof value !== "string" || value === "") throw new Error(`PR meta: ${where}.${key} must be a non-empty string, got ${JSON.stringify(value)}.`);
  return value;
}

/** @param {unknown} value @param {string} where @returns {Record<string, unknown>} */
function objectAt(value, where) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`PR meta: ${where} must be an object, got ${JSON.stringify(value)}.`);
  return /** @type {Record<string, unknown>} */ (value);
}

/** Parses the JSON that `scripts/pr-meta.mjs` writes; raises on anything malformed. @param {string} json @returns {PrMeta} */
export function parsePrMeta(json) {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`PR meta: not valid JSON (${error instanceof Error ? error.message : String(error)}).`, { cause: error });
  }
  const root = objectAt(raw, "root");
  const author = stringField(root, "author", "root");
  const headSha = stringField(root, "headSha", "root");
  if (!Array.isArray(root.reviews)) throw new Error(`PR meta: root.reviews must be an array, got ${JSON.stringify(root.reviews)}.`);
  const reviews = root.reviews.map((r, i) => {
    const obj = objectAt(r, `reviews[${i}]`);
    const where = `reviews[${i}]`;
    return {
      login: stringField(obj, "login", where),
      state: stringField(obj, "state", where),
      association: stringField(obj, "association", where),
      commitId: stringField(obj, "commitId", where),
    };
  });
  return { author, headSha, reviews };
}

/**
 * The PR meta from `gh api` output: `{author, headSha}` as one JSON object, and one JSON review per line
 * (`--jq '.[] | {…}'`).
 * @param {string} prOut @param {string} reviewsOut @returns {PrMeta}
 */
export function prMetaFromGh(prOut, reviewsOut) {
  const lines = reviewsOut.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  /** @type {unknown[]} */
  const reviews = lines.map((l, i) => {
    try {
      return JSON.parse(l);
    } catch (error) {
      throw new Error(`PR meta: review line ${i + 1} from gh api is not JSON: ${l.slice(0, 200)}`, { cause: error });
    }
  });
  /** @type {unknown} */
  let pr;
  try {
    pr = JSON.parse(prOut);
  } catch (error) {
    throw new Error(`PR meta: the PR from gh api is not JSON: ${prOut.slice(0, 200)}`, { cause: error });
  }
  return parsePrMeta(JSON.stringify({ ...objectAt(pr, "pr"), reviews }));
}

/**
 * Logins (lower case) that approve the PR now: a teammate other than the author whose latest review that is not a
 * comment is APPROVED on the current head commit. A later "changes requested", a dismissal or a new push takes the
 * approval back, so a plan or code changed after the approval needs a fresh one.
 * @param {PrMeta} meta @returns {Set<string>}
 */
export function approvingReviewers(meta) {
  /** @type {Map<string, Review>} */
  const latest = new Map();
  for (const r of meta.reviews) {
    if (r.state !== "COMMENTED" && r.state !== "PENDING") latest.set(r.login.toLowerCase(), r);
  }
  const author = meta.author.toLowerCase();
  return new Set([...latest].filter(([login, r]) => login !== author && r.state === "APPROVED" && r.commitId === meta.headSha && TEAM.has(r.association)).map(([login]) => login));
}

/** Handles (lower case, without `@`) named on the plan's `**Approved:**` lines. @param {string} text @returns {string[]} */
export function approvalHandles(text) {
  return normalized(text).split("\n").filter((l) => l.startsWith("**Approved:**"))
    .flatMap((l) => [...l.matchAll(/@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)/g)].map((m) => m[1].toLowerCase()));
}

/**
 * A plan is approved when its `**Approved:**` line names a teammate other than the author who approved the PR on
 * GitHub, or names the owner on a PR the owner opened himself.
 * @param {string} text @param {PrMeta} meta
 */
export function isApprovedPlan(text, meta) {
  const approvers = approvingReviewers(meta);
  const owner = OWNER.toLowerCase();
  const ownerIsAuthor = meta.author.toLowerCase() === owner;
  return approvalHandles(text).some((h) => approvers.has(h) || (h === owner && ownerIsAuthor));
}

/**
 * The plan problem of an Enhanced+ PR, or null when one of its changed plans is approved.
 * @param {Tier} tier @param {readonly string[]} files @param {Record<string, string>} plans @param {PrMeta} meta
 */
function planProblem(tier, files, plans, meta) {
  const texts = changedPlans(files).map((p) => plans[p] ?? "");
  if (texts.some((t) => isApprovedPlan(t, meta))) return null;
  const named = [...new Set(texts.flatMap(approvalHandles))];
  const who = `a teammate other than @${meta.author}`;
  if (texts.some((t) => normalized(t).split("\n").some((l) => l.startsWith("**Approved:**"))) && named.length === 0) {
    return `Plan: the **Approved:** line names no one; write the @handle of ${who} who approves this PR (or @${OWNER} on his own PR).`;
  }
  if (named.length === 0) {
    return `Plan: this ${tier} PR needs its own plan in docs/plans/, added or changed in this PR, with an **Approved:** line naming ${who} (or @${OWNER} on his own PR).`;
  }
  return `Plan: the **Approved:** line names ${named.map((h) => `@${h}`).join(", ")}, but none of them has an approving review on this PR; ${who} must approve it on GitHub (approving reviewers now: ${[...approvingReviewers(meta)].map((h) => `@${h}`).join(", ") || "none"}).`;
}

/**
 * Every way the PR breaks the policy, as actionable messages; empty means it passes.
 * `plans` maps each plan file this PR changes to its text; `meta` is the PR's author and reviews.
 * @param {Diff & { body: string; plans: Record<string, string>; meta: PrMeta }} pr
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
  const plan = rank(tier) >= rank("Enhanced") ? planProblem(tier, pr.files, pr.plans, pr.meta) : null;
  if (plan !== null) problems.push(plan);
  const missing = missingSkills(requiredSkills(tier, pr.files), skillsListed(pr.body));
  if (missing.length > 0) problems.push(`Skills used: skills missing for ${tier}: ${missing.join(", ")} (the "skills:" line of ## Skills used).`);
  return problems;
}

/** `--admin` in any spelling gh accepts for a boolean flag (`--admin`, `--admin=true`, ...). @param {readonly string[]} words */
export function usesAdminBypass(words) {
  return words.some((w) => /^--admin(=.*)?$/.test(w));
}

/** `gh pr merge` flags that take a value (the value is not the PR). */
const MERGE_VALUE_FLAGS = new Set(["-R", "--repo", "-b", "--body", "-F", "--body-file", "-t", "--subject", "--match-head-commit", "-A", "--author-email"]);

/**
 * Arguments for `gh pr checks` that name the same PR as `gh pr merge <words>`: its first positional word,
 * plus `--repo <owner/repo>` when given, so the checks read are the checks of the PR being merged.
 * @param {readonly string[]} words @returns {string[]}
 */
export function mergeTarget(words) {
  /** @type {string[]} */
  const target = [];
  /** @type {string[]} */
  const repo = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const [flag, inline] = w.startsWith("--") && w.includes("=") ? [w.slice(0, w.indexOf("=")), w.slice(w.indexOf("=") + 1)] : [w, null];
    if (MERGE_VALUE_FLAGS.has(flag)) {
      const value = inline ?? words[i + 1] ?? "";
      if (inline === null) i += 1;
      if (flag === "-R" || flag === "--repo") repo.push("--repo", value);
    } else if (!w.startsWith("-") && target.length === 0) target.push(w);
  }
  return [...target, ...repo];
}

/**
 * Why an agent may not run `gh pr merge <words>`, or null when it may: never with the admin bypass, and only when
 * `gh pr checks --required` exited 0 (all required checks green; 8 = pending, other = failed or gh error).
 * @param {readonly string[]} words the words after `gh pr merge` @param {number | null} checksExit
 */
export function mergeProblem(words, checksExit) {
  if (usesAdminBypass(words)) return "agents never merge with the admin bypass (--admin); only the human uses it.";
  if (checksExit === 0) return null;
  const state = checksExit === 8 ? "still pending" : `not all green (gh pr checks exit ${checksExit})`;
  return `required checks are ${state}; merge only when every required check passed.`;
}
