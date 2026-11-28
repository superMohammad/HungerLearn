// @ts-check
/** Tests for the PR policy (scripts/pr-policy.mjs, scripts/lib/policy.mjs) and the skill log the agent hooks keep. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "../lib/hl.mjs";
import {
  changedPlans,
  declaredTier,
  isApprovedPlan,
  mergeProblem,
  mergeTarget,
  missingSkills,
  parsePrMeta,
  prMetaFromGh,
  policyProblems,
  requiredSections,
  requiredSkills,
  requiredTier,
  skillsListed,
  uncheckedBoxes,
} from "../lib/policy.mjs";
import { parseSkillLog, skillFromHookInput, skillLogName, skillsUsedLine } from "../lib/skill-log.mjs";

const APPROVED_PLAN = "# Plan\n\n**Approved:** Mohammad Almalke (@superMohammad), 2026-11-26\n";
const PEER_PLAN = "# Plan\n\n**Approved:** @altayariyasser, 2026-11-28\n";

/** @param {string} login @param {string} state @param {string} association */
function review(login, state, association) {
  return { login, state, association };
}
/** The owner opened the PR and nobody reviewed it yet. */
const OWNER_PR = { author: "superMohammad", reviews: /** @type {ReturnType<typeof review>[]} */ ([]) };

/** @param {readonly string[]} files @param {number} changedLines */
function diff(files, changedLines) {
  return { files, changedLines, readonlySurface: /** @type {string[]} */ ([]) };
}

/** A PR description that satisfies the policy for the given tier and skills. @param {string} tier @param {string} skills */
function body(tier, skills) {
  return [
    `**Risk tier:** ${tier}`,
    "## What changes for users",
    "Faster uploads.",
    "## Evidence",
    "`node scripts/check.mjs` → check passed",
    "## Skills used",
    `skills: ${skills}`,
    "## Review",
    "- [x] Fresh-context review done",
    "- [ ] Plan linked from `docs/plans/` (Enhanced, High-risk) — n/a: Standard change",
    "## Risks and rollback",
    "Revert the PR.",
  ].join("\n");
}

test("declared tier: exactly one tier word on the Risk tier line", () => {
  assert.equal(declaredTier("**Risk tier:** Enhanced (multi-package)"), "Enhanced");
  assert.equal(declaredTier("**Risk tier:** High-risk"), "High-risk");
  assert.equal(declaredTier("**Risk tier:** Minimal | Standard | Enhanced | High-risk  <!-- pick one -->"), null);
  assert.equal(declaredTier("no tier here"), null);
});

test("required tier: High-risk paths, rule files and the read-only SQL surface", () => {
  const r = requiredTier(diff(["docs/x.md", "scripts/check.mjs"], 10));
  assert.equal(r.tier, "High-risk");
  assert.match(r.reasons.join(" "), /scripts\/check\.mjs/);
  for (const f of ["web/src/lib/session.ts", "web/db/migrations/003_x.sql", ".github/workflows/ci.yml", ".claude/settings.json",
    ".codex/hooks.json", ".githooks/pre-push", ".agents/skills/pr-ready/SKILL.md", "skills/pr-ready", "web/eslint.config.mjs",
    "AGENTS.md", "web/AGENTS.md", "CLAUDE.md", "docker-compose.yml", "-/docproc/src/docproc/storage/schema_postgres.sql"]) {
    assert.equal(requiredTier(diff([f], 1)).tier, "High-risk", f);
  }
  const sql = requiredTier({ files: ["web/src/lib/repo.ts"], changedLines: 3, readonlySurface: ["web/src/lib/repo.ts"] });
  assert.equal(sql.tier, "High-risk");
  assert.match(sql.reasons[0], /read-only SQL surface/);
});

test("required tier: every CODEOWNERS path is High-risk (the two lists cannot drift)", () => {
  const owned = readFileSync(path.join(REPO, ".github", "CODEOWNERS"), "utf8").split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#")).map((l) => l.trim().split(/\s+/)[0].replace(/^\//, ""));
  assert.ok(owned.length > 5);
  for (const entry of owned) {
    const sample = entry.endsWith("/") ? `${entry}example.txt` : entry;
    assert.equal(requiredTier(diff([sample], 1)).tier, "High-risk", entry);
  }
});

