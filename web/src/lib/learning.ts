import "server-only";
import { composeQuestion, lessonScreen, nextStep, type ScreenSpec } from "@/lib/compose";
import { sql } from "@/lib/db";
import { gradeAgainstKey, type Answer } from "@/lib/question-rules";
import { getItem, getLessonVideo, getProcedureByKey, listPublishedItems } from "@/lib/repo";
import type { Confidence, HlDocument, Learner, LessonItem, MasteryState, QuestionItem, QuestionPayload } from "@/lib/types";

export type ProcedureProgress = { documentId: string; documentTitle: string; procedureKey: string; title: string; state: MasteryState };

/** Procedures with published training for the learner's role, in the current version of each document. */
export async function learnerProgress(learner: Learner): Promise<ProcedureProgress[]> {
  const rows = await sql()<{ document_id: string; document_title: string; procedure_key: string; title: string; state: MasteryState | null }[]>`
    SELECT d.document_id, d.title AS document_title, p.procedure_key, p.title, m.state
    FROM hl_documents d
    JOIN procedures p ON p.document_id = d.document_id AND p.version_id = d.current_version_id
    LEFT JOIN mastery m ON m.learner_id = ${learner.learnerId} AND m.document_id = d.document_id AND m.procedure_key = p.procedure_key
    WHERE d.role = ${learner.role}
      AND EXISTS (SELECT 1 FROM training_items i WHERE i.document_id = p.document_id AND i.version_id = p.version_id
                    AND i.procedure_key = p.procedure_key AND i.status = 'published')
    ORDER BY d.created_at, p.ordinal`;
  return rows.map((r) => ({ documentId: r.document_id, documentTitle: r.document_title, procedureKey: r.procedure_key, title: r.title, state: r.state ?? "not_started" }));
}

export type LearnScreen = { kind: "screen"; spec: ScreenSpec; title: string } | { kind: "mastered"; title: string } | { kind: "empty"; title: string };

/**
 * Composes the learner's next screen for one procedure. Mode "lesson" shows the lesson; "questions"
 * goes straight to practice/exam; "auto" starts with the lesson until the learner has answered once.
 */
export type ScreenMode = "auto" | "lesson" | "questions";

export async function nextScreen(learner: Learner, doc: HlDocument, procedureKey: string, mode: ScreenMode): Promise<LearnScreen> {
  if (doc.currentVersionId === null) throw new Error(`Document ${doc.documentId} has no current version`);
  const versionId = doc.currentVersionId;
  const [procedure, items, attempts] = await Promise.all([
    getProcedureByKey(doc.documentId, versionId, procedureKey),
    listPublishedItems(doc.documentId, versionId, procedureKey),
    sql()<{ item_id: string; correct: boolean; at: number }[]>`
      SELECT item_id, correct, (extract(epoch FROM created_at) * 1000)::bigint::float8 AS at FROM attempts
      WHERE learner_id = ${learner.learnerId} AND document_id = ${doc.documentId} AND version_id = ${versionId}
        AND procedure_key = ${procedureKey}`,
  ]);
  const lesson = items.find((i): i is LessonItem => i.kind === "lesson");
  const questions = items.filter((i): i is QuestionItem => i.kind !== "lesson");
  if (lesson === undefined && questions.length === 0) return { kind: "empty", title: procedure.title };
  const video = lesson === undefined ? null : await getLessonVideo(lesson.id);
  const lessonSpec = lesson === undefined ? null : lessonScreen(lesson.payload, video !== null && video.status === "ready" ? `/api/media/${video.itemId}` : null, doc.role === "courier");
  if (lessonSpec !== null && (mode === "lesson" || (mode === "auto" && attempts.length === 0))) return { kind: "screen", spec: lessonSpec, title: procedure.title };

  const step = nextStep(
    questions.filter((q) => q.kind === "practice").map((q) => q.id),
    questions.filter((q) => q.kind === "exam").map((q) => q.id),
    attempts.map((a) => ({ itemId: a.item_id, correct: a.correct, at: a.at })),
  );
  if (step.kind === "mastered") return { kind: "mastered", title: procedure.title };
  const q = questions.find((x) => x.id === step.itemId) as QuestionItem;
  const fallback = lessonSpec ?? { kind: "lesson" as const, title: procedure.title, keyPoints: procedure.steps.length > 0 ? procedure.steps : [procedure.title], videoUrl: null, orientation: "landscape" as const };
  return { kind: "screen", spec: composeQuestion(q.id, step.kind, q.payload, fallback), title: procedure.title };
}

