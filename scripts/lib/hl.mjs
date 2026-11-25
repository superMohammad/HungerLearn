// @ts-check
/**
 * Shared helpers for the team workflow scripts (check, check-fast, guard-diff, verify-app, agent hooks).
 * Plain Node (no dependencies) so the same scripts run on Linux, macOS and Windows.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WEB = path.join(REPO, "web");
export const DOCPROC = path.join(REPO, "-", "docproc");
export const MEDIA = path.join(REPO, "media");
export const SCRIPTS = path.join(REPO, "scripts");
export const IS_WINDOWS = process.platform === "win32";

/** @typedef {"web" | "docproc" | "media" | "scripts"} Package */
/** @type {readonly Package[]} */
export const PACKAGES = ["web", "docproc", "media", "scripts"];

/** @param {string} name @returns {name is Package} */
export function isPackage(name) {
  return /** @type {readonly string[]} */ (PACKAGES).includes(name);
}

/** Raised when a check fails; the message says which command broke. */
export class CheckFailed extends Error {}

/** @param {string} message */
export function step(message) {
  console.log(`== ${message}`);
}

/**
 * Quotes one argument for cmd.exe: wraps it in double quotes when it has spaces or cmd metacharacters.
 * @param {string} arg
 */
export function quoteForCmd(arg) {
  if (arg !== "" && !/[\s"&|<>^()%!,;=]/.test(arg)) return arg;
  return `"${arg.replaceAll('"', '""')}"`;
}

/**
 * Runs a command with inherited output; throws CheckFailed with the command line on a non-zero exit.
 * Absolute executables (node, venv tools) are spawned directly. Bare names (pnpm, git, uv, docker) can be
 * .cmd shims on Windows, which only cmd.exe can start, so those go through the shell there with every
 * argument quoted (paths may contain spaces, e.g. C:\Users\First Last).
 * @param {string} command @param {readonly string[]} args @param {string} cwd
 */
export function run(command, args, cwd) {
  const viaShell = IS_WINDOWS && !path.isAbsolute(command);
  const result = viaShell
    ? spawnSync([command, ...args.map(quoteForCmd)].join(" "), { cwd, stdio: "inherit", shell: true })
    : spawnSync(command, [...args], { cwd, stdio: "inherit" });
  if (result.error !== undefined) throw new CheckFailed(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new CheckFailed(`Failed (exit ${result.status}) in ${path.relative(REPO, cwd) || "."}: ${command} ${args.join(" ")}`);
}

/**
 * Runs git and returns stdout; throws on failure with git's stderr.
 * @param {readonly string[]} args
 */
export function git(args) {
  const result = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error !== undefined) throw new Error(`git is not available: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed (exit ${result.status}): ${result.stderr.trim()}`);
  return result.stdout;
}

/** @param {string} text @returns {string[]} */
export function lines(text) {
  return text.split("\n").filter((l) => l !== "");
}

/** Merge-base with origin/main: "what this branch changed". On main itself (or without origin/main) it is HEAD. */
export function baseRev() {
  const hasOriginMain = spawnSync("git", ["rev-parse", "--verify", "--quiet", "origin/main"], { cwd: REPO }).status === 0;
  return (hasOriginMain ? git(["merge-base", "HEAD", "origin/main"]) : git(["rev-parse", "HEAD"])).trim();
}

/** Files changed since `base`, including uncommitted and untracked files (repo-relative, forward slashes). @param {string} base */
export function changedFiles(base) {
  return [...new Set([...lines(git(["diff", "--name-only", base])), ...untrackedFiles()])].sort();
}

export function untrackedFiles() {
  return lines(git(["ls-files", "--others", "--exclude-standard"]));
}

/** @param {readonly string[]} files @returns {Package[]} */
export function packagesOf(files) {
  /** @type {Set<Package>} */
  const found = new Set();
  for (const f of files) {
    if (f.startsWith("web/")) found.add("web");
    else if (f.startsWith("-/docproc/")) found.add("docproc");
    else if (f.startsWith("media/")) found.add("media");
    else if (f.startsWith("scripts/")) found.add("scripts");
  }
  return PACKAGES.filter((p) => found.has(p));
}

/**
 * Directory with a Python virtualenv's executables: `<venv>/Scripts` on Windows, `<venv>/bin` elsewhere.
 * docproc uses `.venv` on Windows and `.venv-linux` on Linux/macOS (the Windows one cannot be reused there).
 * @param {string} pkgDir @param {string} venvName
 */
export function venvBin(pkgDir, venvName) {
  return path.join(pkgDir, venvName, IS_WINDOWS ? "Scripts" : "bin");
}

/** @param {string} binDir @param {string} name */
export function venvTool(binDir, name) {
  return path.join(binDir, IS_WINDOWS ? `${name}.exe` : name);
}

export function docprocVenvName() {
  return IS_WINDOWS ? ".venv" : ".venv-linux";
}

/** @param {string} file @param {string} howToCreate */
export function requireFile(file, howToCreate) {
  if (!existsSync(file)) throw new CheckFailed(`Missing ${path.relative(REPO, file)}. ${howToCreate}`);
}

/**
 * Runs `main` and turns CheckFailed into a short message and exit code 1.
 * @param {() => void} main
 */
export function runMain(main) {
  try {
    main();
  } catch (error) {
    if (error instanceof CheckFailed) {
      console.error(`\n✗ ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
