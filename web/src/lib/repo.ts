import "server-only";
import { sql } from "@/lib/db";
import {
  LessonPayloadSchema,
  QuestionPayloadSchema,
  type HlDocument,
  type ItemKind,
  type ItemStatus,
  type Language,
  type Learner,
  type LessonVideo,
  type PackageFlag,
  type PackageStatus,
  type PartnerType,
  type Procedure,
  type ResourceRequest,
  type Role,
  type TrainingItem,
  type TrainingPackage,
  type VideoStatus,
} from "@/lib/types";

// ---------------------------------------------------------------- documents

type DocumentRow = { document_id: string; title: string; role: Role; partner_type: PartnerType | null; language: Language; current_version_id: string | null };

function toDocument(r: DocumentRow): HlDocument {
  return { documentId: r.document_id, title: r.title, role: r.role, partnerType: r.partner_type, language: r.language, currentVersionId: r.current_version_id };
}

export async function getDocument(documentId: string): Promise<HlDocument> {
  const rows = await sql()<DocumentRow[]>`
    SELECT document_id, title, role, partner_type, language, current_version_id FROM hl_documents WHERE document_id = ${documentId}`;
  if (rows.length === 0) throw new Error(`Unknown document_id=${documentId}`);
  return toDocument(rows[0]);
}

export async function upsertDocument(doc: Omit<HlDocument, "currentVersionId">): Promise<void> {
  await sql()`
    INSERT INTO hl_documents (document_id, title, role, partner_type, language)
    VALUES (${doc.documentId}, ${doc.title}, ${doc.role}, ${doc.partnerType}, ${doc.language})
    ON CONFLICT (document_id) DO UPDATE SET title = EXCLUDED.title`;
}

export async function setCurrentVersion(documentId: string, versionId: string): Promise<void> {
  await sql()`UPDATE hl_documents SET current_version_id = ${versionId} WHERE document_id = ${documentId}`;
}