test("required tier: multi-package, pipeline, OCR, prompt, corpus or >400 lines need Enhanced", () => {
  for (const files of [["web/src/lib/text.ts", "-/docproc/src/docproc/cli.py"], ["web/src/lib/pipeline.ts"],
    ["hunger-learn-training-generator-prompt.md"], ["data/synthetic_sops/held_out/gold/extraction.json"],
    ["-/docproc/src/docproc/ocr/ovis.py"], ["-/docproc/src/docproc/evaluation.py"], ["-/docproc/src/docproc/normalize.py"]]) {
    assert.equal(requiredTier(diff(files, 5)).tier, "Enhanced", files.join(","));
  }
  assert.equal(requiredTier(diff(["web/src/lib/text.ts"], 401)).tier, "Enhanced");
});

test("required tier: one package is Standard, docs only is Minimal", () => {
  assert.equal(requiredTier(diff(["web/src/lib/text.ts"], 30)).tier, "Standard");
  assert.equal(requiredTier(diff(["docs/feature-map.md"], 3)).tier, "Minimal");
});

test("required skills: none for Minimal; plan, review, pr-ready from Standard; security-review for High-risk; verify-app for UI", () => {
  assert.deepEqual(requiredSkills("Minimal", ["docs/a.md"]), []);
  assert.deepEqual(requiredSkills("Standard", ["web/src/lib/text.ts"]), [["plan-change"], ["review-change", "reviewer"], ["pr-ready"]]);
  assert.deepEqual(requiredSkills("High-risk", ["scripts/x.mjs"]).at(-1), ["security-review"]);
  assert.deepEqual(requiredSkills("Standard", ["web/src/app/[lang]/page.tsx"]).at(-1), ["verify-app"]);
  assert.deepEqual(requiredSkills("Enhanced", ["web/src/lib/i18n/ar.ts"]).at(-1), ["verify-app"]);
});

test("missing skills: any alternative satisfies a requirement", () => {
  const required = [["plan-change"], ["review-change", "reviewer"], ["pr-ready"]];
  assert.deepEqual(missingSkills(required, ["plan-change", "reviewer", "pr-ready"]), []);
  assert.deepEqual(missingSkills(required, ["plan-change"]), ["review-change|reviewer", "pr-ready"]);
});

test("unchecked boxes: every task-list spelling, CRLF, allowed only with n/a and a reason", () => {
  const text = ["- [x] done", "- [ ] Plan linked — n/a: Standard change", "- [ ] Review done", "* [ ] Star box", "+ [ ] Plus box",
    "1. [ ] Numbered box", "- [ ] UI strings n/a"].join("\r\n");
  assert.deepEqual(uncheckedBoxes(text), ["Review done", "Star box", "Plus box", "Numbered box", "UI strings n/a"]);
});

test("skills are read from the skills: line; a (manual) mark still counts", () => {
  assert.deepEqual(skillsListed("## Skills used\n<!-- note -->\nskills: plan-change (manual), reviewer , pr-ready\n## Review"),
    ["plan-change", "reviewer", "pr-ready"]);
  assert.deepEqual(skillsListed("## Review\n- [x] x"), []);
});

test("required sections: rollback from Enhanced up", () => {
  assert.deepEqual(requiredSections("Standard"), ["What changes for users", "Evidence"]);
  assert.deepEqual(requiredSections("High-risk"), ["What changes for users", "Evidence", "Risks and rollback"]);
});

test("plans: only plan files this PR changes count", () => {
  assert.deepEqual(changedPlans(["docs/plans/2026-11-26-b.md", "web/x.ts", "docs/plans/sub/x.md"]), ["docs/plans/2026-11-26-b.md"]);
});

test("approval: the owner's own PR passes on his line alone; nobody else's text line counts", () => {
  assert.equal(isApprovedPlan(APPROVED_PLAN, OWNER_PR), true);
  assert.equal(isApprovedPlan(APPROVED_PLAN.replaceAll("\n", "\r\n"), OWNER_PR), true);
  assert.equal(isApprovedPlan("**Approved:** Mohammad Almalke, 2026-11-26", OWNER_PR), false);
  assert.equal(isApprovedPlan("**Status:** waiting for approval (@superMohammad)", OWNER_PR), false);
  assert.equal(isApprovedPlan(APPROVED_PLAN, { author: "vGolden25", reviews: [] }), false);
});

test("approval: a teammate other than the author approves with a GitHub review", () => {
  const meta = { author: "vGolden25", reviews: [review("altayariyasser", "APPROVED", "COLLABORATOR")] };
  assert.equal(isApprovedPlan(PEER_PLAN, meta), true);
  assert.equal(isApprovedPlan(PEER_PLAN.replace("@altayariyasser", "@AltayariYasser"), meta), true);
  assert.equal(isApprovedPlan(APPROVED_PLAN, { author: "vGolden25", reviews: [review("superMohammad", "APPROVED", "OWNER")] }), true);
  assert.equal(isApprovedPlan(APPROVED_PLAN, { author: "vGolden25", reviews: [review("altayariyasser", "APPROVED", "COLLABORATOR")] }), false);
});

