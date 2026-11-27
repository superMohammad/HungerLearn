/**
 * `pnpm eval:generation` end to end (plan docs/plans/2026-11-27-generation-eval.md) against a fake LLM:
 * the real script creates its own hl_eval_* database, runs the app's groupProcedures + buildPackage on a
 * dev original's gold clauses, scores, writes the JSON, and drops the database.
 * Run: TEST_DATABASE_URL=postgresql://<superuser>@host:port/<db> pnpm test:db
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { appEnv, FAKE_MODEL, INPUT_TOKENS, runScriptAsync, startFakeLlm, testAdminUrl, withCredentials } from "./helpers";

const DOCUMENT = "employee-delayed-order-v1";
const FABRICATED = "نص لا يوجد في المصدر إطلاقا";
/** The eval never opens the read-only pool; serverEnv() only requires the setting to exist. */
const UNUSED_READONLY_URL = withCredentials(testAdminUrl(), "unused", "unused");

const adminUrl = testAdminUrl();
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
let llm: Server | undefined;
let outDir = "";

/**
 * Every package has two practice questions: one quoting its first clause verbatim (passes every check)
 * and one quoting text that is not in the source (the app flags quote_not_found).
 */
function fakeAnswer(system: string, user: string): unknown {
  if (user.includes('"clip_library"')) {
    const input = JSON.parse(user.split("\n\n")[0]) as { clauses: { clause_id: string; text: string }[] };
    const first = input.clauses[0];
    const question = (id: string, quote: string) => ({
      id,
      format: "mcq",
      prompt: "What do you do?",
      scene: null,
      time_limit_seconds: null,
      options: [
        { text: "Follow the procedure", correct: true, misconception: null },
        { text: "Ignore it", correct: false, misconception: "skips the procedure" },
      ],
      correct_order: [],
      feedback: "Follow the procedure.",
      clause_id: first.clause_id,
      quote,
      confidence_tap: true,
    });
    return {
      procedure_id: "x",
      role: "employee",
      language: "en",
      status: "ok",
      skip_reason: null,
      lesson: null,
      video: null,
      practice: [question("q1", first.text), question("q2", FABRICATED)],
      exam: [],
      flags: [],
      resource_requests: [],
      ideas: [],
    };
  }
  if (system.includes("procedure of a work document")) {
    const input = JSON.parse(user) as { procedures: { procedure_id: string }[] };
    return { procedures: input.procedures.map((p) => ({ procedure_id: p.procedure_id, title: "Delayed order", steps: ["Follow the clause"] })) };
  }
  if (system.includes("strict fact checker")) return { supported: true, reason: "Supported by the clause." };
  throw new Error(`unexpected prompt: ${system.slice(0, 80)}`);
}

