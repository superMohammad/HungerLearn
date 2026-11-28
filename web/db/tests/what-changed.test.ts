/**
 * B7: the "What changed" lesson and the badge recheck after a new upload of a document.
 * - A learner in needs_refresh sees what_changed first (auto mode) until their first answer on the current
 *   version; ?changes=1 keeps it reachable until they pass.
 * - needs_refresh survives wrong answers (and keeps the version where the refresh started) until every
 *   exam item of the current version is passed; then the badge (mastered) is back on the current version.
 * - A learner who skipped an upload sees the net change since the version they learned.
 * Run: TEST_DATABASE_URL=postgresql://<superuser>@host:port/<db> pnpm test:db
 * Each run creates a fresh database on that server and drops it afterwards; the app database is never touched.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { sql } from "@/lib/db";
import { flagAffectedLearners, gradeAnswer, nextScreen } from "@/lib/learning";
import { getDocument, getLearner } from "@/lib/repo";
import type { ClauseStatus, ComparisonReport, QuestionPayload } from "@/lib/types";
import { appEnv, runScript, testAdminUrl, withDatabase } from "./helpers";

const adminUrl = testAdminUrl();
const dbName = `hl_test_${randomBytes(6).toString("hex")}`;
const testUrl = withDatabase(adminUrl, dbName);
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
let db: postgres.Sql | undefined;
let appEnvSet = false;

function testDb(): postgres.Sql {
  if (db === undefined) throw new Error("test database not created (see the before hook)");
  return db;
}

before(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  db = postgres(testUrl, { max: 2, onnotice: () => undefined });
  const migrate = runScript("scripts/migrate.mts", [], { DATABASE_URL: testUrl });
  assert.equal(migrate.status, 0, `pnpm db:migrate failed:\n${migrate.stdout}\n${migrate.stderr}`);
  // docproc owns `comparisons` (-/docproc/src/docproc/storage/schema_postgres.sql); the columns the app reads.
  await testDb()`
    CREATE TABLE comparisons (document_id TEXT NOT NULL, new_version_id TEXT NOT NULL, old_version_id TEXT,
                              complete BOOLEAN NOT NULL, report JSONB NOT NULL, PRIMARY KEY (document_id, new_version_id))`;
  Object.assign(process.env, appEnv(testUrl, "postgresql://unused@127.0.0.1:1/unused", 1));
  appEnvSet = true;
});

/** Always drops the test database, even when setup failed halfway. */
after(async () => {
  const closing = await Promise.allSettled([appEnvSet ? sql().end() : Promise.resolve(), db?.end() ?? Promise.resolve()]);
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
  const failed = closing.find((r) => r.status === "rejected");
  if (failed !== undefined) throw failed.reason;
});

const KEY = "pickup-wait";
const CW01 = "ابدأ حساب الانتظار عند اختيار «وصلت إلى الفرع» في التطبيق.";
const CW02_V1 = "إذا بقي الطلب قيد التجهيز بعد ١٥ دقيقة من تسجيل الوصول، أرسل بلاغ «تأخر الاستلام».";
const CW02_V2 = "إذا بقي الطلب قيد التجهيز بعد 10 دقائق من تسجيل الوصول، أرسل بلاغ «تأخر الاستلام».";
const CW04 = "لا تغادر الفرع حتى يوجّهك مسؤول التوزيع بالمغادرة.";

function mcq(prompt: string): QuestionPayload {
  return {
    format: "mcq", prompt, scene: null, time_limit_seconds: null, feedback: "f", confidence_tap: true, correct_order: [],
    options: [
      { text: "أرسل بلاغ التأخر", correct: true, misconception: null },
      { text: "انتظر أكثر", correct: false, misconception: "يظن أن الانتظار مفتوح" },
    ],
  };
}
const RIGHT = { format: "mcq" as const, choice: 0 };
const WRONG = { format: "mcq" as const, choice: 1 };

type Row = { stable_id: string; status: ClauseStatus; old: string | null; new: string | null; reasons?: string[] };

function report(oldVersionId: string, newVersionId: string, rows: Row[]): ComparisonReport {
  return {
    old_version_id: oldVersionId, new_version_id: newVersionId, complete: true,
    summary: { unchanged: 0, moved: 0, changed: 0, added: 0, removed: 0, needs_review: 0 },
    clauses: rows.map((r) => ({
      status: r.status, stable_id: r.stable_id, change_reasons: r.reasons ?? [],
      old: r.old === null ? null : { quote: r.old, heading: null }, new: r.new === null ? null : { quote: r.new, heading: null },
    })),
  };
}

