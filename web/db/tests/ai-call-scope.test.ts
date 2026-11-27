/**
 * Migration 003 and AI-call scope against a real Postgres (plan docs/plans/2026-11-26-ai-call-scope.md).
 * Run: TEST_DATABASE_URL=postgresql://<superuser>@host:port/<db> pnpm test:db
 * Each run creates a fresh database on that server and drops it afterwards; the app database is never touched.
 * The LLM is a local fake OpenAI-compatible server, so the real generateStructured, groupProcedures,
 * verifyEditedQuestion and askReadiness code paths run without a model.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { generateStructured } from "@/lib/ai";
import { readonlySql, sql } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { buildPackage, groupProcedures, verifyEditedQuestion } from "@/lib/generation";
import { askReadiness } from "@/lib/readiness";
import type { Clause, HlDocument, Procedure, QuestionPayload } from "@/lib/types";
import { z } from "zod";
import { appEnv, FAKE_MODEL, INPUT_TOKENS, OUTPUT_TOKENS, runScript, startFakeLlm, testAdminUrl, WEB, withCredentials, withDatabase } from "./helpers";

const MIGRATIONS = path.join(WEB, "db", "migrations");

const adminUrl = testAdminUrl();
const dbName = `hl_test_${randomBytes(6).toString("hex")}`;
const testUrl = withDatabase(adminUrl, dbName);
const readonlyUrl = withCredentials(testUrl, "hl_readonly", "hl_readonly");

const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
let db: postgres.Sql | undefined;
let llm: Server | undefined;
let appEnvSet = false;

/** One practice question, no lesson or video: enough for buildPackage to run the package call and the judge. */
const FAKE_PACKAGE = {
  procedure_id: "pickup-delay",
  role: "courier",
  language: "ar",
  status: "ok",
  skip_reason: null,
  lesson: null,
  video: null,
  practice: [
    {
      id: "q1",
      format: "mcq",
      prompt: "تأخر تجهيز الطلب 10 دقائق. ماذا تفعل؟",
      scene: null,
      time_limit_seconds: null,
      options: [
        { text: "أبلّغ مركز التوزيع", correct: true, misconception: null },
        { text: "أغادر بدون إبلاغ", correct: false, misconception: "يغادر قبل الإبلاغ" },
      ],
      correct_order: [],
      feedback: "عند 10 دقائق أو أكثر تبلّغ المركز.",
      clause_id: "C1",
      quote: "بلّغ مركز التوزيع",
      confidence_tap: true,
    },
  ],
  exam: [],
  flags: [],
  resource_requests: [],
  ideas: [],
};

/** Answers each prompt kind with a fixed, schema-valid object and fixed token usage. */
function fakeAnswer(system: string, user: string): unknown {
  if (user.includes('"clip_library"')) return FAKE_PACKAGE;
  if (system.includes("procedure of a work document")) {
    return { procedures: [{ procedure_id: "P1", title: "تأخر تجهيز الطلب", steps: ["انتظر عشر دقائق ثم بلّغ"] }] };
  }
  if (system.includes("strict fact checker")) return { supported: true, reason: "مدعوم بالنص" };
  if (system.includes("PostgreSQL SELECT")) return { sql: "SELECT name, branch FROM readiness_v LIMIT 5", answer_intro: "النتيجة:" };
  return { ok: true };
}

/** The real `pnpm db:migrate` entry point (scripts/migrate.mts), pointed at the test database. */
function runMigrate(): void {
  const result = runScript("scripts/migrate.mts", [], { DATABASE_URL: testUrl });
  assert.equal(result.status, 0, `pnpm db:migrate failed:
${result.stdout}
${result.stderr}`);
}

function setAppEnv(llmPort: number): void {
  Object.assign(process.env, appEnv(testUrl, readonlyUrl, llmPort));
  appEnvSet = true;
}

function testDb(): postgres.Sql {
  if (db === undefined) throw new Error("test database not created (see the before hook)");
  return db;
}

type AiCallRow = { purpose: string; model: string; document_id: string | null; version_id: string | null; input_tokens: number; output_tokens: number };

/** Highest ai_calls id so far: rows with a larger id were written by the code under test. */
async function lastId(): Promise<string> {
  const [{ id }] = await testDb()<{ id: string }[]>`SELECT COALESCE(max(id), 0)::text AS id FROM ai_calls`;
  return id;
}

type ScopeRow = { purpose: string; document_id: string | null; version_id: string | null };

async function callsSince(id: string): Promise<ScopeRow[]> {
  const rows = await testDb()<ScopeRow[]>`
    SELECT purpose, document_id, version_id FROM ai_calls WHERE id > ${id}::bigint ORDER BY id`;
  return rows.map((r) => ({ ...r }));
}

