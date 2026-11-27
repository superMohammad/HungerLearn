import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { LessonPayload, QuestionPayload, Role } from "../src/lib/types";

/**
 * Isolated synthetic training for the F05 row: one published procedure per role. Seeding is allowed only
 * in a disposable database: on GitHub Actions (CI=true and GITHUB_ACTIONS=true, a fresh service container per job), or locally when
 * HL_DISPOSABLE_DB names the database the test is connected to (create it, migrate, seed, start the app
 * against it, see docs/feature-map.md F05). Every run uses its own ids and deletes only the rows it inserted;
 * rows of an interrupted run stay until the throwaway database is dropped (there is deliberately no sweep).
 * Nothing is answered, so no attempts or mastery rows are written.
 */
export const PREFIX = "e2e-f05-";
const VERSION = "v1";
const PROC = "proc-1";

export type Fixture = { role: Role; documentId: string; procedureKey: string };

type Question = { kind: "practice" | "exam"; payload: QuestionPayload };

function q(format: QuestionPayload["format"], prompt: string, scene: string | null): QuestionPayload {
  const options =
    format === "checklist"
      ? [
          { text: "تأكد من ختم الكيس", correct: true, misconception: null },
          { text: "سجّل وقت التجهيز", correct: true, misconception: null },
          { text: "سلّم الطلب بلا فاتورة", correct: false, misconception: "يظن أن الفاتورة اختيارية" },
          { text: "اترك المشروبات خارج الكيس", correct: false, misconception: "يظن أن الكيس للطعام فقط" },
        ]
      : [
          { text: "أبلغ الدعم فورًا", correct: true, misconception: null },
          { text: "انتظر دون إبلاغ", correct: false, misconception: "يظن أن الانتظار أفضل" },
          { text: "ألغِ الطلب", correct: false, misconception: "يظن أن الإلغاء من صلاحيته" },
        ];
  return {
    format, prompt, scene, options, correct_order: [], feedback: "راجع البند المذكور في الدليل.", confidence_tap: true,
    time_limit_seconds: format === "timed_decision" ? 20 : null,
  };
}

const LESSON: LessonPayload = {
  title: "التعامل مع تأخر الطلب",
  key_points: [
    { text: "إذا تأخر الطلب أكثر من ١٠ دقائق فأبلغ الدعم.", stable_id: "c1", quote: "أبلغ الدعم" },
    { text: "لا تلغِ الطلب بنفسك.", stable_id: "c2", quote: "لا تلغِ" },
  ],
  video: null,
};

/** Questions per role, in ordinal order. The preferred one is deliberately not first. */
const QUESTIONS: Record<Role, Question[]> = {
  courier: [
    { kind: "practice", payload: q("mcq", "الطلب تأخر ١٢ دقيقة في المطعم. ماذا تفعل؟", null) },
    { kind: "exam", payload: q("timed_decision", "تأخر الطلب. قرارك؟", null) },
  ],
  employee: [
    { kind: "practice", payload: q("mcq", "ما أول خطوة عند تأخر الطلب؟", null) },
    { kind: "practice", payload: q("mcq", "ماذا تفعل الآن؟", "اتصل عميل غاضب لأن طلبه تأخر ٢٥ دقيقة، والمندوب ما زال في المطعم.") },
    { kind: "exam", payload: q("spot_the_mistake", "أين الخطأ؟", "ألغى الموظف الطلب مباشرة دون الرجوع للدعم.") },
  ],
  partner: [
    { kind: "practice", payload: q("mcq", "متى يُسلَّم الطلب للمندوب؟", null) },
    { kind: "practice", payload: q("checklist", "ما الذي يجب قبل تسليم الطلب؟", null) },
    { kind: "exam", payload: q("checklist", "حدّد خطوات التسليم الصحيحة.", null) },
  ],
};