const V1_TO_V2 = report("v1", "v2", [
  { stable_id: "CW-01", status: "unchanged", old: CW01, new: CW01 },
  { stable_id: "CW-02", status: "changed", old: CW02_V1, new: CW02_V2, reasons: ["numbers: 15 -> 10"] },
  { stable_id: "CW-04", status: "moved", old: CW04, new: CW04, reasons: ["location changed"] },
]);
const V2_TO_V3_QUIET = report("v2", "v3", [
  { stable_id: "CW-01", status: "unchanged", old: CW01, new: CW01 },
  { stable_id: "CW-02", status: "unchanged", old: CW02_V2, new: CW02_V2 },
  { stable_id: "CW-04", status: "unchanged", old: CW04, new: CW04 },
]);

const CW04_V3 = "لا تغادر الفرع حتى يوجّهك مسؤول التوزيع بالمغادرة كتابيًا في التطبيق.";
const V2_TO_V3_CHANGED = report("v2", "v3", [
  { stable_id: "CW-01", status: "unchanged", old: CW01, new: CW01 },
  { stable_id: "CW-02", status: "unchanged", old: CW02_V2, new: CW02_V2 },
  { stable_id: "CW-04", status: "changed", old: CW04, new: CW04_V3, reasons: ["wording changed"] },
]);

type Fixture = { documentId: string; practice: string; exams: string[] };

/**
 * A courier document with `versions` uploads (the last one current), the procedure on every version,
 * and on the current version one published practice item and two published exam items.
 */
async function fixture(name: string, versions: string[], reports: ComparisonReport[], current = versions.at(-1) as string): Promise<Fixture> {
  const t = testDb();
  const documentId = `b7-${name}`;
  await t`INSERT INTO hl_documents (document_id, title, role, language, current_version_id)
          VALUES (${documentId}, 'انتظار الاستلام', 'courier', 'ar', ${current})`;
  let procId = "";
  for (const v of versions) {
    const [p] = await t<{ id: string }[]>`
      INSERT INTO procedures (document_id, version_id, procedure_key, ordinal, title, steps, stable_ids)
      VALUES (${documentId}, ${v}, ${KEY}, 0, 'انتظار الطلب في الفرع', '["سجّل الوصول"]'::jsonb, '["CW-01","CW-02","CW-04"]'::jsonb) RETURNING id`;
    procId = p.id;
  }
  for (const r of reports) {
    await t`INSERT INTO comparisons (document_id, new_version_id, old_version_id, complete, report)
            VALUES (${documentId}, ${r.new_version_id}, ${r.old_version_id}, ${r.complete}, ${t.json(r as never)})`;
  }
  const [pkg] = await t<{ id: string }[]>`
    INSERT INTO training_packages (procedure_id, document_id, version_id, procedure_key, role, language, status, flags, resource_requests, ideas)
    VALUES (${procId}, ${documentId}, ${current}, ${KEY}, 'courier', 'ar', 'ok', '[]', '[]', '[]') RETURNING id`;
  const item = async (kind: "practice" | "exam", ordinal: number): Promise<string> => {
    const [row] = await t<{ id: string }[]>`
      INSERT INTO training_items (package_id, document_id, version_id, procedure_key, role, kind, ordinal, stable_id, quote, payload, status)
      VALUES (${pkg.id}, ${documentId}, ${current}, ${KEY}, 'courier', ${kind}, ${ordinal}, 'CW-02', ${CW02_V2},
              ${t.json(mcq(`سؤال ${kind} ${ordinal}`) as never)}, 'published') RETURNING id`;
    return row.id;
  };
  return { documentId, practice: await item("practice", 0), exams: [await item("exam", 1), await item("exam", 2)] };
}

async function learner(learnerId: string, documentId: string, mastery: { state: string; versionId: string } | null): Promise<void> {
  const t = testDb();
  await t`INSERT INTO learners (learner_id, name, role, branch, language, device) VALUES (${learnerId}, ${learnerId}, 'courier', 'riyadh', 'ar', 'phone')`;
  if (mastery !== null) {
    await t`INSERT INTO mastery (learner_id, document_id, procedure_key, version_id, state)
            VALUES (${learnerId}, ${documentId}, ${KEY}, ${mastery.versionId}, ${mastery.state})`;
  }
}

async function mastery(learnerId: string, documentId: string): Promise<{ state: string; version_id: string } | undefined> {
  const [row] = await testDb()<{ state: string; version_id: string }[]>`
    SELECT state, version_id FROM mastery WHERE learner_id = ${learnerId} AND document_id = ${documentId} AND procedure_key = ${KEY}`;
  return row;
}

async function screenKind(learnerId: string, documentId: string, mode: "auto" | "lesson" | "questions" | "changes"): Promise<string> {
  const s = await nextScreen(await getLearner(learnerId), await getDocument(documentId), KEY, mode);
  return s.kind === "screen" ? s.spec.kind : s.kind;
}

