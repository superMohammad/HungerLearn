import "server-only";
import { netChanges } from "@/lib/carry-over";
import { composeQuestion, lessonScreen, nextStep, whatChangedScreen, type AttemptLite, type ScreenSpec, type WhatChangedScreen } from "@/lib/compose";
import { sql } from "@/lib/db";
import { getComparison, getComparisonChain } from "@/lib/docproc";
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

/**
 * A learner's attempts on one procedure version, oldest first. Ties on created_at are broken by id
 * (insert order), so the latest attempt is deterministic; nextStep's stable sort keeps this order.
 */
export async function listAttempts(learnerId: string, documentId: string, versionId: string, procedureKey: string): Promise<AttemptLite[]> {
  const rows = await sql()<{ item_id: string; correct: boolean; at: number }[]>`
    SELECT item_id, correct, (extract(epoch FROM created_at) * 1000)::bigint::float8 AS at FROM attempts
    WHERE learner_id = ${learnerId} AND document_id = ${documentId} AND version_id = ${versionId}
      AND procedure_key = ${procedureKey}
    ORDER BY created_at, id`;
  return rows.map((r) => ({ itemId: r.item_id, correct: r.correct, at: r.at }));
}

/** `refreshing`: the learner's badge is being re-checked after a new upload (mastery state needs_refresh). */
export type LearnScreen =
  | { kind: "screen"; spec: ScreenSpec; title: string; refreshing: boolean }
  | { kind: "mastered"; title: string }
  | { kind: "empty"; title: string };

/**
 * Composes the learner's next screen for one procedure. Mode "lesson" shows the lesson; "questions"
 * goes straight to practice/exam; "auto" starts with the lesson until the learner has answered once.
 * Mode "changes" shows the "What changed" lesson while the learner's badge is being re-checked.
 * For a learner in needs_refresh, "auto" starts with "What changed" until their first answer on the
 * current version (B7): every in-app path to the new exam goes through it.
 */
export type ScreenMode = "auto" | "lesson" | "questions" | "changes";

async function storedMastery(learnerId: string, documentId: string, procedureKey: string): Promise<{ state: MasteryState; versionId: string } | null> {
  const rows = await sql()<{ state: MasteryState; version_id: string }[]>`
    SELECT state, version_id FROM mastery WHERE learner_id = ${learnerId} AND document_id = ${documentId} AND procedure_key = ${procedureKey}`;
  return rows.length === 0 ? null : { state: rows[0].state, versionId: rows[0].version_id };
}

/**
 * The "What changed" lesson for a learner whose refresh started at `refreshVersionId` (the upload that
 * changed the procedure; mastery.version_id keeps it until they pass). It covers every upload since the
 * version they learned, so a learner who skipped an upload sees the net change. Null when nothing is left
 * to re-learn (e.g. a later upload undid the change).
 */
async function whatChanged(doc: HlDocument, procedureKey: string, title: string, refreshVersionId: string, currentVersionId: string): Promise<WhatChangedScreen | null> {
  const start = await getComparison(doc.documentId, refreshVersionId);
  if (start === null) throw new Error(`docproc stored no comparison for ${doc.documentId} ${refreshVersionId}`);
  if (start.old_version_id === null) throw new Error(`the comparison for ${doc.documentId} ${refreshVersionId} has no previous version`);
  const learned = start.old_version_id;
  const chain = await getComparisonChain(doc.documentId, learned, currentVersionId);
  const versions = [learned, ...chain.map((r) => r.new_version_id)];
  const rows = await sql()<{ stable_ids: string[] }[]>`
    SELECT stable_ids FROM procedures WHERE document_id = ${doc.documentId} AND procedure_key = ${procedureKey} AND version_id IN ${sql()(versions)}`;
  return whatChangedScreen(title, learned, currentVersionId, netChanges(chain, new Set(rows.flatMap((r) => r.stable_ids))));
}

