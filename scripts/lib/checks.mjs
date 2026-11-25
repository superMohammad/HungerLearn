// @ts-check
/** The check steps behind check.mjs, check-fast.mjs and the agent Stop hook. */
import { existsSync } from "node:fs";
import path from "node:path";
import { findWeakening, reportWeakening } from "./guard.mjs";
import { baseRev, CheckFailed, DOCPROC, docprocVenvName, MEDIA, requireFile, run, SCRIPTS, step, venvBin, venvTool, WEB } from "./hl.mjs";

/** @typedef {import("./hl.mjs").Package} Package */

function checkWebFast() {
  requireFile(path.join(WEB, "node_modules"), "Run: cd web && pnpm install");
  step("web: lint");
  run("pnpm", ["-s", "lint"], WEB);
  step("web: typecheck");
  run("pnpm", ["-s", "typecheck"], WEB);
  step("web: unit tests");
  run("pnpm", ["-s", "test"], WEB);
}

export function checkWebBuild() {
  step("web: build");
  run("pnpm", ["-s", "build"], WEB);
}

function checkDocproc() {
  const venv = docprocVenvName();
  const bin = venvBin(DOCPROC, venv);
  requireFile(venvTool(bin, "ruff"), `Run: cd -/docproc && uv venv ${venv} && uv pip install --python ${venv} -e ".[dev,pg,gemma]"`);
  step("docproc: ruff");
  run(venvTool(bin, "ruff"), ["check", "src", "tests", "scripts"], DOCPROC);
  step("docproc: pytest (offline fixtures)");
  run(venvTool(bin, "pytest"), ["-q"], DOCPROC);
}

/** media pins CUDA torch, so its environment exists only on the GPU host (see AGENTS.md). */
function checkMedia() {
  const bin = venvBin(MEDIA, ".venv");
  if (!existsSync(venvTool(bin, "pytest"))) {
    console.error("NOTE media: not checked on this machine (no media/.venv; media runs only on the GPU host).");
    return;
  }
  requireFile(venvTool(bin, "ruff"), 'Run: cd media && uv pip install --python .venv -e ".[dev]"');
  step("media: ruff");
  run(venvTool(bin, "ruff"), ["check", "src", "tests"], MEDIA);
  step("media: pytest");
  run(venvTool(bin, "pytest"), ["-q"], MEDIA);
}

/** The workflow scripts themselves: strict type-check of the JSDoc-typed .mjs files with web's TypeScript, then their tests. */
function checkScripts() {
  // TypeScript's own entry file, run with this Node: no .cmd shim, so no shell on Windows.
  const tsc = path.join(WEB, "node_modules", "typescript", "bin", "tsc");
  requireFile(tsc, "Run: cd web && pnpm install");
  step("scripts: typecheck");
  run(process.execPath, [tsc, "-p", "tsconfig.json"], SCRIPTS);
  step("scripts: tests");
  run(process.execPath, ["--test", "test/*.test.mjs"], SCRIPTS);
}

/** Lint, types and unit tests of one package (no web build). @param {Package} pkg */
export function checkPackageFast(pkg) {
  if (pkg === "web") checkWebFast();
  else if (pkg === "docproc") checkDocproc();
  else if (pkg === "media") checkMedia();
  else checkScripts();
}

export function checkGuard() {
  const base = baseRev();
  step(`guard-diff against ${base}`);
  if (!reportWeakening(findWeakening(base))) throw new CheckFailed("guard-diff found weakened checks (see above).");
}
