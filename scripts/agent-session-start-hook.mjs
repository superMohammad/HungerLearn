// @ts-check
/**
 * SessionStart hook for Claude Code and Codex. Makes the team workflow active on every clone without a
 * manual step: points git at the shared .githooks (pre-commit runs check-fast, pre-push protects main),
 * then reports what is missing for check.mjs to run on this machine. Stdout becomes agent context.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { DOCPROC, docprocVenvName, REPO, venvBin, venvTool, WEB } from "./lib/hl.mjs";

const current = spawnSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
if (current !== ".githooks") {
  const set = spawnSync("git", ["config", "--local", "core.hooksPath", ".githooks"], { cwd: REPO, encoding: "utf8" });
  if (set.status !== 0) throw new Error(`Could not set core.hooksPath: ${set.stderr}`);
  console.log(`Team workflow: set git core.hooksPath=.githooks for this clone (was: '${current || "unset"}'). pre-commit runs scripts/check-fast.mjs.`);
}

const venv = docprocVenvName();
/** @type {string[]} */
const missing = [];
if (!existsSync(path.join(WEB, "node_modules"))) missing.push("web/node_modules (cd web && pnpm install)");
if (!existsSync(venvTool(venvBin(DOCPROC, venv), "ruff"))) {
  missing.push(`docproc dev env (cd -/docproc && uv venv ${venv} && uv pip install --python ${venv} -e ".[dev,pg,gemma]")`);
}
if (missing.length > 0) {
  console.log(`Team workflow: node scripts/check.mjs cannot run yet. Missing: ${missing.join("; ")}. Tell the user before starting work.`);
}