export async function nextVersionId(documentId: string): Promise<string> {
  const [row] = await sql()<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM document_versions WHERE document_id = ${documentId}`;
  return `v${row.n + 1}`;
}

// ---------------------------------------------------------------- procedures

type ProcedureRow = { id: string; document_id: string; version_id: string; procedure_key: string; ordinal: number; title: string; steps: string[]; stable_ids: string[] };

function toProcedure(r: ProcedureRow): Procedure {
  return { id: r.id, documentId: r.document_id, versionId: r.version_id, procedureKey: r.procedure_key, ordinal: r.ordinal, title: r.title, steps: r.steps, stableIds: r.stable_ids };
}

export async function listProcedures(documentId: string, versionId: string): Promise<Procedure[]> {
  const rows = await sql()<ProcedureRow[]>`
    SELECT id, document_id, version_id, procedure_key, ordinal, title, steps, stable_ids FROM procedures
    WHERE document_id = ${documentId} AND version_id = ${versionId} ORDER BY ordinal`;
  return rows.map(toProcedure);
}

export async function getProcedure(procedureId: string): Promise<Procedure> {
  const rows = await sql()<ProcedureRow[]>`
    SELECT id, document_id, version_id, procedure_key, ordinal, title, steps, stable_ids FROM procedures WHERE id = ${procedureId}`;
  if (rows.length === 0) throw new Error(`Unknown procedure id=${procedureId}`);
  return toProcedure(rows[0]);
}

export async function getProcedureByKey(documentId: string, versionId: string, procedureKey: string): Promise<Procedure> {
  const rows = await sql()<ProcedureRow[]>`
    SELECT id, document_id, version_id, procedure_key, ordinal, title, steps, stable_ids FROM procedures
    WHERE document_id = ${documentId} AND version_id = ${versionId} AND procedure_key = ${procedureKey}`;
  if (rows.length === 0) throw new Error(`Unknown procedure ${procedureKey} in ${documentId} ${versionId}`);
  return toProcedure(rows[0]);
}

export async function insertProcedure(p: Omit<Procedure, "id">): Promise<string> {
  const [row] = await sql()<{ id: string }[]>`
    INSERT INTO procedures (document_id, version_id, procedure_key, ordinal, title, steps, stable_ids)
    VALUES (${p.documentId}, ${p.versionId}, ${p.procedureKey}, ${p.ordinal}, ${p.title}, ${sql().json(p.steps)}, ${sql().json(p.stableIds)})
    RETURNING id`;
  return row.id;
}

export async function updateProcedureSteps(procedureId: string, steps: string[]): Promise<void> {
  const rows = await sql()`UPDATE procedures SET steps = ${sql().json(steps)} WHERE id = ${procedureId} RETURNING id`;
  if (rows.length === 0) throw new Error(`Unknown procedure id=${procedureId}`);
}

// ---------------------------------------------------------------- packages

type PackageRow = {
  id: string; procedure_id: string; procedure_key: string; document_id: string; version_id: string; status: PackageStatus;
  skip_reason: string | null; flags: PackageFlag[]; resource_requests: ResourceRequest[]; ideas: string[]; created_at: Date;
};

function toPackage(r: PackageRow): TrainingPackage {
  return {
    id: r.id, procedureId: r.procedure_id, procedureKey: r.procedure_key, documentId: r.document_id, versionId: r.version_id,
    status: r.status, skipReason: r.skip_reason, flags: r.flags, resourceRequests: r.resource_requests, ideas: r.ideas, createdAt: r.created_at,
  };
}

/** The newest package of each procedure in a version (older ones were rejected and regenerated). */
export async function latestPackages(documentId: string, versionId: string): Promise<Map<string, TrainingPackage>> {
  const rows = await sql()<PackageRow[]>`
    SELECT DISTINCT ON (procedure_id) id, procedure_id, procedure_key, document_id, version_id, status, skip_reason, flags,
           resource_requests, ideas, created_at
    FROM training_packages WHERE document_id = ${documentId} AND version_id = ${versionId}
    ORDER BY procedure_id, created_at DESC`;
  return new Map(rows.map((r) => [r.procedure_id, toPackage(r)]));
}

export async function getPackage(packageId: string): Promise<TrainingPackage> {
  const rows = await sql()<PackageRow[]>`
    SELECT id, procedure_id, procedure_key, document_id, version_id, status, skip_reason, flags, resource_requests, ideas, created_at
    FROM training_packages WHERE id = ${packageId}`;
  if (rows.length === 0) throw new Error(`Unknown training package id=${packageId}`);
  return toPackage(rows[0]);
}

// ---------------------------------------------------------------- items

type ItemRow = {
  id: string; package_id: string; document_id: string; version_id: string; procedure_key: string; role: Role; kind: ItemKind;
  ordinal: number; stable_id: string; quote: string; payload: unknown; status: ItemStatus; flags: string[]; judge_reason: string; updated_at: Date;
};

const ITEM_COLUMNS =
  "id, package_id, document_id, version_id, procedure_key, role, kind, ordinal, stable_id, quote, payload, status, flags, judge_reason, updated_at";

function toItem(r: ItemRow): TrainingItem {
  const base = {
    id: r.id, packageId: r.package_id, documentId: r.document_id, versionId: r.version_id, procedureKey: r.procedure_key,
    role: r.role, ordinal: r.ordinal, stableId: r.stable_id, quote: r.quote, status: r.status, flags: r.flags,
    judgeReason: r.judge_reason, updatedAt: r.updated_at,
  };
  return r.kind === "lesson"
    ? { ...base, kind: "lesson", payload: LessonPayloadSchema.parse(r.payload) }
    : { ...base, kind: r.kind, payload: QuestionPayloadSchema.parse(r.payload) };
}

const KIND_ORDER = "CASE kind WHEN 'lesson' THEN 0 WHEN 'practice' THEN 1 ELSE 2 END";

export async function listPackageItems(packageId: string): Promise<TrainingItem[]> {
  const rows = await sql().unsafe<ItemRow[]>(
    `SELECT ${ITEM_COLUMNS} FROM training_items WHERE package_id = $1 ORDER BY ${KIND_ORDER}, ordinal`, [packageId]);
  return rows.map(toItem);
}

export async function listVersionItems(documentId: string, versionId: string): Promise<TrainingItem[]> {
  const rows = await sql().unsafe<ItemRow[]>(
    `SELECT ${ITEM_COLUMNS} FROM training_items WHERE document_id = $1 AND version_id = $2 ORDER BY procedure_key, ${KIND_ORDER}, ordinal`,
    [documentId, versionId]);
  return rows.map(toItem);
}

export async function getItem(itemId: string): Promise<TrainingItem> {
  const rows = await sql().unsafe<ItemRow[]>(`SELECT ${ITEM_COLUMNS} FROM training_items WHERE id = $1`, [itemId]);
  if (rows.length === 0) throw new Error(`Unknown training item id=${itemId}`);
  return toItem(rows[0]);
}

/** Review queue: items of current versions waiting for a human, flagged (⚠) first. */
export async function listReviewQueue(): Promise<TrainingItem[]> {
  const rows = await sql().unsafe<ItemRow[]>(
    `SELECT ${ITEM_COLUMNS.split(", ").map((c) => `i.${c}`).join(", ")}
     FROM training_items i
     JOIN hl_documents d ON d.document_id = i.document_id AND d.current_version_id = i.version_id
     WHERE i.status IN ('draft', 'verified', 'approved')
     ORDER BY (jsonb_array_length(i.flags) > 0) DESC, i.status = 'approved', i.procedure_key,
              CASE i.kind WHEN 'lesson' THEN 0 WHEN 'practice' THEN 1 ELSE 2 END, i.ordinal`);
  return rows.map(toItem);
}

export async function listPublishedItems(documentId: string, versionId: string, procedureKey: string): Promise<TrainingItem[]> {
  const rows = await sql().unsafe<ItemRow[]>(
    `SELECT ${ITEM_COLUMNS} FROM training_items
     WHERE document_id = $1 AND version_id = $2 AND procedure_key = $3 AND status = 'published'
     ORDER BY ${KIND_ORDER}, ordinal`, [documentId, versionId, procedureKey]);
  return rows.map(toItem);
}

export type ItemEvent = { actor: string; action: string; fromStatus: string | null; toStatus: string; versionId: string; note: string; createdAt: Date };

export async function listItemEvents(itemId: string): Promise<ItemEvent[]> {
  const rows = await sql()<{ actor: string; action: string; from_status: string | null; to_status: string; version_id: string; note: string; created_at: Date }[]>`
    SELECT actor, action, from_status, to_status, version_id, note, created_at FROM item_events WHERE item_id = ${itemId} ORDER BY created_at`;
  return rows.map((r) => ({ actor: r.actor, action: r.action, fromStatus: r.from_status, toStatus: r.to_status, versionId: r.version_id, note: r.note, createdAt: r.created_at }));
}

// ---------------------------------------------------------------- videos

export async function getLessonVideo(itemId: string): Promise<LessonVideo | null> {
  const rows = await sql()<{ item_id: string; status: VideoStatus; video_path: string | null; error: string; age: number }[]>`
    SELECT item_id, status, video_path, error, extract(epoch FROM now() - updated_at)::float8 AS age
    FROM lesson_videos WHERE item_id = ${itemId}`;
  if (rows.length === 0) return null;
  const r = rows[0];
  return { itemId: r.item_id, status: r.status, videoPath: r.video_path, error: r.error, secondsSinceUpdate: r.age };
}

// ---------------------------------------------------------------- learners

type LearnerRow = { learner_id: string; name: string; role: Role; branch: string; language: Language; device: Learner["device"] };

function toLearner(r: LearnerRow): Learner {
  return { learnerId: r.learner_id, name: r.name, role: r.role, branch: r.branch, language: r.language, device: r.device };
}

export async function listLearners(): Promise<Learner[]> {
  const rows = await sql()<LearnerRow[]>`SELECT learner_id, name, role, branch, language, device FROM learners ORDER BY learner_id`;
  return rows.map(toLearner);
}

export async function getLearner(learnerId: string): Promise<Learner> {
  const rows = await sql()<LearnerRow[]>`SELECT learner_id, name, role, branch, language, device FROM learners WHERE learner_id = ${learnerId}`;
  if (rows.length === 0) throw new Error(`Unknown learner_id=${learnerId}`);
  return toLearner(rows[0]);
}

// ---------------------------------------------------------------- jobs

export type PipelineJob = { id: number; versionId: string; step: string; status: "running" | "done" | "failed"; error: string; startedAt: Date };

export async function listJobs(documentId: string): Promise<PipelineJob[]> {
  const rows = await sql()<{ id: number; version_id: string; step: string; status: PipelineJob["status"]; error: string; started_at: Date }[]>`
    SELECT id, version_id, step, status, error, started_at FROM pipeline_jobs WHERE document_id = ${documentId} ORDER BY id DESC LIMIT 20`;
  return rows.map((r) => ({ id: r.id, versionId: r.version_id, step: r.step, status: r.status, error: r.error, startedAt: r.started_at }));
}

export async function hasRunningJob(documentId: string): Promise<boolean> {
  const [row] = await sql()<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM pipeline_jobs WHERE document_id = ${documentId} AND status = 'running'`;
  return row.n > 0;
}
