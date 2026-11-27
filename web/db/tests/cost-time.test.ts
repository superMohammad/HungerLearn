/**
 * `pnpm report:cost-time` against a real Postgres (plan docs/plans/2026-11-27-cost-time-per-document.md).
 * Seeds a v1 → v2 history (jobs, procedures, packages, a carried-over item, AI calls) into a fresh database,
 * runs the real script, and checks the report. No LLM is involved.
 * Run: TEST_DATABASE_URL=postgresql://<superuser>@host:port/<db> pnpm test:db
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { appEnv, FAKE_MODEL, runScript, runScriptAsync, testAdminUrl, withCredentials, withDatabase } from "./helpers";

const DOC = "courier-pickup-wait";
const T0 = new Date("2026-11-27T10:00:00Z");
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

const adminUrl = testAdminUrl();
const dbName = `hl_test_${randomBytes(6).toString("hex")}`;
const testUrl = withDatabase(adminUrl, dbName);
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
let db: postgres.Sql | undefined;
let outDir = "";

/** The script reads only the app pool; the read-only setting just has to exist for serverEnv(). */
const ENV = {
  ...appEnv(testUrl, withCredentials(adminUrl, "unused", "unused"), 9),
  LLM_PRICES_USD_PER_MTOK: JSON.stringify({ [FAKE_MODEL]: { input: 0.1, output: 0.4 }, hosted: { input: 1, output: 4 } }),
};

function testDb(): postgres.Sql {
  if (db === undefined) throw new Error("test database not created (see the before hook)");
  return db;
}

async function job(versionId: string, step: string, start: number, end: number): Promise<void> {
  await testDb()`INSERT INTO pipeline_jobs (document_id, version_id, step, status, started_at, finished_at)
                 VALUES (${DOC}, ${versionId}, ${step}, 'done', ${at(start)}, ${at(end)})`;
}

async function procedure(versionId: string, key: string): Promise<string> {
  const [row] = await testDb()<{ id: string }[]>`
    INSERT INTO procedures (document_id, version_id, procedure_key, ordinal, title, steps, stable_ids)
    VALUES (${DOC}, ${versionId}, ${key}, ${key.charCodeAt(0)}, ${key}, '[]', '[]') RETURNING id`;
  return row.id;
}

async function pkg(procedureId: string, versionId: string, key: string, createdAt: number, carried: boolean): Promise<void> {
  const [row] = await testDb()<{ id: string }[]>`
    INSERT INTO training_packages (procedure_id, document_id, version_id, procedure_key, role, language, status, flags, resource_requests, ideas, created_at)
    VALUES (${procedureId}, ${DOC}, ${versionId}, ${key}, 'courier', 'ar', 'ok', '[]', '[]', '[]', ${at(createdAt)}) RETURNING id`;
  const [item] = await testDb()<{ id: string }[]>`
    INSERT INTO training_items (package_id, document_id, version_id, procedure_key, role, kind, ordinal, stable_id, quote, payload, status)
    VALUES (${row.id}, ${DOC}, ${versionId}, ${key}, 'courier', 'practice', 0, 'CW-01', 'q', '{}', 'verified') RETURNING id`;
  await testDb()`INSERT INTO item_events (item_id, actor, action, from_status, to_status, version_id, note)
                 VALUES (${item.id}, 'ai:pipeline', ${carried ? "carried_over" : "generated"}, NULL, 'verified', ${versionId}, '')`;
}

async function aiCall(versionId: string | null, purpose: string, input: number, output: number): Promise<void> {
  await testDb()`INSERT INTO ai_calls (purpose, model, prompt_version, input_tokens, output_tokens, duration_ms, document_id, version_id)
                 VALUES (${purpose}, ${FAKE_MODEL}, 'training-generator-v3', ${input}, ${output}, 1000,
                         ${versionId === null ? null : DOC}, ${versionId})`;
}

async function rowCounts(): Promise<number[]> {
  const [r] = await testDb()<{ a: number; j: number; p: number; t: number; e: number }[]>`
    SELECT (SELECT count(*)::int FROM ai_calls) AS a, (SELECT count(*)::int FROM pipeline_jobs) AS j,
           (SELECT count(*)::int FROM procedures) AS p, (SELECT count(*)::int FROM training_packages) AS t,
           (SELECT count(*)::int FROM item_events) AS e`;
  return [r.a, r.j, r.p, r.t, r.e];
}

/** Dollars are binary floating point: compare within 1e-8. */
function assertUsd(actual: number | null | undefined, expected: number): void {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 1e-8, `expected $${expected}, got $${actual}`);
}