async function lastCall(purpose: string): Promise<AiCallRow> {
  const rows = await testDb()<AiCallRow[]>`
    SELECT purpose, model, document_id, version_id, input_tokens, output_tokens FROM ai_calls
    WHERE purpose = ${purpose} ORDER BY id DESC LIMIT 1`;
  assert.equal(rows.length, 1, `no ai_calls row for ${purpose}`);
  return rows[0];
}

/** v2 is being processed while the document still points at v1, as during a real v2 upload. */
const DOC: HlDocument = {
  documentId: "courier-pickup-wait",
  title: "انتظار الاستلام",
  role: "courier",
  partnerType: null,
  language: "ar",
  currentVersionId: "v1",
};
const CLAUSE: Clause = {
  recordId: "r1",
  stableId: "CW-02",
  ordinal: 1,
  quote: "إذا تأخر تجهيز الطلب 10 دقائق أو أكثر، بلّغ مركز التوزيع.",
  statement: "Escalate at 10 minutes or more.",
  heading: "٢. تأخر التجهيز",
  clauseNumber: "2.1",
  page: 1,
};

before(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  db = postgres(testUrl, { max: 2, onnotice: () => undefined });
  llm = await startFakeLlm(fakeAnswer);
  setAppEnv((llm.address() as AddressInfo).port);
});

/** Always drops the test database, even when setup failed halfway. */
after(async () => {
  const closing = await Promise.allSettled([
    appEnvSet ? sql().end() : Promise.resolve(),
    appEnvSet ? readonlySql().end() : Promise.resolve(),
    db?.end() ?? Promise.resolve(),
    new Promise<void>((resolve) => (llm === undefined ? resolve() : llm.close(() => resolve()))),
  ]);
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
  const failed = closing.find((r) => r.status === "rejected");
  if (failed !== undefined) throw failed.reason;
});

test("migration 003 runs twice on a database that already logged calls, and keeps the old rows", async () => {
  for (const file of ["001_init.sql", "002_accounts.sql"]) {
    await testDb().unsafe(await readFile(path.join(MIGRATIONS, file), "utf8"));
  }
  await testDb()`INSERT INTO ai_calls (purpose, model, prompt_version, input_tokens, output_tokens, duration_ms)
           VALUES ('generate.package', 'gemma4:latest', 'old', 10, 5, 100)`;

  runMigrate();
  runMigrate();

  const columns = await testDb()<{ column_name: string; is_nullable: string; data_type: string }[]>`
    SELECT column_name, is_nullable, data_type FROM information_schema.columns
    WHERE table_name = 'ai_calls' AND column_name IN ('document_id', 'version_id') ORDER BY column_name`;
  assert.deepEqual(
    columns.map((c) => ({ ...c })),
    [
      { column_name: "document_id", is_nullable: "YES", data_type: "text" },
      { column_name: "version_id", is_nullable: "YES", data_type: "text" },
    ],
  );
  const constraints = await testDb()<{ conname: string; contype: string; def: string }[]>`
    SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'ai_calls'::regclass AND contype IN ('f', 'c') ORDER BY conname`;
  assert.deepEqual(
    constraints.map((c) => ({ ...c })),
    [
      { conname: "ai_calls_document_id_fkey", contype: "f", def: "FOREIGN KEY (document_id) REFERENCES hl_documents(document_id)" },
      { conname: "ai_calls_version_needs_document", contype: "c", def: "CHECK (((version_id IS NULL) OR (document_id IS NOT NULL)))" },
    ],
  );
  const index = await testDb()<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_ai_calls_doc'`;
  assert.match(index[0]?.indexdef ?? "", /ON public\.ai_calls USING btree \(document_id, version_id\)/);

  const old = await testDb()<{ prompt_version: string; document_id: string | null; version_id: string | null }[]>`
    SELECT prompt_version, document_id, version_id FROM ai_calls`;
  assert.deepEqual(old.map((r) => ({ ...r })), [{ prompt_version: "old", document_id: null, version_id: null }]);

  await testDb()`INSERT INTO hl_documents (document_id, title, role, language, current_version_id)
           VALUES (${DOC.documentId}, ${DOC.title}, ${DOC.role}, ${DOC.language}, ${DOC.currentVersionId})`;
});

test("procedure naming logs the version being processed, not the document's current version", async () => {
  const drafts = await groupProcedures(DOC, "v2", [CLAUSE]);
  assert.equal(drafts.length, 1);
  assert.deepEqual(await lastCall("understand.name_procedures"), {
    purpose: "understand.name_procedures",
    model: FAKE_MODEL,
    document_id: DOC.documentId,
    version_id: "v2",
    input_tokens: INPUT_TOKENS,
    output_tokens: OUTPUT_TOKENS,
  });
});

