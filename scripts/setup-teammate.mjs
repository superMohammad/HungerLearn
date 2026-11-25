// @ts-check
/**
 * Set up Hunger Learn on a laptop without a GPU (Linux, macOS or Windows).
 * LLM calls go to Ollama on the team GPU host over Tailscale; Postgres, docproc and web run locally.
 * Lesson videos (hlmedia) render only on the GPU host.
 *
 * Needs: git, Node 22+, pnpm, uv, Docker (running), Tailscale up.
 * Usage (bash/zsh):    GPU_HOST=<tailscale name or IP> DEMO_PASSWORD=<min 8 chars> node scripts/setup-teammate.mjs
 * Usage (PowerShell):  $env:GPU_HOST="<name or IP>"; $env:DEMO_PASSWORD="<min 8 chars>"; node scripts/setup-teammate.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CheckFailed, DOCPROC, docprocVenvName, IS_WINDOWS, MEDIA, REPO, run, runMain, step, venvBin, venvTool, WEB } from "./lib/hl.mjs";

/** @param {string} name @param {string} hint */
function requiredEnv(name, hint) {
  const value = process.env[name];
  if (value === undefined || value === "") throw new CheckFailed(`Set ${name}: ${hint}`);
  return value;
}

/** Bare names can be .cmd shims on Windows, which only cmd.exe can start. @param {string} command */
function hasCommand(command) {
  const result = IS_WINDOWS
    ? spawnSync(`${command} --version`, { stdio: "ignore", shell: true })
    : spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

/** @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Probed before runMain because fetch is async; an unset GPU_HOST is reported inside runMain.
const ollama = `http://${process.env.GPU_HOST ?? ""}:11434`;
const ollamaUp = process.env.GPU_HOST ? await fetch(`${ollama}/api/tags`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false) : false;

runMain(() => {
  const gpuHost = requiredEnv("GPU_HOST", "the Tailscale name or IP of the GPU host");
  const demoPassword = requiredEnv("DEMO_PASSWORD", "at least 8 characters, shared by the seeded demo accounts");
  if (demoPassword.length < 8) throw new CheckFailed("DEMO_PASSWORD must be at least 8 characters");
  const missing = ["git", "docker", "uv", "pnpm"].filter((c) => !hasCommand(c));
  if (missing.length > 0) throw new CheckFailed(`Missing required command(s): ${missing.join(", ")}`);
  const docprocEnv = path.join(DOCPROC, ".env");
  const webEnv = path.join(WEB, ".env.local");
  for (const f of [docprocEnv, webEnv]) {
    if (existsSync(f)) throw new CheckFailed(`${f} already exists. Move it away first; this script does not overwrite config.`);
  }

  step(`Checking Ollama on the GPU host (${ollama})`);
  if (!ollamaUp) throw new CheckFailed(`Ollama is not reachable at ${ollama}. Is Tailscale up on both machines and the GPU host on?`);

  step("Starting Postgres + pgvector");
  run("docker", ["compose", "-f", path.join(REPO, "docker-compose.yml"), "up", "-d"], REPO);
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    ready = spawnSync("docker", ["exec", "hungerlearn-db", "pg_isready", "-U", "hungerlearn"], { stdio: "ignore" }).status === 0;
    if (!ready) sleep(1000);
  }
  if (!ready) throw new CheckFailed("Postgres did not become ready (docker logs hungerlearn-db)");

  step("docproc (CPU torch only)");
  const venv = docprocVenvName();
  run("uv", ["venv", venv], DOCPROC);
  run("uv", ["pip", "install", "--python", venv, "--extra-index-url", "https://download.pytorch.org/whl/cpu", "--index-strategy", "unsafe-best-match", "-e", ".[dev,pg,gemma]"], DOCPROC);
  writeFileSync(docprocEnv, [
    "DOCPROC_BACKEND=postgres",
    "DOCPROC_PG_DSN=postgresql://hungerlearn:hungerlearn@127.0.0.1:5442/hungerlearn",
    "DOCPROC_LLM=openai_compat",
    `DOCPROC_LLM_BASE_URL=${ollama}/v1`,
    "DOCPROC_LLM_MODEL=gemma4:latest",
    "DOCPROC_LLM_API_KEY=ollama",
    "DOCPROC_LLM_TIMEOUT_S=300",
    "DOCPROC_LLM_REASONING_EFFORT=high",
    "DOCPROC_EMBEDDINGS=embeddinggemma",
    "DOCPROC_EMBEDDING_MODEL=google/embeddinggemma-2",
    "DOCPROC_EMBEDDING_DIM=768",
    "DOCPROC_EMBEDDING_DEVICE=cpu",
    "DOCPROC_OCR=null",
    "",
  ].join("\n"));

  step("web");
  const uploads = path.join(WEB, ".uploads");
  const mediaOut = path.join(MEDIA, "out");
  mkdirSync(uploads, { recursive: true });
  mkdirSync(mediaOut, { recursive: true });
  writeFileSync(webEnv, [
    "DATABASE_URL=postgresql://hungerlearn:hungerlearn@127.0.0.1:5442/hungerlearn",
    "READONLY_DATABASE_URL=postgresql://hl_readonly:hl_readonly@127.0.0.1:5442/hungerlearn",
    `LLM_BASE_URL=${ollama}/v1`,
    "LLM_MODEL=gemma4:latest",
    "LLM_API_KEY=ollama",
    "LLM_REASONING_EFFORT=high",
    `DOCPROC_DIR=${DOCPROC}`,
    `DOCPROC_BIN=${venvTool(venvBin(DOCPROC, venv), "docproc")}`,
    `# hlmedia needs CUDA: renders fail on this laptop. Verify videos on http://${gpuHost}:3000`,
    `MEDIA_DIR=${MEDIA}`,
    `MEDIA_BIN=${venvTool(venvBin(MEDIA, ".venv"), "hlmedia")}`,
    `MEDIA_OUT_DIR=${mediaOut}`,
    `UPLOAD_DIR=${uploads}`,
    `TRAINING_PROMPT_PATH=${path.join(REPO, "hunger-learn-training-generator-prompt.md")}`,
    `OLLAMA_URL=${ollama}`,
    `DEMO_PASSWORD=${demoPassword}`,
    "",
  ].join("\n"));
  run("pnpm", ["install"], WEB);
  run("pnpm", ["exec", "playwright", "install", "chromium"], WEB);
  run("pnpm", ["db:migrate"], WEB);
  run("pnpm", ["db:seed"], WEB);

  step("Team workflow: git hooks (pre-commit runs check-fast, pre-push blocks main), then the full check");
  run("git", ["config", "--local", "core.hooksPath", ".githooks"], REPO);
  run(process.execPath, [path.join(REPO, "scripts", "check.mjs")], REPO);

  console.log(`
Done. Next:
  1. Accept the EmbeddingGemma licence on Hugging Face, then: ${venvTool(venvBin(DOCPROC, venv), "hf")} auth login
  2. cd web && pnpm dev     -> http://localhost:3000
  3. Read the Workflow section of AGENTS.md. Before every PR: node scripts/check.mjs
  4. Codex users: open the repo in Codex once and trust the project hooks (.codex/hooks.json).`);
});