test("needs_refresh: what_changed comes first, shows only the changed clause, and stays reachable with ?changes=1", async () => {
  const f = await fixture("first", ["v1", "v2"], [V1_TO_V2]);
  await learner("b7-first", f.documentId, { state: "needs_refresh", versionId: "v2" });

  const first = await nextScreen(await getLearner("b7-first"), await getDocument(f.documentId), KEY, "auto");
  assert.equal(first.kind, "screen");
  assert.ok(first.kind === "screen" && first.spec.kind === "what_changed");
  assert.equal(first.spec.fromVersionId, "v1");
  assert.equal(first.spec.toVersionId, "v2");
  assert.deepEqual(first.spec.changes.map((c) => [c.stableId, c.change, c.before, c.after]), [["CW-02", "changed", CW02_V1, CW02_V2]]);
  assert.equal(first.changesAvailable, true);

  // "Continue to the lesson" opens lesson mode, which is not gated.
  assert.notEqual(await screenKind("b7-first", f.documentId, "lesson"), "what_changed");

  await gradeAnswer(await getLearner("b7-first"), f.practice, RIGHT, "sure");
  assert.equal(await screenKind("b7-first", f.documentId, "auto"), "question", "after the first answer the flow continues");
  assert.equal(await screenKind("b7-first", f.documentId, "changes"), "what_changed");
});

test("needs_refresh stays (at the version where the refresh started) until every new exam item is passed", async () => {
  const f = await fixture("recheck", ["v1", "v2"], [V1_TO_V2]);
  await learner("b7-recheck", f.documentId, { state: "needs_refresh", versionId: "v2" });
  const l = await getLearner("b7-recheck");

  const wrong = await gradeAnswer(l, f.exams[0], WRONG, "sure");
  assert.equal(wrong.state, "needs_refresh");
  assert.deepEqual(await mastery("b7-recheck", f.documentId), { state: "needs_refresh", version_id: "v2" });

  await gradeAnswer(l, f.practice, RIGHT, "sure");
  await gradeAnswer(l, f.exams[0], RIGHT, "sure");
  assert.equal((await mastery("b7-recheck", f.documentId))?.state, "needs_refresh", "one exam item left");
  const passed = await gradeAnswer(l, f.exams[1], RIGHT, "sure");
  assert.equal(passed.state, "mastered");
  assert.deepEqual(await mastery("b7-recheck", f.documentId), { state: "mastered", version_id: "v2" });
  assert.equal(await screenKind("b7-recheck", f.documentId, "auto"), "mastered");
  assert.equal(await screenKind("b7-recheck", f.documentId, "changes"), "mastered", "no what-changed once the badge is back");
});

test("skipped upload: the learner sees the net change since the version they learned; passing marks the current version", async () => {
  const f = await fixture("skip", ["v1", "v2", "v3"], [V1_TO_V2, V2_TO_V3_QUIET]);
  await learner("b7-skip", f.documentId, { state: "needs_refresh", versionId: "v2" });
  const s = await nextScreen(await getLearner("b7-skip"), await getDocument(f.documentId), KEY, "auto");
  assert.ok(s.kind === "screen" && s.spec.kind === "what_changed");
  assert.equal(s.spec.fromVersionId, "v1");
  assert.equal(s.spec.toVersionId, "v3");
  assert.deepEqual(s.spec.changes.map((c) => c.stableId), ["CW-02"]);

  const l = await getLearner("b7-skip");
  await gradeAnswer(l, f.exams[0], WRONG, "unsure");
  assert.deepEqual(await mastery("b7-skip", f.documentId), { state: "needs_refresh", version_id: "v2" });
  for (const id of [f.practice, ...f.exams]) await gradeAnswer(l, id, RIGHT, "sure");
  assert.deepEqual(await mastery("b7-skip", f.documentId), { state: "mastered", version_id: "v3" });
});

test("a missing comparison in the chain fails with the version, never a partial diff", async () => {
  const f = await fixture("gap", ["v1", "v2", "v3"], [V1_TO_V2]);
  await learner("b7-gap", f.documentId, { state: "needs_refresh", versionId: "v2" });
  await assert.rejects(nextScreen(await getLearner("b7-gap"), await getDocument(f.documentId), KEY, "auto"), /v3/);
});