test("package generation and its judge calls log the procedure's version", async () => {
  const procedure: Procedure = {
    id: "00000000-0000-0000-0000-000000000001",
    documentId: DOC.documentId,
    versionId: "v2",
    procedureKey: "pickup-delay",
    ordinal: 0,
    title: "تأخر تجهيز الطلب",
    steps: ["بلّغ مركز التوزيع"],
    stableIds: [CLAUSE.stableId],
  };
  const since = await lastId();
  const pkg = await buildPackage(DOC, procedure, [CLAUSE], "");
  assert.equal(pkg.items.length, 1);
  assert.deepEqual(
    await callsSince(since),
    [
      { purpose: "generate.package", document_id: DOC.documentId, version_id: "v2" },
      { purpose: "verify.judge", document_id: DOC.documentId, version_id: "v2" },
    ],
  );
});

test("the verification judge logs the document and version of the item it checks", async () => {
  const payload: QuestionPayload = {
    format: "mcq",
    prompt: "تأخر تجهيز الطلب 10 دقائق. ماذا تفعل؟",
    scene: null,
    time_limit_seconds: null,
    options: [
      { text: "أبلّغ مركز التوزيع", correct: true, misconception: null },
      { text: "أغادر بدون إبلاغ", correct: false, misconception: "يغادر قبل الإبلاغ" },
    ],
    correct_order: [],
    feedback: "عند 10 دقائق أو أكثر تبلّغ المركز.",
    confidence_tap: true,
  };
  // Its own version id, so only this call can satisfy the check (earlier tests logged judge calls for v2).
  const since = await lastId();
  await verifyEditedQuestion(DOC, "v3", payload, CLAUSE.quote, CLAUSE);
  assert.deepEqual(await callsSince(since), [{ purpose: "verify.judge", document_id: DOC.documentId, version_id: "v3" }]);
});

test("readiness text-to-SQL is about learners, so its call has no document or version", async () => {
  const result = await askReadiness("من أتقن إجراء تأخر التجهيز؟");
  assert.equal(result.sql, "SELECT name, branch FROM readiness_v LIMIT 5");
  const row = await lastCall("readiness.text_to_sql");
  assert.equal(row.document_id, null);
  assert.equal(row.version_id, null);
});

test("a call scoped to an unknown document is rejected by the foreign key, not logged", async () => {
  await assert.rejects(
    generateStructured({
      purpose: "test.unknown_document",
      promptVersion: "test",
      system: "test",
      prompt: "test",
      schema: z.object({ ok: z.boolean() }),
      scope: { documentId: "no-such-document", versionId: "v1" },
    }),
    (e: unknown) => e instanceof Error && (e.cause as { code?: string } | undefined)?.code === "23503",
  );
  const rows = await testDb()`SELECT 1 FROM ai_calls WHERE purpose = 'test.unknown_document'`;
  assert.equal(rows.length, 0);
});

test("a version without a document is rejected by the CHECK constraint", async () => {
  await assert.rejects(
    testDb()`INSERT INTO ai_calls (purpose, model, prompt_version, input_tokens, output_tokens, duration_ms, version_id)
       VALUES ('test.orphan_version', 'm', 'test', 0, 0, 0, 'v1')`,
    (e: unknown) => (e as { code?: string }).code === "23514",
  );
});

test("hl_readonly (the text-to-SQL role) cannot read the AI call log", async () => {
  const readonly = postgres(readonlyUrl, { max: 1, onnotice: () => undefined });
  try {
    await assert.rejects(readonly`SELECT document_id FROM ai_calls`, (e: unknown) => (e as { code?: string }).code === "42501");
    const visible = await readonly<{ n: number }[]>`SELECT count(*)::int AS n FROM readiness_v`;
    assert.equal(visible.length, 1, "hl_readonly still reads readiness_v");
  } finally {
    await readonly.end();
  }
});

test("serverEnv fails loudly when LLM_PRICES_USD_PER_MTOK is missing or lacks the configured model", () => {
  const saved = process.env.LLM_PRICES_USD_PER_MTOK;
  try {
    delete process.env.LLM_PRICES_USD_PER_MTOK;
    assert.throws(() => serverEnv(), /Missing environment variable LLM_PRICES_USD_PER_MTOK/);
    process.env.LLM_PRICES_USD_PER_MTOK = '{"other-model":{"input":0,"output":0}}';
    assert.throws(() => serverEnv(), /no price for model "fake-model" \(LLM_MODEL\)/);
    process.env.LLM_PRICES_USD_PER_MTOK = "not json";
    assert.throws(() => serverEnv(), /LLM_PRICES_USD_PER_MTOK is not valid JSON/);
  } finally {
    process.env.LLM_PRICES_USD_PER_MTOK = saved;
  }
});
