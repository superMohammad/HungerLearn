/**
 * A changed procedure gets fresh steps on a v2 upload (plan docs/plans/2026-11-28-v2-stale-steps.md).
 * Run: TEST_DATABASE_URL=postgresql://<superuser>@host:port/<db> pnpm test:db
 * The real `runUploadPipeline` runs the v2 update against a fresh database. The LLM is a local fake server.
 * docproc's output (its tables) is written by the test, and DOCPROC_BIN points at a no-op script, so the
 * Python docproc is not needed.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { readonlySql, sql } from "@/lib/db";
import { recordQueued, runUploadPipeline } from "@/lib/pipeline";
import type { ClauseStatus, ComparisonReport } from "@/lib/types";
import { appEnv, REPO, runScript, startFakeLlm, testAdminUrl, withCredentials, withDatabase } from "./helpers";

const adminUrl = testAdminUrl();
const dbName = `hl_test_${randomBytes(6).toString("hex")}`;
const testUrl = withDatabase(adminUrl, dbName);
const readonlyUrl = withCredentials(testUrl, "hl_readonly", "hl_readonly");

const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
let db: postgres.Sql | undefined;
let llm: Server | undefined;
let fakeDocprocDir: string | undefined;
let appEnvSet = false;

/** What the fake LLM was asked: the clause texts of each naming call, and each package generator input. */
const namingInputs: string[][] = [];
const generatorInputs: string[] = [];

/** A clause text containing this makes the fake LLM fail every naming call for it. */
const NAMING_FAILS = "تعذر التسمية";

/** The fake naming answer: one step per clause, quoting the clause, so a step shows which text it came from. */
const freshSteps = (quotes: readonly string[]): string[] => quotes.map((q) => `الخطوة: ${q}`);

const FAKE_PACKAGE = {
  procedure_id: "any",
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
      prompt: "ماذا تفعل؟",
      scene: null,
      time_limit_seconds: null,
      options: [
        { text: "أبلّغ", correct: true, misconception: null },
        { text: "أغادر", correct: false, misconception: "يغادر قبل الإبلاغ" },
      ],
      correct_order: [],
      feedback: "تبلّغ.",
      clause_id: "C1",
      quote: "بلّغ",
      confidence_tap: true,
    },
  ],
  exam: [],
  flags: [],
  resource_requests: [],
  ideas: [],
};

function fakeAnswer(system: string, user: string): unknown {
  if (user.includes('"clip_library"')) {
    generatorInputs.push(user);
    return FAKE_PACKAGE;
  }
  if (system.includes("procedure of a work document")) {
    const input = JSON.parse(user) as { procedures: { procedure_id: string; clauses: string[] }[] };
    for (const p of input.procedures) namingInputs.push(p.clauses);
    if (input.procedures.some((p) => p.clauses.some((q) => q.includes(NAMING_FAILS)))) throw new Error("fake naming failure");
    return { procedures: input.procedures.map((p) => ({ procedure_id: p.procedure_id, title: "عنوان جديد", steps: freshSteps(p.clauses) })) };
  }
  if (system.includes("strict fact checker")) return { supported: true, reason: "مدعوم بالنص" };
  throw new Error(`unexpected prompt: ${system.slice(0, 80)}`);
}

function testDb(): postgres.Sql {
  if (db === undefined) throw new Error("test database not created (see the before hook)");
  return db;
}

type ClauseSpec = { stableId: string; v1: string; v2: string; status: ClauseStatus; heading: string; number: string };
type ProcedureSpec = { key: string; title: string; steps: string[]; stableIds: string[]; withPackage: boolean };

/**
 * Writes what docproc would leave after processing v1 and v2 (clauses and the comparison), and what the app
 * has for v1 (the document, its procedures, and a package for some of them). The document still points at v1.
 */