test("flagAffectedLearners: started and mastered learners are flagged; waiting learners keep their start; not_started untouched", async () => {
  const f = await fixture("flag", ["v1", "v2", "v3"], [V1_TO_V2, V2_TO_V3_CHANGED]);
  await learner("b7-mastered", f.documentId, { state: "mastered", versionId: "v2" });
  await learner("b7-started", f.documentId, { state: "in_progress", versionId: "v2" });
  await learner("b7-waiting", f.documentId, { state: "needs_refresh", versionId: "v2" });
  await learner("b7-new", f.documentId, null);

  const notified = await flagAffectedLearners(f.documentId, KEY, "v3", "تحديث");
  assert.deepEqual([...notified].sort(), ["b7-mastered", "b7-started", "b7-waiting"]);
  assert.deepEqual(await mastery("b7-mastered", f.documentId), { state: "needs_refresh", version_id: "v3" });
  assert.deepEqual(await mastery("b7-started", f.documentId), { state: "needs_refresh", version_id: "v3" });
  assert.deepEqual(await mastery("b7-waiting", f.documentId), { state: "needs_refresh", version_id: "v2" });
  assert.equal(await mastery("b7-new", f.documentId), undefined);
  const notes = await testDb()<{ learner_id: string; version_id: string }[]>`
    SELECT learner_id, version_id FROM notifications WHERE document_id = ${f.documentId} ORDER BY learner_id`;
  assert.deepEqual(notes.map((n) => [n.learner_id, n.version_id]), [["b7-mastered", "v3"], ["b7-started", "v3"], ["b7-waiting", "v3"]]);

  // A learner who had only started gets the same lesson (v2 → v3); one who waited since v2 sees both uploads; one who never started gets none.
  const started = await nextScreen(await getLearner("b7-started"), await getDocument(f.documentId), KEY, "auto");
  assert.ok(started.kind === "screen" && started.spec.kind === "what_changed");
  assert.deepEqual([started.spec.fromVersionId, started.spec.changes.map((c) => c.stableId)], ["v2", ["CW-04"]]);
  const waiting = await nextScreen(await getLearner("b7-waiting"), await getDocument(f.documentId), KEY, "auto");
  assert.ok(waiting.kind === "screen" && waiting.spec.kind === "what_changed");
  assert.deepEqual([waiting.spec.fromVersionId, waiting.spec.changes.map((c) => c.stableId)], ["v1", ["CW-02", "CW-04"]]);
  assert.notEqual(await screenKind("b7-new", f.documentId, "auto"), "what_changed");
  assert.notEqual(await screenKind("b7-new", f.documentId, "changes"), "what_changed");
});

test("during the update window (new upload stored, old training still current) old answers cannot clear the refresh", async () => {
  // applyNewVersion flags learners before the slow regeneration; the document's current version moves at the end.
  const f = await fixture("window", ["v1", "v2"], [V1_TO_V2], "v1");
  await learner("b7-window", f.documentId, { state: "needs_refresh", versionId: "v2" });
  const l = await getLearner("b7-window");
  const s = await nextScreen(l, await getDocument(f.documentId), KEY, "auto");
  assert.ok(s.kind !== "screen" || s.spec.kind !== "what_changed", "no What changed before the revised training is current");
  for (const id of [f.practice, ...f.exams]) await gradeAnswer(l, id, RIGHT, "sure");
  assert.deepEqual(await mastery("b7-window", f.documentId), { state: "needs_refresh", version_id: "v2" });
});

test("?changes=1 with nothing left to re-learn behaves like the normal flow, and offers no review link", async () => {
  const revert = report("v2", "v3", [
    { stable_id: "CW-01", status: "unchanged", old: CW01, new: CW01 },
    { stable_id: "CW-02", status: "changed", old: CW02_V2, new: CW02_V1, reasons: ["numbers: 10 -> 15"] },
    { stable_id: "CW-04", status: "unchanged", old: CW04, new: CW04 },
  ]);
  const f = await fixture("undone", ["v1", "v2", "v3"], [V1_TO_V2, revert]);
  await learner("b7-undone", f.documentId, { state: "needs_refresh", versionId: "v2" });
  for (const mode of ["auto", "changes"] as const) {
    const s = await nextScreen(await getLearner("b7-undone"), await getDocument(f.documentId), KEY, mode);
    assert.ok(s.kind === "screen" && s.spec.kind === "question", mode);
    assert.equal(s.changesAvailable, false);
  }
});

test("flagAffectedLearners is idempotent: re-running the update for the same upload adds no notification", async () => {
  const f = await fixture("rerun", ["v1", "v2"], [V1_TO_V2]);
  await learner("b7-rerun", f.documentId, { state: "mastered", versionId: "v1" });
  assert.deepEqual(await flagAffectedLearners(f.documentId, KEY, "v2", "تحديث"), ["b7-rerun"]);
  await flagAffectedLearners(f.documentId, KEY, "v2", "تحديث");
  const [{ n }] = await testDb()<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM notifications WHERE learner_id = 'b7-rerun'`;
  assert.equal(n, 1);
  assert.deepEqual(await mastery("b7-rerun", f.documentId), { state: "needs_refresh", version_id: "v2" });
});