async function evalDatabases(): Promise<string[]> {
  const rows = await admin<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname LIKE ${"hl\\_eval\\_%"} ORDER BY datname`;
  return rows.map((r) => r.datname);
}

/** Rows in the server's own database (TEST_DATABASE_URL), which the eval must never write; null if it has no app tables. */
async function adminRows(): Promise<{ documents: number; calls: number } | null> {
  const [{ exists }] = await admin<{ exists: boolean }[]>`SELECT to_regclass('public.ai_calls') IS NOT NULL AS exists`;
  if (!exists) return null;
  const [r] = await admin<{ documents: number; calls: number }[]>`
    SELECT (SELECT count(*)::int FROM hl_documents) AS documents, (SELECT count(*)::int FROM ai_calls) AS calls`;
  return { ...r };
}

before(async () => {
  llm = await startFakeLlm(fakeAnswer);
  outDir = await mkdtemp(path.join(tmpdir(), "hl-eval-"));
});

after(async () => {
  await Promise.allSettled([
    new Promise<void>((resolve) => (llm === undefined ? resolve() : llm.close(() => resolve()))),
    rm(outDir, { recursive: true, force: true }),
  ]);
  await admin.end();
});

test("pnpm eval:generation scores a dev original with the app's pipeline and leaves no database behind", { timeout: 120_000 }, async () => {
  const before = await evalDatabases();
  const adminBefore = await adminRows();
  const out = path.join(outDir, "eval_generation_dev.json");
  const port = (llm?.address() as AddressInfo).port;
  const env = appEnv(adminUrl, UNUSED_READONLY_URL, port);
  const result = await runScriptAsync("scripts/eval-generation.mts", ["--documents", DOCUMENT, "--out", out], env);
  assert.equal(result.status, 0, `eval failed:\n${result.stdout}\n${result.stderr}`);

  const report = JSON.parse(await readFile(out, "utf8")) as {
    run: { model: string; prompt_versions: string[]; documents: string[] };
    totals: { documents: number; procedures: number; items: number; citation_accuracy: { normalized: number; exact: number }; silent_failures: number; publishable_with_failed_check: number; procedures_failed: number };
    by_generation: Record<string, { items: number }>;
    documents: { document_id: string; tokens: { calls: number; input: number }; procedures: { items: { failed_checks: string[]; status: string }[] }[] }[];
  };
  assert.equal(report.run.model, FAKE_MODEL);
  assert.deepEqual(report.run.documents, [DOCUMENT]);
  assert.deepEqual(report.run.prompt_versions, ["training-generator-v3"]);

  const procedures = report.totals.procedures;
  assert.ok(procedures > 0);
  assert.equal(report.totals.procedures_failed, 0);
  assert.equal(report.totals.items, 2 * procedures);
  assert.equal(report.totals.citation_accuracy.normalized, 0.5);
  assert.equal(report.totals.citation_accuracy.exact, 0.5);
  assert.equal(report.totals.silent_failures, 0, "the fabricated quote is flagged, so it is not silent");
  assert.equal(report.totals.publishable_with_failed_check, procedures, "today a trainer may approve a flagged item");
  assert.deepEqual(Object.keys(report.by_generation), ["v1/v2"]);

  const [doc] = report.documents;
  assert.equal(doc.document_id, DOCUMENT);
  // naming + per procedure (package + 2 judge calls): every call was logged under this document.
  assert.equal(doc.tokens.calls, 1 + 3 * procedures);
  assert.equal(doc.tokens.input, doc.tokens.calls * INPUT_TOKENS);
  const items = doc.procedures.flatMap((p) => p.items);
  assert.deepEqual(new Set(items.map((i) => i.status)), new Set(["verified", "draft"]));
  assert.ok(items.filter((i) => i.status === "draft").every((i) => i.failed_checks.includes("quote_not_found")));

  assert.deepEqual(await evalDatabases(), before, "the hl_eval_* database was dropped");
  assert.deepEqual(await adminRows(), adminBefore, "nothing was written to the database in DATABASE_URL");
});

test("a missing READONLY_DATABASE_URL fails before any eval database is created", { timeout: 120_000 }, async () => {
  const before = await evalDatabases();
  const port = (llm?.address() as AddressInfo).port;
  const env = appEnv(adminUrl, "", port);
  const result = await runScriptAsync("scripts/eval-generation.mts", ["--documents", DOCUMENT, "--out", path.join(outDir, "y.json")], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /READONLY_DATABASE_URL is not set/);
  assert.deepEqual(await evalDatabases(), before);
});

test("pnpm eval:generation rejects a document that is not a dev original before creating a database", { timeout: 120_000 }, async () => {
  const before = await evalDatabases();
  const port = (llm?.address() as AddressInfo).port;
  const env = appEnv(adminUrl, UNUSED_READONLY_URL, port);
  const result = await runScriptAsync("scripts/eval-generation.mts", ["--documents", "courier-pickup-wait-v1-scan", "--out", path.join(outDir, "x.json")], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a dev original: courier-pickup-wait-v1-scan/);
  assert.deepEqual(await evalDatabases(), before);
});