async function seedDocument(documentId: string, clauses: readonly ClauseSpec[], procedures: readonly ProcedureSpec[]): Promise<void> {
  const t = testDb();
  await t`INSERT INTO hl_documents (document_id, title, role, language, current_version_id) VALUES (${documentId}, 'انتظار الاستلام', 'courier', 'ar', 'v1')`;
  await t`INSERT INTO documents (document_id) VALUES (${documentId})`;
  for (const [seq, versionId] of ["v1", "v2"].entries()) {
    await t`INSERT INTO document_versions (document_id, version_id, seq, source_file, issues) VALUES (${documentId}, ${versionId}, ${seq + 1}, ${`${versionId}.txt`}, '[]'::jsonb)`;
  }
  for (const [ordinal, c] of clauses.entries()) {
    await t`INSERT INTO clauses (stable_id, document_id, first_version_id, last_version_id) VALUES (${c.stableId}, ${documentId}, 'v1', 'v2')`;
    for (const versionId of ["v1", "v2"] as const) {
      await t`INSERT INTO clause_versions (record_id, document_id, version_id, ordinal, stable_id, quote, statement, clause_number, heading, location, content_hash)
              VALUES (${`${documentId}-${versionId}-${c.stableId}`}, ${documentId}, ${versionId}, ${ordinal}, ${c.stableId}, ${c[versionId]}, '',
                      ${c.number}, ${c.heading}, ${t.json({ page: 1 })}, ${`${c.stableId}-${c[versionId]}`})`;
    }
  }
  const report: ComparisonReport = {
    old_version_id: "v1",
    new_version_id: "v2",
    complete: true,
    summary: { unchanged: 0, moved: 0, changed: 0, added: 0, removed: 0, needs_review: 0 },
    clauses: clauses.map((c) => ({
      status: c.status,
      stable_id: c.stableId,
      old: { quote: c.v1, heading: c.heading },
      new: { quote: c.v2, heading: c.heading },
      change_reasons: c.status === "changed" ? ["number changed"] : [],
    })),
  };
  await t`INSERT INTO comparisons (document_id, new_version_id, old_version_id, complete, report) VALUES (${documentId}, 'v2', 'v1', true, ${t.json(report)})`;
  for (const [ordinal, p] of procedures.entries()) {
    const [row] = await t<{ id: string }[]>`
      INSERT INTO procedures (document_id, version_id, procedure_key, ordinal, title, steps, stable_ids)
      VALUES (${documentId}, 'v1', ${p.key}, ${ordinal}, ${p.title}, ${t.json(p.steps)}, ${t.json(p.stableIds)}) RETURNING id`;
    if (!p.withPackage) continue;
    const [pkg] = await t<{ id: string }[]>`
      INSERT INTO training_packages (procedure_id, document_id, version_id, procedure_key, role, language, status, flags, resource_requests, ideas)
      VALUES (${row.id}, ${documentId}, 'v1', ${p.key}, 'courier', 'ar', 'ok', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb) RETURNING id`;
    await t`INSERT INTO training_items (package_id, document_id, version_id, procedure_key, role, kind, ordinal, stable_id, quote, payload, status)
            VALUES (${pkg.id}, ${documentId}, 'v1', ${p.key}, 'courier', 'practice', 0, ${p.stableIds[0]}, 'بلّغ', ${t.json(FAKE_PACKAGE.practice[0])}, 'published')`;
  }
}

async function runV2Update(documentId: string): Promise<void> {
  await runUploadPipeline(documentId, "v2", "v2.txt", await recordQueued(documentId, "v2"));
}

async function v2Procedure(documentId: string, key: string): Promise<{ title: string; steps: string[] }> {
  const rows = await testDb()<{ title: string; steps: string[] }[]>`
    SELECT title, steps FROM procedures WHERE document_id = ${documentId} AND version_id = 'v2' AND procedure_key = ${key}`;
  assert.equal(rows.length, 1, `no v2 procedure ${key}`);
  return { title: rows[0].title, steps: rows[0].steps };
}

before(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  db = postgres(testUrl, { max: 2, onnotice: () => undefined });
  const migrated = runScript("scripts/migrate.mts", [], { DATABASE_URL: testUrl });
  assert.equal(migrated.status, 0, `pnpm db:migrate failed:\n${migrated.stdout}\n${migrated.stderr}`);
  // docproc's own tables, from its real schema file, so the test follows schema changes.
  const schema = await readFile(path.join(REPO, "-", "docproc", "src", "docproc", "storage", "schema_postgres.sql"), "utf8");
  await testDb().unsafe(schema.replaceAll("{embedding_dim}", "768"));
  // runDocproc runs `<DOCPROC_BIN> process <file> …` in DOCPROC_DIR: with node as the binary, that runs this no-op file.
  fakeDocprocDir = await mkdtemp(path.join(tmpdir(), "hl-fake-docproc-"));
  await writeFile(path.join(fakeDocprocDir, "process"), "// fake docproc: the test already wrote its tables\n");
  llm = await startFakeLlm(fakeAnswer);
  Object.assign(process.env, appEnv(testUrl, readonlyUrl, (llm.address() as AddressInfo).port), {
    DOCPROC_BIN: process.execPath,
    DOCPROC_DIR: fakeDocprocDir,
  });
  appEnvSet = true;
});

/** Always drops the test database, even when setup failed halfway. */
after(async () => {
  const closing = await Promise.allSettled([
    appEnvSet ? sql().end() : Promise.resolve(),
    appEnvSet ? readonlySql().end() : Promise.resolve(),
    db?.end() ?? Promise.resolve(),
    new Promise<void>((resolve) => (llm === undefined ? resolve() : llm.close(() => resolve()))),
    fakeDocprocDir === undefined ? Promise.resolve() : rm(fakeDocprocDir, { recursive: true, force: true }),
  ]);
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
  const failed = closing.find((r) => r.status === "rejected");
  if (failed !== undefined) throw failed.reason;
});

