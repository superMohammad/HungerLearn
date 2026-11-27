/**
 * The latest attempt is deterministic when two attempts share created_at (B5): ties are broken by id,
 * in both the next-screen query (listAttempts) and the mastery check (masteryState).
 * Run: TEST_DATABASE_URL=postgresql://<superuser>@host:port/<db> pnpm test:db
 * Each run creates a fresh database on that server and drops it afterwards; the app database is never touched.
 * A run killed mid-way can leave an hl_test_* database behind; drop it by hand.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { nextStep } from "@/lib/compose";
import { sql } from "@/lib/db";
import { listAttempts, masteryState } from "@/lib/learning";

const WEB = path.resolve(import.meta.dirname, "..", "..");
const REPO = path.resolve(WEB, "..");

const adminUrl = process.env.TEST_DATABASE_URL;
if (adminUrl === undefined || adminUrl === "") {
  throw new Error("Set TEST_DATABASE_URL to a Postgres superuser URL (a fresh database is created and dropped on that server)");
}
const dbName = `hl_test_${randomBytes(6).toString("hex")}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

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
  const migrate = spawnSync(process.execPath, [path.join(WEB, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/migrate.mts"], {
    cwd: WEB,
    env: { ...process.env, DATABASE_URL: testUrl },
    encoding: "utf8",
  });
  assert.equal(migrate.status, 0, `pnpm db:migrate failed:\n${migrate.stdout}\n${migrate.stderr}`);
  Object.assign(process.env, {
    DATABASE_URL: testUrl,
    READONLY_DATABASE_URL: "postgresql://unused@127.0.0.1:1/unused",
    LLM_BASE_URL: "http://127.0.0.1:1/v1",
    LLM_MODEL: "unused-model",
    LLM_API_KEY: "unused",
    LLM_REASONING_EFFORT: "none",
    LLM_PRICES_USD_PER_MTOK: JSON.stringify({ "unused-model": { input: 0, output: 0 } }),
    DOCPROC_DIR: "unused",
    DOCPROC_BIN: "unused",
    MEDIA_DIR: path.join(REPO, "media"),
    MEDIA_BIN: "unused",
    MEDIA_OUT_DIR: "unused",
    UPLOAD_DIR: "unused",
    TRAINING_PROMPT_PATH: path.join(REPO, "hunger-learn-training-generator-prompt.md"),
    OLLAMA_URL: "unused",
    DEMO_PASSWORD: "test-password",
  });
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

const DOC = "courier-pickup-wait", VERSION = "v1";

/** One published mcq exam item for a fresh procedure and learner, plus a shared created_at for the attempts. */
async function fixture(procedureKey: string, learnerId: string): Promise<{ itemId: string; insert: (correct: boolean, id?: number) => Promise<string> }> {
  const t = testDb();
  await t`INSERT INTO hl_documents (document_id, title, role, language, current_version_id)
          VALUES (${DOC}, 'انتظار الاستلام', 'courier', 'ar', ${VERSION}) ON CONFLICT DO NOTHING`;
  const [proc] = await t<{ id: string }[]>`
    INSERT INTO procedures (document_id, version_id, procedure_key, ordinal, title, steps, stable_ids)
    VALUES (${DOC}, ${VERSION}, ${procedureKey}, 1, 'تأخر التجهيز', '[]'::jsonb, '["CW-02"]'::jsonb) RETURNING id`;
  const [pkg] = await t<{ id: string }[]>`
    INSERT INTO training_packages (procedure_id, document_id, version_id, procedure_key, role, language, status, flags, resource_requests, ideas)
    VALUES (${proc.id}, ${DOC}, ${VERSION}, ${procedureKey}, 'courier', 'ar', 'ok', '[]', '[]', '[]') RETURNING id`;
  const [item] = await t<{ id: string }[]>`
    INSERT INTO training_items (package_id, document_id, version_id, procedure_key, role, kind, ordinal, stable_id, quote, payload, status)
    VALUES (${pkg.id}, ${DOC}, ${VERSION}, ${procedureKey}, 'courier', 'exam', 1, 'CW-02', 'q', '{"format":"mcq"}'::jsonb, 'published') RETURNING id`;
  await t`INSERT INTO learners (learner_id, name, role, branch, language, device) VALUES (${learnerId}, ${learnerId}, 'courier', 'riyadh', 'ar', 'phone')`;
  const [{ at }] = await t<{ at: Date }[]>`SELECT now() AS at`;
  const insert = async (correct: boolean, id?: number): Promise<string> => {
    const [row] = await t<{ id: string }[]>`
      INSERT INTO attempts (id, learner_id, item_id, document_id, version_id, procedure_key, kind, format, answer, confidence, correct, created_at)
      VALUES (COALESCE(${id ?? null}::bigint, nextval('attempts_id_seq')), ${learnerId}, ${item.id}, ${DOC}, ${VERSION}, ${procedureKey},
              'exam', 'mcq', '{}'::jsonb, 'sure', ${correct}, ${at}) RETURNING id::text`;
    return row.id;
  };
  return { itemId: item.id, insert };
}

test("listAttempts: two attempts with the same created_at come back in id order (the higher id is the latest)", async () => {
  const { itemId, insert } = await fixture("tie-list", "verify-tie-list");
  // The later attempt (higher id) is stored first, so heap and index order disagree with id order.
  await insert(false, 1000002);
  await insert(true, 1000001);
  const attempts = await listAttempts("verify-tie-list", DOC, VERSION, "tie-list");
  assert.deepEqual(attempts.map((a) => a.correct), [true, false]);
  assert.equal(attempts[0].at, attempts[1].at);
  assert.deepEqual(nextStep([], [{ id: itemId, format: "mcq" }], attempts), { kind: "exam", itemId });
});

test("masteryState: with a created_at tie the higher id decides, matching listAttempts", async () => {
  // Without the id tie-break the engine keeps whichever tied row it reads first or last. Two physical
  // orders, both with the wrong answer as the higher id, make the test fail for either preference.
  const inIdOrder = await fixture("tie-mastery-a", "verify-tie-mastery-a");
  await inIdOrder.insert(true, 2000001);
  await inIdOrder.insert(false, 2000002);
  const higherIdFirst = await fixture("tie-mastery-b", "verify-tie-mastery-b");
  await higherIdFirst.insert(false, 3000002);
  await higherIdFirst.insert(true, 3000001);
  assert.equal(await masteryState("verify-tie-mastery-a", DOC, VERSION, "tie-mastery-a"), "in_progress");
  assert.equal(await masteryState("verify-tie-mastery-b", DOC, VERSION, "tie-mastery-b"), "in_progress");
});
