// @ts-check
/**
 * Set up Hunger Learn on a laptop without a GPU (Linux, macOS or Windows).
 * LLM calls go to an OpenAI-compatible endpoint the teammate chooses (e.g. OpenRouter, or Ollama on their
 * own machine); Postgres, docproc and web run locally. Lesson videos (hlmedia) are not rendered here.
 *
 * Needs: git, Node 22+, pnpm, uv, Docker (running).
 * Usage (bash/zsh):
 *   LLM_BASE_URL=<…/v1> LLM_MODEL=<model> LLM_API_KEY=<key> DEMO_PASSWORD=<min 8 chars> LLM_PRICES_USD_PER_MTOK='<json>' node scripts/setup-teammate.mjs
 * Usage (PowerShell):
 *   $env:LLM_BASE_URL="…"; $env:LLM_MODEL="…"; $env:LLM_API_KEY="…"; $env:DEMO_PASSWORD="…"; $env:LLM_PRICES_USD_PER_MTOK='…'; node scripts/setup-teammate.mjs
 * Examples: OpenRouter  LLM_BASE_URL=https://openrouter.ai/api/v1  LLM_MODEL=google/gemma-4-…  LLM_API_KEY=sk-or-…
 *           Ollama      LLM_BASE_URL=http://localhost:11434/v1  LLM_MODEL=gemma4:latest  LLM_API_KEY=ollama
 * LLM_PRICES_USD_PER_MTOK: USD per million tokens for that model, e.g. '{"gemma4:latest":{"input":0,"output":0}}' for
 * local Ollama (an explicit 0), or the endpoint's published price. There is no default price.
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

/** Status line of `GET <base>/models`, or the network error. Probed before runMain because fetch is async. */
async function probeLlm() {
  const base = process.env.LLM_BASE_URL;
  if (!base) return "LLM_BASE_URL not set";
  return fetch(`${base}/models`, { headers: { Authorization: `Bearer ${process.env.LLM_API_KEY ?? ""}` }, signal: AbortSignal.timeout(10_000) })
    .then((r) => (r.ok ? "ok" : `HTTP ${r.status} ${r.statusText}`), (e) => String(e));
}
const llmProbe = await probeLlm();

runMain(() => {
  const llmBaseUrl = requiredEnv("LLM_BASE_URL", "an OpenAI-compatible base URL ending in /v1 (OpenRouter, your own Ollama, …)");
  const llmModel = requiredEnv("LLM_MODEL", "the model name at that endpoint");
  const llmApiKey = requiredEnv("LLM_API_KEY", "the endpoint's API key (any non-empty value for Ollama)");
  const llmPrices = requiredEnv("LLM_PRICES_USD_PER_MTOK", `USD per million tokens as JSON, e.g. {"${llmModel}":{"input":0,"output":0}} for local Ollama`);
  /** @type {unknown} */
  let priceTable;
  try {
    priceTable = JSON.parse(llmPrices);
  } catch (error) {
    throw new CheckFailed(`LLM_PRICES_USD_PER_MTOK is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  // The full check (non-negative numbers, no unknown fields) runs in web/src/lib/prices.ts; this one fails before any setup work.
  if (typeof priceTable !== "object" || priceTable === null || Array.isArray(priceTable)) {
    throw new CheckFailed('LLM_PRICES_USD_PER_MTOK must be a JSON object: {"<model>":{"input":<USD/Mtok>,"output":<USD/Mtok>}}');
  }
  if (!Object.hasOwn(priceTable, llmModel)) {
    throw new CheckFailed(`LLM_PRICES_USD_PER_MTOK has no price for model "${llmModel}" (LLM_MODEL)`);
  }
  // Written re-serialized on one line inside single quotes, so no newline from the input reaches .env.local.
  const llmPricesLine = JSON.stringify(priceTable);
  if (llmPricesLine.includes("'")) throw new CheckFailed("LLM_PRICES_USD_PER_MTOK must not contain a single quote");
  const demoPassword = requiredEnv("DEMO_PASSWORD", "at least 8 characters, shared by the seeded demo accounts");
  if (demoPassword.length < 8) throw new CheckFailed("DEMO_PASSWORD must be at least 8 characters");
  const missing = ["git", "docker", "uv", "pnpm"].filter((c) => !hasCommand(c));
  if (missing.length > 0) throw new CheckFailed(`Missing required command(s): ${missing.join(", ")}`);
  const docprocEnv = path.join(DOCPROC, ".env");
  const webEnv = path.join(WEB, ".env.local");
  for (const f of [docprocEnv, webEnv]) {
    if (existsSync(f)) throw new CheckFailed(`${f} already exists. Move it away first; this script does not overwrite config.`);
  }

  step(`Checking the LLM endpoint (${llmBaseUrl}/models)`);
  if (llmProbe !== "ok") throw new CheckFailed(`LLM endpoint check failed: GET ${llmBaseUrl}/models -> ${llmProbe}. Check LLM_BASE_URL and LLM_API_KEY.`);

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
    `DOCPROC_LLM_BASE_URL=${llmBaseUrl}`,
    `DOCPROC_LLM_MODEL=${llmModel}`,
    `DOCPROC_LLM_API_KEY=${llmApiKey}`,
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
    `LLM_BASE_URL=${llmBaseUrl}`,
    `LLM_MODEL=${llmModel}`,
    `LLM_API_KEY=${llmApiKey}`,
    "LLM_REASONING_EFFORT=high",
    `LLM_PRICES_USD_PER_MTOK='${llmPricesLine}'`,
    `DOCPROC_DIR=${DOCPROC}`,
    `DOCPROC_BIN=${venvTool(venvBin(DOCPROC, venv), "docproc")}`,
    "# hlmedia needs CUDA: lesson video renders fail on this laptop. That is expected.",
    `MEDIA_DIR=${MEDIA}`,
    `MEDIA_BIN=${venvTool(venvBin(MEDIA, ".venv"), "hlmedia")}`,
    `MEDIA_OUT_DIR=${mediaOut}`,
    `UPLOAD_DIR=${uploads}`,
    `TRAINING_PROMPT_PATH=${path.join(REPO, "hunger-learn-training-generator-prompt.md")}`,
    "OLLAMA_URL=http://localhost:11434",
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