const UNIFORM: ClauseSpec = { stableId: "CW-01", v1: "ارتدِ الزي الرسمي قبل دخول الفرع.", v2: "ارتدِ الزي الرسمي قبل دخول الفرع.", status: "unchanged", heading: "١. الزي", number: "1.1" };
const DELAY: ClauseSpec = {
  stableId: "CW-02",
  v1: "إذا بقي الطلب قيد التجهيز بعد ١٥ دقيقة، بلّغ مسؤول التوزيع.",
  v2: "إذا بقي الطلب قيد التجهيز بعد 10 دقائق، بلّغ مسؤول التوزيع.",
  status: "changed",
  heading: "٢. تأخر التجهيز",
  number: "2.1",
};
const HANDOVER: ClauseSpec = { stableId: "CW-03", v1: "سلّم الطلب خلال ٣٠ دقيقة.", v2: "سلّم الطلب خلال 25 دقيقة.", status: "changed", heading: "٣. التسليم", number: "3.1" };

test("a v2 upload refreshes the steps of changed procedures and leaves unchanged ones alone", { timeout: 120_000 }, async () => {
  const doc = "courier-pickup-wait";
  await seedDocument(doc, [UNIFORM, DELAY, HANDOVER], [
    { key: "uniform", title: "الزي الرسمي", steps: ["ارتدِ الزي الرسمي"], stableIds: ["CW-01"], withPackage: true },
    { key: "delay", title: "تأخر تجهيز الطلب", steps: ["انتظر ١٥ دقيقة ثم بلّغ"], stableIds: ["CW-02"], withPackage: true },
    // Changed, but never generated: nothing regenerates it, so only the steps refresh can fix it.
    { key: "handover", title: "تسليم الطلب", steps: ["سلّم خلال ٣٠ دقيقة"], stableIds: ["CW-03"], withPackage: false },
  ]);

  await runV2Update(doc);

  // Changed procedure with a package: new steps from the v2 clause; the title is kept (plan, open question 1).
  assert.deepEqual(await v2Procedure(doc, "delay"), { title: "تأخر تجهيز الطلب", steps: freshSteps([DELAY.v2]) });
  // Its regenerated package was written from the new steps, never the old "15 minutes" ones.
  const delayInputs = generatorInputs.filter((u) => u.includes(DELAY.v2));
  assert.equal(delayInputs.length, 1, "the changed procedure is regenerated once");
  assert.ok(delayInputs[0].includes(freshSteps([DELAY.v2])[0]), "the generator sees the new steps");
  assert.ok(!delayInputs[0].includes("انتظر ١٥ دقيقة ثم بلّغ"), "the generator never sees the old steps");

  // Changed procedure without a package: its steps are refreshed too.
  assert.deepEqual(await v2Procedure(doc, "handover"), { title: "تسليم الطلب", steps: freshSteps([HANDOVER.v2]) });

  // Unchanged procedure: copied exactly, and no naming call was made for its clause.
  assert.deepEqual(await v2Procedure(doc, "uniform"), { title: "الزي الرسمي", steps: ["ارتدِ الزي الرسمي"] });
  assert.ok(!namingInputs.some((quotes) => quotes.includes(UNIFORM.v2)), "no naming call for the unchanged procedure");
});

test("when naming a changed procedure keeps failing, the update job fails and names the procedure", { timeout: 120_000 }, async () => {
  const doc = "courier-naming-fails";
  const broken: ClauseSpec = { ...DELAY, stableId: "NF-02", v2: `${DELAY.v2} ${NAMING_FAILS}` };
  await seedDocument(doc, [broken], [{ key: "delay", title: "تأخر تجهيز الطلب", steps: ["انتظر ١٥ دقيقة ثم بلّغ"], stableIds: ["NF-02"], withPackage: true }]);

  await assert.rejects(runV2Update(doc));

  const jobs = await testDb()<{ status: string; error: string }[]>`
    SELECT status, error FROM pipeline_jobs WHERE document_id = ${doc} AND version_id = 'v2' AND step = 'update'`;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "failed");
  assert.match(jobs[0].error, /تأخر تجهيز الطلب/, "the error names the procedure");
  // Nothing was regenerated from the old steps, and the document still points at v1.
  assert.ok(!generatorInputs.some((u) => u.includes(NAMING_FAILS)), "no package generated without fresh steps");
  const [d] = await testDb()<{ current_version_id: string }[]>`SELECT current_version_id FROM hl_documents WHERE document_id = ${doc}`;
  assert.equal(d.current_version_id, "v1");
});