test("approval: the author cannot approve their own plan", () => {
  const meta = { author: "altayariyasser", reviews: [review("altayariyasser", "APPROVED", "COLLABORATOR")] };
  assert.equal(isApprovedPlan(PEER_PLAN, meta), false);
});

test("approval: only the latest non-comment review counts, and only from the team", () => {
  /** @param {ReturnType<typeof review>[]} reviews */
  const peer = (reviews) => isApprovedPlan(PEER_PLAN, { author: "vGolden25", reviews });
  assert.equal(peer([review("altayariyasser", "APPROVED", "COLLABORATOR"), review("altayariyasser", "COMMENTED", "COLLABORATOR")]), true);
  assert.equal(peer([review("altayariyasser", "APPROVED", "COLLABORATOR"), review("altayariyasser", "CHANGES_REQUESTED", "COLLABORATOR")]), false);
  assert.equal(peer([review("altayariyasser", "DISMISSED", "COLLABORATOR")]), false);
  assert.equal(peer([review("altayariyasser", "CHANGES_REQUESTED", "COLLABORATOR"), review("altayariyasser", "APPROVED", "COLLABORATOR")]), true);
  assert.equal(peer([review("altayariyasser", "APPROVED", "NONE")]), false);
  assert.equal(peer([review("altayariyasser", "APPROVED", "CONTRIBUTOR")]), false);
  assert.equal(peer([review("someone-else", "APPROVED", "COLLABORATOR")]), false);
});

test("PR meta from gh api: author line plus one JSON review per line; a ghost reviewer raises", () => {
  assert.deepEqual(prMetaFromGh("vGolden25\n", '{"login":"x","state":"APPROVED","association":"OWNER"}\n\n'),
    { author: "vGolden25", reviews: [review("x", "APPROVED", "OWNER")] });
  assert.deepEqual(prMetaFromGh("vGolden25\n", ""), { author: "vGolden25", reviews: [] });
  assert.throws(() => prMetaFromGh("", ""), /author/);
  assert.throws(() => prMetaFromGh("a", "{oops"), /review line 1/);
  assert.throws(() => prMetaFromGh("a", '{"login":null,"state":"APPROVED","association":"NONE"}'), /login/);
});

test("PR meta: parsed strictly; anything malformed raises and names the field", () => {
  assert.deepEqual(parsePrMeta('{"author":"vGolden25","reviews":[{"login":"x","state":"APPROVED","association":"COLLABORATOR"}]}'),
    { author: "vGolden25", reviews: [review("x", "APPROVED", "COLLABORATOR")] });
  assert.throws(() => parsePrMeta("not json"), /PR meta/);
  assert.throws(() => parsePrMeta('{"reviews":[]}'), /author/);
  assert.throws(() => parsePrMeta('{"author":"a"}'), /reviews/);
  assert.throws(() => parsePrMeta('{"author":"a","reviews":[{"login":"x","state":"APPROVED"}]}'), /association/);
  assert.throws(() => parsePrMeta('{"author":"a","reviews":[{"login":null,"state":"APPROVED","association":"OWNER"}]}'), /login/);
});

test("policy: a complete Standard PR passes, also when edited on github.com (CRLF)", () => {
  const pr = { ...diff(["web/src/lib/text.ts"], 40), plans: {}, meta: OWNER_PR };
  assert.deepEqual(policyProblems({ ...pr, body: body("Standard", "plan-change, reviewer, pr-ready") }), []);
  const crlf = `${body("Standard", "plan-change, reviewer, pr-ready")}\n- [ ] Review done`.replaceAll("\n", "\r\n");
  assert.match(policyProblems({ ...pr, body: crlf }).join("\n"), /unchecked "Review done"/);
});

test("policy: each gap is named", () => {
  const problems = policyProblems({
    ...diff(["scripts/check.mjs"], 12),
    body: ["**Risk tier:** Standard", "## What changes for users", "## Evidence", "tests pass", "## Skills used", "skills: plan-change", "- [ ] Review done"].join("\n"),
    plans: {},
    meta: OWNER_PR,
  });
  const text = problems.join("\n");
  assert.match(text, /declared Standard.*needs High-risk.*scripts\/check\.mjs/);
  assert.match(text, /unchecked.*Review done/);
  assert.match(text, /"## What changes for users" is empty/);
  assert.match(text, /"## Risks and rollback" is empty/);
  assert.match(text, /Evidence.*check\.mjs/);
  assert.match(text, /its own plan/);
  assert.match(text, /skills missing.*review-change\|reviewer.*pr-ready.*security-review/);
});