export async function nextScreen(learner: Learner, doc: HlDocument, procedureKey: string, mode: ScreenMode): Promise<LearnScreen> {
  if (doc.currentVersionId === null) throw new Error(`Document ${doc.documentId} has no current version`);
  const versionId = doc.currentVersionId;
  const [procedure, items, attempts, stored] = await Promise.all([
    getProcedureByKey(doc.documentId, versionId, procedureKey),
    listPublishedItems(doc.documentId, versionId, procedureKey),
    listAttempts(learner.learnerId, doc.documentId, versionId, procedureKey),
    storedMastery(learner.learnerId, doc.documentId, procedureKey),
  ]);
  const lesson = items.find((i): i is LessonItem => i.kind === "lesson");
  const questions = items.filter((i): i is QuestionItem => i.kind !== "lesson");
  if (lesson === undefined && questions.length === 0) return { kind: "empty", title: procedure.title };
  const refreshing = stored?.state === "needs_refresh";
  if (refreshing && (mode === "changes" || (mode === "auto" && attempts.length === 0))) {
    const changes = await whatChanged(doc, procedureKey, procedure.title, stored.versionId, versionId);
    if (changes !== null) return { kind: "screen", spec: changes, title: procedure.title, refreshing };
  }
  const video = lesson === undefined ? null : await getLessonVideo(lesson.id);
  const lessonSpec = lesson === undefined ? null : lessonScreen(lesson.payload, video !== null && video.status === "ready" ? `/api/media/${video.itemId}` : null, doc.role === "courier");
  if (lessonSpec !== null && (mode === "lesson" || (mode === "auto" && attempts.length === 0))) return { kind: "screen", spec: lessonSpec, title: procedure.title, refreshing };

  const step = nextStep(
    questions.filter((q) => q.kind === "practice").map((q) => ({ id: q.id, format: q.payload.format })),
    questions.filter((q) => q.kind === "exam").map((q) => ({ id: q.id, format: q.payload.format })),
    attempts,
  );
  if (step.kind === "mastered") return { kind: "mastered", title: procedure.title };
  const q = questions.find((x) => x.id === step.itemId) as QuestionItem;
  const fallback = lessonSpec ?? { kind: "lesson" as const, title: procedure.title, keyPoints: procedure.steps.length > 0 ? procedure.steps : [procedure.title], videoUrl: null, orientation: "landscape" as const };
  return { kind: "screen", spec: composeQuestion(q.id, step.kind, q.payload, fallback), title: procedure.title, refreshing };
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

/**
 * Mastered once every published exam item's latest attempt is correct. "Latest" breaks created_at
 * ties by id, the same order as listAttempts, so the stored state matches the next screen.
 */
export async function masteryState(learnerId: string, documentId: string, versionId: string, procedureKey: string): Promise<MasteryState> {
  const [row] = await sql()<{ exams: number; passed: number }[]>`
    SELECT COUNT(*)::int AS exams,
           COUNT(*) FILTER (WHERE (SELECT a.correct FROM attempts a WHERE a.item_id = i.id AND a.learner_id = ${learnerId}
                                   ORDER BY a.created_at DESC, a.id DESC LIMIT 1))::int AS passed
    FROM training_items i
    WHERE i.document_id = ${documentId} AND i.version_id = ${versionId} AND i.procedure_key = ${procedureKey}
      AND i.kind = 'exam' AND i.status = 'published'`;
  return row.exams > 0 && row.passed === row.exams ? "mastered" : "in_progress";
}

/**
 * Stores the attempt and updates mastery: mastered once every exam item's latest attempt is correct.
 * A badge being re-checked (needs_refresh) stays so, at the version where the refresh started, until the
 * learner passes the current version's exam (B7).
 */
async function record(learner: Learner, q: QuestionItem, answer: unknown, confidence: Confidence, correct: boolean): Promise<MasteryState> {
  await sql()`
    INSERT INTO attempts (learner_id, item_id, document_id, version_id, procedure_key, kind, format, answer, confidence, correct)
    VALUES (${learner.learnerId}, ${q.id}, ${q.documentId}, ${q.versionId}, ${q.procedureKey}, ${q.kind}, ${q.payload.format},
            ${sql().json(answer as never)}, ${confidence}, ${correct})`;
  const state = await masteryState(learner.learnerId, q.documentId, q.versionId, q.procedureKey);
  const [stored] = await sql()<{ state: MasteryState }[]>`
    INSERT INTO mastery (learner_id, document_id, procedure_key, version_id, state)
    VALUES (${learner.learnerId}, ${q.documentId}, ${q.procedureKey}, ${q.versionId}, ${state})
    ON CONFLICT (learner_id, document_id, procedure_key) DO UPDATE
      SET version_id = CASE WHEN mastery.state = 'needs_refresh' AND EXCLUDED.state <> 'mastered' THEN mastery.version_id ELSE EXCLUDED.version_id END,
          state = CASE WHEN mastery.state = 'needs_refresh' AND EXCLUDED.state <> 'mastered' THEN 'needs_refresh' ELSE EXCLUDED.state END,
          updated_at = now()
    RETURNING state`;
  return stored.state;
}

/** Mastery check: graded against the approved answer key, never by an LLM. */
export async function gradeAnswer(learner: Learner, itemId: string, answer: Answer, confidence: Confidence): Promise<AnswerResult> {
  const q = await loadQuestion(learner, itemId);
  const correct = gradeAgainstKey(q.payload, answer);
  const state = await record(learner, q, answer, confidence, correct);
  return { correct, feedback: q.payload.feedback, quote: q.quote, correctAnswer: correctAnswerText(q.payload), state };
}

/**
 * Stage 6, a procedure changed on `newVersionId`: learners who had started or mastered it must re-learn the
 * change (needs_refresh, at this version) and are notified. Learners already in needs_refresh keep the
 * version where their refresh started, so their "What changed" lesson covers every upload they missed,
 * and are notified again. Returns the notified learner ids.
 */
export async function flagAffectedLearners(documentId: string, procedureKey: string, newVersionId: string, message: string): Promise<string[]> {
  const waiting = await sql()<{ learner_id: string }[]>`
    SELECT learner_id FROM mastery WHERE document_id = ${documentId} AND procedure_key = ${procedureKey} AND state = 'needs_refresh'`;
  const flagged = await sql()<{ learner_id: string }[]>`
    UPDATE mastery SET state = 'needs_refresh', version_id = ${newVersionId}, updated_at = now()
    WHERE document_id = ${documentId} AND procedure_key = ${procedureKey} AND state IN ('mastered', 'in_progress')
    RETURNING learner_id`;
  const learners = [...flagged, ...waiting].map((r) => r.learner_id);
  for (const learnerId of learners) {
    await sql()`INSERT INTO notifications (learner_id, document_id, version_id, message) VALUES (${learnerId}, ${documentId}, ${newVersionId}, ${message})`;
  }
  return learners;
}

export type Notification = { id: number; documentId: string; versionId: string; message: string; createdAt: Date };

export async function listNotifications(learnerId: string): Promise<Notification[]> {
  const rows = await sql()<{ id: number; document_id: string; version_id: string; message: string; created_at: Date }[]>`
    SELECT id, document_id, version_id, message, created_at FROM notifications WHERE learner_id = ${learnerId} ORDER BY created_at DESC LIMIT 5`;
  return rows.map((r) => ({ id: r.id, documentId: r.document_id, versionId: r.version_id, message: r.message, createdAt: r.created_at }));
}