export type AnswerResult = { correct: boolean; feedback: string; quote: string; correctAnswer: string; state: MasteryState };

function correctAnswerText(q: QuestionPayload): string {
  if (q.format === "order_steps") return q.correct_order.join(" ← ");
  return q.options.filter((o) => o.correct).map((o) => o.text).join("، ");
}

async function loadQuestion(learner: Learner, itemId: string): Promise<QuestionItem> {
  const rows = await sql()<{ status: string; role: string; kind: string }[]>`SELECT status, role, kind FROM training_items WHERE id = ${itemId}`;
  if (rows.length === 0) throw new Error(`Unknown training item id=${itemId}`);
  if (rows[0].kind === "lesson") throw new Error(`Item ${itemId} is a lesson, not a question`);
  if (rows[0].status !== "published") throw new Error(`Question ${itemId} is not published (status=${rows[0].status})`);
  if (rows[0].role !== learner.role) throw new Error(`Question ${itemId} is for role ${rows[0].role}, learner is ${learner.role}`);
  return (await getItem(itemId)) as QuestionItem;
}

/** Stores the attempt and updates mastery: mastered once every exam item's latest attempt is correct. */
async function record(learner: Learner, q: QuestionItem, answer: unknown, confidence: Confidence, correct: boolean): Promise<MasteryState> {
  await sql()`
    INSERT INTO attempts (learner_id, item_id, document_id, version_id, procedure_key, kind, format, answer, confidence, correct)
    VALUES (${learner.learnerId}, ${q.id}, ${q.documentId}, ${q.versionId}, ${q.procedureKey}, ${q.kind}, ${q.payload.format},
            ${sql().json(answer as never)}, ${confidence}, ${correct})`;
  const [row] = await sql()<{ exams: number; passed: number }[]>`
    SELECT COUNT(*)::int AS exams,
           COUNT(*) FILTER (WHERE (SELECT a.correct FROM attempts a WHERE a.item_id = i.id AND a.learner_id = ${learner.learnerId}
                                   ORDER BY a.created_at DESC LIMIT 1))::int AS passed
    FROM training_items i
    WHERE i.document_id = ${q.documentId} AND i.version_id = ${q.versionId} AND i.procedure_key = ${q.procedureKey}
      AND i.kind = 'exam' AND i.status = 'published'`;
  const state: MasteryState = row.exams > 0 && row.passed === row.exams ? "mastered" : "in_progress";
  await sql()`
    INSERT INTO mastery (learner_id, document_id, procedure_key, version_id, state)
    VALUES (${learner.learnerId}, ${q.documentId}, ${q.procedureKey}, ${q.versionId}, ${state})
    ON CONFLICT (learner_id, document_id, procedure_key) DO UPDATE
      SET version_id = EXCLUDED.version_id, state = EXCLUDED.state, updated_at = now()`;
  return state;
}

/** Mastery check: graded against the approved answer key, never by an LLM. */
export async function gradeAnswer(learner: Learner, itemId: string, answer: Answer, confidence: Confidence): Promise<AnswerResult> {
  const q = await loadQuestion(learner, itemId);
  const correct = gradeAgainstKey(q.payload, answer);
  const state = await record(learner, q, answer, confidence, correct);
  return { correct, feedback: q.payload.feedback, quote: q.quote, correctAnswer: correctAnswerText(q.payload), state };
}

export type Notification = { id: number; documentId: string; versionId: string; message: string; createdAt: Date };

export async function listNotifications(learnerId: string): Promise<Notification[]> {
  const rows = await sql()<{ id: number; document_id: string; version_id: string; message: string; created_at: Date }[]>`
    SELECT id, document_id, version_id, message, created_at FROM notifications WHERE learner_id = ${learnerId} ORDER BY created_at DESC LIMIT 5`;
  return rows.map((r) => ({ id: r.id, documentId: r.document_id, versionId: r.version_id, message: r.message, createdAt: r.created_at }));
}