test("policy: Enhanced passes with its own approved plan; an unapproved or unchanged plan fails", () => {
  const files = ["web/src/lib/pipeline.ts", "docs/plans/2026-11-26-x.md"];
  const input = { ...diff(files, 80), body: body("Enhanced", "plan-change, review-change, pr-ready"), meta: OWNER_PR };
  assert.deepEqual(policyProblems({ ...input, plans: { "docs/plans/2026-11-26-x.md": APPROVED_PLAN } }), []);
  assert.match(policyProblems({ ...input, plans: { "docs/plans/2026-11-26-x.md": "# Plan\n" } }).join("\n"), /its own plan/);
  const linkedOnly = { ...diff(["web/src/lib/pipeline.ts"], 80), body: `${input.body}\nSee docs/plans/2026-11-26-x.md`, plans: {}, meta: OWNER_PR };
  assert.match(policyProblems(linkedOnly).join("\n"), /its own plan/);
});

test("policy: a plan line without a matching review names who must approve", () => {
  const files = ["web/src/lib/pipeline.ts", "docs/plans/2026-11-28-x.md"];
  const input = { ...diff(files, 80), body: body("Enhanced", "plan-change, review-change, pr-ready"), plans: { "docs/plans/2026-11-28-x.md": PEER_PLAN } };
  const text = policyProblems({ ...input, meta: { author: "vGolden25", reviews: [] } }).join("\n");
  assert.match(text, /@altayariyasser/);
  assert.match(text, /approving review/);
  assert.match(text, /other than @vGolden25/);
  assert.deepEqual(policyProblems({ ...input, meta: { author: "vGolden25", reviews: [review("altayariyasser", "APPROVED", "COLLABORATOR")] } }), []);
});

test("merge decision: only with all required checks green, never with --admin", () => {
  assert.equal(mergeProblem(["8", "--squash"], 0), null);
  assert.match(mergeProblem(["8", "--squash"], 8) ?? "", /pending/);
  assert.match(mergeProblem(["8", "--squash"], 1) ?? "", /not all green/);
  assert.match(mergeProblem(["8", "--squash"], null) ?? "", /not all green/);
  assert.match(mergeProblem(["8", "--admin", "--squash"], 0) ?? "", /admin/);
  assert.match(mergeProblem(["8", "--squash", "--admin=true"], 0) ?? "", /admin/);
  assert.match(mergeProblem(["8", "--admin=1"], 0) ?? "", /admin/);
});

test("merge target: first positional word, skipping the values of gh pr merge flags; --repo passes through", () => {
  assert.deepEqual(mergeTarget(["8", "--squash"]), ["8"]);
  assert.deepEqual(mergeTarget(["--subject", "Fix 8", "--squash", "12"]), ["12"]);
  assert.deepEqual(mergeTarget(["8", "-R", "other/repo"]), ["8", "--repo", "other/repo"]);
  assert.deepEqual(mergeTarget(["--repo=other/repo"]), ["--repo", "other/repo"]);
  assert.deepEqual(mergeTarget(["--squash"]), []);
});

test("skill log: hook input maps to a skill name; other tools are ignored", () => {
  assert.equal(skillFromHookInput({ tool_name: "Skill", tool_input: { skill: "verify-app" } }), "verify-app");
  assert.equal(skillFromHookInput({ tool_name: "Agent", tool_input: { subagent_type: "reviewer" } }), "reviewer");
  assert.equal(skillFromHookInput({ tool_name: "Agent", tool_input: { subagent_type: "Explore" } }), null);
  assert.equal(skillFromHookInput({ tool_name: "Bash", tool_input: { command: "ls" } }), null);
});

test("skill log: entries carry their source; the skills: line marks hand-recorded skills", () => {
  const entries = parseSkillLog([
    '{"skill":"plan-change","source":"manual","at":"t"}', "", '{"skill":"pr-ready","source":"hook","at":"t"}',
    '{"skill":"pr-ready","source":"manual","at":"t"}',
  ].join("\n"));
  assert.equal(skillsUsedLine(entries), "skills: plan-change (manual), pr-ready");
  assert.equal(skillLogName("feat/a"), "feat%2Fa.jsonl");
  assert.notEqual(skillLogName("a/b"), skillLogName("a__b"));
  assert.throws(() => parseSkillLog("not json\n"), /skill log line 1/);
  assert.throws(() => parseSkillLog('{"skill":"x"}\n'), /source/);
});