function connect(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set (web/.env.local or the environment).");
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Throws unless the connected database is disposable (see the module comment). */
async function assertDisposable(sql: postgres.Sql): Promise<void> {
  const [{ db }] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
  // GitHub Actions' web-e2e job runs a fresh Postgres service container; CI=true alone is set by many local tools.
  if (process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true") return;
  const named = process.env.HL_DISPOSABLE_DB;
  if (named !== undefined && named !== "" && named === db) return;
  throw new Error(
    `F05 seeds synthetic training only into a disposable database. Connected to "${db}"; run on GitHub Actions (CI) ` +
      `or HL_DISPOSABLE_DB="${db}" if this database is a throwaway copy (see docs/feature-map.md F05).`,
  );
}

/** The rows one run inserted, deleted again by id (children first). */
export type Fixtures = {
  byRole: Record<Role, Fixture>;
  documentIds: string[];
  procedureIds: string[];
  packageIds: string[];
  itemIds: string[];
};

export async function removeFixtures(created: Fixtures | undefined): Promise<void> {
  if (created === undefined) return;
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM lesson_videos WHERE item_id = ANY(${created.itemIds}::uuid[])`;
      await tx`DELETE FROM training_items WHERE id = ANY(${created.itemIds}::uuid[])`;
      await tx`DELETE FROM training_packages WHERE id = ANY(${created.packageIds}::uuid[])`;
      await tx`DELETE FROM procedures WHERE id = ANY(${created.procedureIds}::uuid[])`;
      await tx`DELETE FROM hl_documents WHERE document_id = ANY(${created.documentIds}::text[])`;
    });
  } finally {
    await sql.end();
  }
}

export async function createFixtures(): Promise<Fixtures> {
  const sql = connect();
  const run = randomUUID();
  const created: Fixtures = { byRole: {} as Record<Role, Fixture>, documentIds: [], procedureIds: [], packageIds: [], itemIds: [] };
  try {
    await assertDisposable(sql);
    await sql.begin(async (tx) => {
      for (const role of ["courier", "employee", "partner"] as const) {
        const documentId = `${PREFIX}${role}-${run}`;
        await tx`INSERT INTO hl_documents (document_id, title, role, partner_type, language, current_version_id)
                 VALUES (${documentId}, ${"دليل اختبار F05"}, ${role}, ${role === "partner" ? "restaurant" : null}, 'ar', ${VERSION})`;
        created.documentIds.push(documentId);
        const [proc] = await tx<{ id: string }[]>`
          INSERT INTO procedures (document_id, version_id, procedure_key, ordinal, title, steps, stable_ids)
          VALUES (${documentId}, ${VERSION}, ${PROC}, 1, ${"التعامل مع تأخر الطلب"}, ${tx.json(["أبلغ الدعم"])}, ${tx.json(["c1", "c2"])})
          RETURNING id`;
        created.procedureIds.push(proc.id);
        const [pkg] = await tx<{ id: string }[]>`
          INSERT INTO training_packages (procedure_id, document_id, version_id, procedure_key, role, language, status, flags, resource_requests, ideas)
          VALUES (${proc.id}, ${documentId}, ${VERSION}, ${PROC}, ${role}, 'ar', 'ok', '[]', '[]', '[]')
          RETURNING id`;
        created.packageIds.push(pkg.id);
        const items = [{ kind: "lesson" as const, payload: LESSON as unknown }, ...QUESTIONS[role]];
        for (const [ordinal, item] of items.entries()) {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO training_items (package_id, document_id, version_id, procedure_key, role, kind, ordinal, stable_id, quote, payload, status)
            VALUES (${pkg.id}, ${documentId}, ${VERSION}, ${PROC}, ${role}, ${item.kind}, ${ordinal}, 'c1', 'أبلغ الدعم', ${tx.json(item.payload as never)}, 'published')
            RETURNING id`;
          created.itemIds.push(row.id);
          // The courier lesson has a "ready" video so the phone layout can show it. No MP4 is rendered
          // on CI or teammate machines (GPU owner only), so the file itself is not served here.
          if (item.kind === "lesson" && role === "courier") {
            await tx`INSERT INTO lesson_videos (item_id, status, video_path) VALUES (${row.id}, 'ready', ${`/nonexistent/${documentId}.mp4`})`;
          }
        }
        created.byRole[role] = { role, documentId, procedureKey: PROC };
      }
    });
  } finally {
    await sql.end();
  }
  return created;
}
