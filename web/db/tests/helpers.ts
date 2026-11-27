/** Shared by the DB test suites: database URLs, a fake OpenAI-compatible LLM, and running web scripts with tsx. */
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createServer, type Server } from "node:http";
import path from "node:path";

export const WEB = path.resolve(import.meta.dirname, "..", "..");
export const REPO = path.resolve(WEB, "..");
export const FAKE_MODEL = "fake-model";
export const INPUT_TOKENS = 120;
export const OUTPUT_TOKENS = 30;

export function testAdminUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("Set TEST_DATABASE_URL to a Postgres superuser URL (a fresh database is created and dropped on that server)");
  }
  return url;
}

export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

/** A local OpenAI-compatible chat server: `answer` turns the system and user messages into the JSON reply. */
export async function startFakeLlm(answer: (system: string, user: string) => unknown): Promise<Server> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      const request = JSON.parse(body) as { messages: { role: string; content: string }[] };
      const system = request.messages.find((m) => m.role === "system")?.content ?? "";
      const user = request.messages.find((m) => m.role === "user")?.content ?? "";
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: FAKE_MODEL,
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer(system, user)) }, finish_reason: "stop" }],
          usage: { prompt_tokens: INPUT_TOKENS, completion_tokens: OUTPUT_TOKENS, total_tokens: INPUT_TOKENS + OUTPUT_TOKENS },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

/** The app's server environment, pointed at a test database and the fake LLM. */
export function appEnv(databaseUrl: string, readonlyUrl: string, llmPort: number): Record<string, string> {
  return {
    DATABASE_URL: databaseUrl,
    READONLY_DATABASE_URL: readonlyUrl,
    LLM_BASE_URL: `http://127.0.0.1:${llmPort}/v1`,
    LLM_MODEL: FAKE_MODEL,
    LLM_API_KEY: "test",
    LLM_REASONING_EFFORT: "none",
    LLM_PRICES_USD_PER_MTOK: JSON.stringify({ [FAKE_MODEL]: { input: 0.1, output: 0.4 } }),
    DOCPROC_DIR: "unused",
    DOCPROC_BIN: "unused",
    MEDIA_DIR: path.join(REPO, "media"),
    MEDIA_BIN: "unused",
    MEDIA_OUT_DIR: "unused",
    UPLOAD_DIR: "unused",
    TRAINING_PROMPT_PATH: path.join(REPO, "hunger-learn-training-generator-prompt.md"),
    OLLAMA_URL: "unused",
    DEMO_PASSWORD: "test-password",
  };
}

/** Runs a web/scripts/*.mts entry point the way its pnpm script does (tsx, react-server condition). */
export function runScript(script: string, args: string[], env: Record<string, string>): SpawnSyncReturns<string> {
  const tsx = path.join(WEB, "node_modules", "tsx", "dist", "cli.mjs");
  return spawnSync(process.execPath, [tsx, "--conditions=react-server", script, ...args], {
    cwd: WEB,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

/**
 * Like runScript, but without blocking this process, so a fake LLM served from this process can answer
 * the script's requests (spawnSync would deadlock them). Resolves with the exit status and output.
 */
export function runScriptAsync(script: string, args: string[], env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const tsx = path.join(WEB, "node_modules", "tsx", "dist", "cli.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, "--conditions=react-server", script, ...args], { cwd: WEB, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