before(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  db = postgres(testUrl, { max: 2, onnotice: () => undefined });
  outDir = await mkdtemp(path.join(tmpdir(), "hl-cost-"));
  const migrated = runScript("scripts/migrate.mts", [], { DATABASE_URL: testUrl });
  assert.equal(migrated.status, 0, `migrations failed:\n${migrated.stdout}\n${migrated.stderr}`);

  await testDb()`INSERT INTO hl_documents (document_id, title, role, language, current_version_id)
                 VALUES (${DOC}, 'انتظار الاستلام', 'courier', 'ar', 'v2')`;
  // v1: upload, then the admin generates each procedure later (the waits are in elapsed, not processing).
  await job("v1", "queued", 0, 0);
  await job("v1", "understand", 1, 61);
  await job("v1", "procedures", 61, 71);
  await job("v1", "generate:A", 600, 660);
  await job("v1", "generate:B", 900, 990);
  await pkg(await procedure("v1", "A"), "v1", "A", 655, false);
  await pkg(await procedure("v1", "B"), "v1", "B", 985, false);
  await aiCall("v1", "understand.name_procedures", 1_000, 100);
  for (let i = 0; i < 2; i += 1) {
    await aiCall("v1", "generate.package", 100_000, 20_000);
    await aiCall("v1", "verify.judge", 10_000, 1_000);
  }
  // v2: A is unchanged and carried over at zero AI cost; B changed and is regenerated automatically.
  await job("v2", "queued", 2000, 2000);
  await job("v2", "understand", 2001, 2041);
  await job("v2", "update", 2041, 2101);
  await pkg(await procedure("v2", "A"), "v2", "A", 2090, true);
  await pkg(await procedure("v2", "B"), "v2", "B", 2095, false);
  await aiCall("v2", "generate.package", 100_000, 20_000);
  await aiCall("v2", "verify.judge", 10_000, 1_000);
  // Readiness text-to-SQL is about learners: no document, so it is not part of any document's cost.
  await aiCall(null, "readiness.text_to_sql", 500, 50);
});

after(async () => {
  const closing = await Promise.allSettled([db?.end() ?? Promise.resolve(), rm(outDir, { recursive: true, force: true })]);
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
  const failed = closing.find((r) => r.status === "rejected");
  if (failed !== undefined) throw failed.reason;
});

type Version = {
  document_id: string;
  version_id: string;
  kind: string;
  cost: { calls: number; input_tokens: number; output_tokens: number; usd: number; hosted_estimate: { model: string; usd: number } | null };
  time: { processing_seconds: number; elapsed_to_ready_seconds: number | null; ready: boolean };
  packages: { procedures: number; generated: number; carried: number; regenerated: number };
  carry_over_saving_estimate: { procedures: number; input_tokens: number; output_tokens: number; usd: number; estimate: boolean } | null;
};

test("pnpm report:cost-time reports cost, time and the v2 carry-over saving per version, and writes nothing", { timeout: 120_000 }, async () => {
  const before = await rowCounts();
  const out = path.join(outDir, "cost_time.json");
  const result = await runScriptAsync("scripts/report-cost-time.mts", ["--hosted-model", "hosted", "--out", out], ENV);
  assert.equal(result.status, 0, `report failed:\n${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(await readFile(out, "utf8")) as {
    llm_model: string;
    hosted_model: string;
    coverage: { docproc_calls_not_logged: boolean; zero_token_calls: number; failed_jobs: number; running_jobs: number };
    summary: { first: { versions: number }; update: { versions: number; carry_over_saving_usd_estimate: number } };
    versions: Version[];
  };
  assert.equal(report.llm_model, FAKE_MODEL);
  assert.equal(report.hosted_model, "hosted");
  assert.deepEqual(report.coverage, { docproc_calls_not_logged: true, zero_token_calls: 0, failed_jobs: 0, running_jobs: 0 });
  assert.deepEqual(report.versions.map((v) => `${v.version_id}:${v.kind}`), ["v1:first", "v2:update"]);

  const [v1, v2] = report.versions;
  // The readiness call (no document) is not counted: 5 calls in v1, 2 in v2.
  assert.deepEqual([v1.cost.calls, v1.cost.input_tokens, v1.cost.output_tokens], [5, 221_000, 42_100]);
  assertUsd(v1.cost.usd, (221_000 * 0.1 + 42_100 * 0.4) / 1e6);
  assertUsd(v1.cost.hosted_estimate?.usd, (221_000 * 1 + 42_100 * 4) / 1e6);
  assert.deepEqual(v1.time, { processing_seconds: 60 + 10 + 60 + 90, elapsed_to_ready_seconds: 985, ready: true });

  assert.deepEqual([v2.cost.calls, v2.cost.input_tokens, v2.cost.output_tokens], [2, 110_000, 21_000]);
  assert.deepEqual(v2.time, { processing_seconds: 40 + 60, elapsed_to_ready_seconds: 95, ready: true });
  assert.deepEqual(v2.packages, { procedures: 2, generated: 1, carried: 1, regenerated: 0 });
  // One carried procedure × v1's average generation cost per package (naming excluded): 220,000 / 42,000 tokens over 2 packages.
  const saving = v2.carry_over_saving_estimate;
  assert.ok(saving !== null);
  assert.deepEqual([saving.procedures, saving.input_tokens, saving.output_tokens, saving.estimate], [1, 110_000, 21_000, true]);
  assertUsd(saving.usd, (220_000 * 0.1 + 42_000 * 0.4) / 1e6 / 2);
  assertUsd(report.summary.update.carry_over_saving_usd_estimate, saving.usd);

  assert.deepEqual(await rowCounts(), before, "the report wrote no row");
});

test("an unknown --hosted-model fails with the configured models listed, and writes no report", { timeout: 120_000 }, async () => {
  const out = path.join(outDir, "not-written.json");
  const result = await runScriptAsync("scripts/report-cost-time.mts", ["--hosted-model", "gpt-unknown", "--out", out], ENV);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--hosted-model "gpt-unknown" has no price in LLM_PRICES_USD_PER_MTOK \(models: fake-model, hosted\)/);
  await assert.rejects(readFile(out, "utf8"), { code: "ENOENT" });
});
