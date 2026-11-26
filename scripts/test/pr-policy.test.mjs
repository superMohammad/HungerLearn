// @ts-check
/** End-to-end tests of scripts/pr-policy.mjs in a throwaway repo, so it reads that repo's diff and plans. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "../lib/hl.mjs";

const BODY = [
  "**Risk tier:** Enhanced",
  "## What changes for users",
  "Reverts an old feature.",
  "## Evidence",
  "`node scripts/check.mjs` → check passed",
  "## Skills used",
  "skills: plan-change, reviewer, pr-ready",
  "## Risks and rollback",
  "Revert this PR.",
].join("\n");

const APPROVED = "**Approved:** Mohammad (@superMohammad)\n";

/** Git exports GIT_DIR, GIT_INDEX_FILE etc. to hooks (check-fast runs from pre-commit); they would point at the outer repo. */
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

/**
 * A throwaway repo whose origin/main has `docs/plans/old.md` (approved) and the scripts, on branch `revert/x`
 * with old.md deleted and an Enhanced file changed. `scripts/` is committed at init, so it is not part of the diff.
 * @param {import("node:test").TestContext} t
 */
function revertRepo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "hl-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "repo");
  cpSync(path.join(REPO, "scripts"), path.join(dir, "scripts"), { recursive: true });
  /** @param {string[]} args */
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...args], { cwd: dir, encoding: "utf8", env: ENV });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  };
  mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "plans", "old.md"), `# Old plan\n\n${APPROVED}`);
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-q", "-c", "revert/x");
  unlinkSync(path.join(dir, "docs", "plans", "old.md"));
  writeFileSync(path.join(dir, "hunger-learn-training-generator-prompt.md"), "an Enhanced change\n");
  const bodyFile = path.join(root, "body.md");
  writeFileSync(bodyFile, BODY);
  const policy = () => spawnSync(process.execPath, [path.join(dir, "scripts", "pr-policy.mjs"), bodyFile], { cwd: dir, encoding: "utf8", env: ENV });
  return { dir, policy };
}

test("pr-policy: a PR that deletes an old plan and adds its own approved plan passes (no crash on the deleted file)", (t) => {
  const { dir, policy } = revertRepo(t);
  writeFileSync(path.join(dir, "docs", "plans", "new.md"), `# New plan\n\n${APPROVED}`);
  const run = policy();
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /pr-policy: passed/);
});

test("pr-policy: a deleted approved plan is not the PR's plan", (t) => {
  const { policy } = revertRepo(t);
  const run = policy();
  assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr, /Plan: this Enhanced PR needs its own plan/);
});

test("pr-policy: a symlinked plan is not the PR's plan", (t) => {
  const { dir, policy } = revertRepo(t);
  const target = path.join(path.dirname(dir), "elsewhere.md");
  writeFileSync(target, `# Elsewhere\n\n${APPROVED}`);
  try {
    symlinkSync(target, path.join(dir, "docs", "plans", "link.md"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      throw new Error("Creating a symlink was refused: on Windows, enable Developer Mode (Settings → System → For developers) to run this test.", { cause: error });
    }
    throw error;
  }
  const run = policy();
  assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr, /Plan: this Enhanced PR needs its own plan/);
});
