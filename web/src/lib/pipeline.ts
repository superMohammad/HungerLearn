import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { carriesOver, changeLines, clauseStatuses } from "@/lib/carry-over";
import { getComparison, listClauses, listVersionIssues, runDocproc } from "@/lib/docproc";
import { zeroClausesError } from "@/lib/docproc-issues";
import { buildPackage, groupProcedures, nameProcedure } from "@/lib/generation";
import { flagAffectedLearners } from "@/lib/learning";
import { copyLessonVideo, queueLessonVideo } from "@/lib/media";
import { initialItemState } from "@/lib/publication-rules";
import { DICTIONARIES } from "@/lib/i18n";
import {
  getDocument,
  getProcedure,
  insertProcedure,
  latestPackages,
  listPackageItems,
  listProcedures,
  listVersionItems,
  setCurrentVersion,
  updateProcedureSteps,
} from "@/lib/repo";
import type { ComparisonReport, HlDocument, LessonPayload, Procedure, TrainingItem, TrainingPackage } from "@/lib/types";

const SYSTEM_ACTOR = "ai:pipeline";

async function withJob<T>(documentId: string, versionId: string, step: string, work: () => Promise<T>): Promise<T> {
  const [job] = await sql()<{ id: number }[]>`
    INSERT INTO pipeline_jobs (document_id, version_id, step, status) VALUES (${documentId}, ${versionId}, ${step}, 'running') RETURNING id`;
  try {
    const result = await work();
    await sql()`UPDATE pipeline_jobs SET status = 'done', finished_at = now() WHERE id = ${job.id}`;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql()`UPDATE pipeline_jobs SET status = 'failed', error = ${message.slice(0, 4000)}, finished_at = now() WHERE id = ${job.id}`;
    throw error;
  }
}

/** Recorded before the response is sent, so the document page polls from its first render. */
export async function recordQueued(documentId: string, versionId: string): Promise<number> {
  const [job] = await sql()<{ id: number }[]>`
    INSERT INTO pipeline_jobs (document_id, version_id, step, status) VALUES (${documentId}, ${versionId}, 'queued', 'running') RETURNING id`;
  return job.id;
}

// ---------------------------------------------------------------- stage 2: one package per procedure

/** Generates, verifies, and stores the training package of one procedure, then queues its video. */
export async function generatePackageFor(procedureId: string, reviewerFeedback: string): Promise<void> {
  const procedure = await getProcedure(procedureId);
  const doc = await getDocument(procedure.documentId);
  const clauses = await listClauses(doc.documentId, procedure.versionId);
  const pkg = await buildPackage(doc, procedure, clauses, reviewerFeedback);
  const [row] = await sql()<{ id: string }[]>`
    INSERT INTO training_packages (procedure_id, document_id, version_id, procedure_key, role, language, status, skip_reason,
                                   flags, resource_requests, ideas)
    VALUES (${procedure.id}, ${doc.documentId}, ${procedure.versionId}, ${procedure.procedureKey}, ${doc.role}, ${doc.language},
            ${pkg.status}, ${pkg.skipReason}, ${sql().json(pkg.flags)}, ${sql().json(pkg.resourceRequests)}, ${sql().json(pkg.ideas)})
    RETURNING id`;
  for (const item of pkg.items) {
    const { flags, status } = initialItemState(pkg.status, item.flags);
    const [inserted] = await sql()<{ id: string }[]>`
      INSERT INTO training_items (package_id, document_id, version_id, procedure_key, role, kind, ordinal, stable_id, quote,
                                  payload, status, flags, judge_reason)
      VALUES (${row.id}, ${doc.documentId}, ${procedure.versionId}, ${procedure.procedureKey}, ${doc.role}, ${item.kind},
              ${item.ordinal}, ${item.stableId}, ${item.quote}, ${sql().json(item.payload)}, ${status}, ${sql().json(flags)},
              ${item.judgeReason})
      RETURNING id`;
    await sql()`
      INSERT INTO item_events (item_id, actor, action, from_status, to_status, version_id, note)
      VALUES (${inserted.id}, 'ai:generator', 'generated', NULL, ${status}, ${procedure.versionId}, ${flags.join(",")})`;
    if (item.kind === "lesson") await queueLessonVideo(inserted.id, doc, item.payload as LessonPayload);
  }
}

/** Background wrapper used by the admin's per-procedure "generate" button. */
export async function runGeneration(procedureId: string, reviewerFeedback: string): Promise<void> {
  const procedure = await getProcedure(procedureId);
  await withJob(procedure.documentId, procedure.versionId, `generate:${procedure.title}`, () => generatePackageFor(procedureId, reviewerFeedback));
}

// ---------------------------------------------------------------- stage 6: carry over or regenerate per procedure

async function carryPackage(pkg: TrainingPackage, newProcedure: Procedure): Promise<void> {
  const [row] = await sql()<{ id: string }[]>`
    INSERT INTO training_packages (procedure_id, document_id, version_id, procedure_key, role, language, status, skip_reason,
                                   flags, resource_requests, ideas)
    SELECT ${newProcedure.id}, document_id, ${newProcedure.versionId}, procedure_key, role, language, status, skip_reason,
           flags, resource_requests, ideas
    FROM training_packages WHERE id = ${pkg.id}
    RETURNING id`;
  for (const item of await listPackageItems(pkg.id)) {
    if (item.status === "rejected" || item.status === "outdated") continue;
    const [copy] = await sql()<{ id: string }[]>`
      INSERT INTO training_items (package_id, document_id, version_id, procedure_key, role, kind, ordinal, stable_id, quote,
                                  payload, status, flags, judge_reason)
      SELECT ${row.id}, document_id, ${newProcedure.versionId}, procedure_key, role, kind, ordinal, stable_id, quote,
             payload, status, flags, judge_reason
      FROM training_items WHERE id = ${item.id}
      RETURNING id`;
    await sql()`
      INSERT INTO item_events (item_id, actor, action, from_status, to_status, version_id, note)
      VALUES (${copy.id}, ${SYSTEM_ACTOR}, 'carried_over', ${item.status}, ${item.status}, ${newProcedure.versionId},
              ${`procedure clauses unchanged or moved since ${item.versionId}: kept, zero AI cost`})`;
    if (item.kind === "lesson") await copyLessonVideo(item.id, copy.id);
  }
}

async function markOutdated(items: TrainingItem[], newVersionId: string): Promise<void> {
  for (const item of items) {
    if (item.status === "outdated" || item.status === "rejected") continue;
    await sql()`UPDATE training_items SET status = 'outdated', updated_at = now() WHERE id = ${item.id}`;
    await sql()`
      INSERT INTO item_events (item_id, actor, action, from_status, to_status, version_id, note)
      VALUES (${item.id}, ${SYSTEM_ACTOR}, 'superseded', ${item.status}, 'outdated', ${item.versionId}, ${`superseded by ${newVersionId}`})`;
  }
}

/** Procedures of the new version: old procedures keep their key; clauses nobody owns are grouped anew. */
async function carryProcedures(doc: HlDocument, oldVersionId: string, newVersionId: string): Promise<void> {
  const [oldProcedures, newClauses] = await Promise.all([listProcedures(doc.documentId, oldVersionId), listClauses(doc.documentId, newVersionId)]);
  const present = new Set(newClauses.map((c) => c.stableId));
  const owned = new Set<string>();
  let ordinal = 0;
  for (const p of oldProcedures) {
    const stableIds = p.stableIds.filter((s) => present.has(s));
    if (stableIds.length === 0) continue;
    stableIds.forEach((s) => owned.add(s));
    await insertProcedure({ documentId: doc.documentId, versionId: newVersionId, procedureKey: p.procedureKey, ordinal, title: p.title, steps: p.steps, stableIds });
    ordinal += 1;
  }
  const orphans = newClauses.filter((c) => !owned.has(c.stableId));
  if (orphans.length === 0) return;
  for (const draft of await groupProcedures(doc, newVersionId, orphans)) {
    await insertProcedure({ documentId: doc.documentId, versionId: newVersionId, procedureKey: randomUUID(), ordinal, ...draft });
    ordinal += 1;
  }
}

/**
 * carryProcedures copied every old procedure's steps. A procedure that does not carry over gets fresh steps from
 * its new clauses (its title stays, so learners and notices keep naming the same procedure). All of them are
 * refreshed before any package is generated, so a naming failure stops the update before it writes training.
 */
async function refreshChangedSteps(doc: HlDocument, newVersionId: string, changed: readonly { old: Procedure; next: Procedure }[]): Promise<void> {
  if (changed.length === 0) return;
  const clauses = await listClauses(doc.documentId, newVersionId);
  for (const { old, next } of changed) {
    const own = new Set(next.stableIds);
    try {
      const { steps } = await nameProcedure(doc, newVersionId, clauses.filter((c) => own.has(c.stableId)));
      await updateProcedureSteps(next.id, steps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
      throw new Error(`Could not refresh the steps of procedure "${old.title}" (${old.procedureKey}) for ${newVersionId}: ${message}${cause}`, { cause: error });
    }
  }
}

async function applyNewVersion(doc: HlDocument, oldVersionId: string, newVersionId: string, report: ComparisonReport): Promise<void> {
  await carryProcedures(doc, oldVersionId, newVersionId);
  const status = clauseStatuses(report);
  const [oldProcedures, newProcedures, oldPackages] = await Promise.all([
    listProcedures(doc.documentId, oldVersionId),
    listProcedures(doc.documentId, newVersionId),
    latestPackages(doc.documentId, oldVersionId),
  ]);
  const newByKey = new Map(newProcedures.map((p) => [p.procedureKey, p]));
  // Decided once, so the steps refresh and the regeneration below always agree on which procedures changed.
  const changed = new Set(oldProcedures.filter((old) => {
    const next = newByKey.get(old.procedureKey);
    return next !== undefined && !carriesOver(old, next, status);
  }).map((old) => old.procedureKey));
  await refreshChangedSteps(doc, newVersionId, oldProcedures.flatMap((old) => {
    const next = newByKey.get(old.procedureKey);
    return next !== undefined && changed.has(old.procedureKey) ? [{ old, next }] : [];
  }));
  for (const old of oldProcedures) {
    const pkg = oldPackages.get(old.id);
    const next = newByKey.get(old.procedureKey);
    if (pkg === undefined || next === undefined) continue;
    if (!changed.has(old.procedureKey)) {
      await carryPackage(pkg, next);
      continue;
    }
    await generatePackageFor(next.id, "");
    // Stored with the notification, so it is written in the document's language like the training itself.
    const labels = DICTIONARIES[doc.language].reasons;
    const lines = changeLines(report, new Set([...old.stableIds, ...next.stableIds]), labels);
    const message = `${labels.update(old.title, newVersionId)}\n${lines.join("\n")}`;
    await flagAffectedLearners(doc.documentId, old.procedureKey, newVersionId, message);
  }
  await markOutdated(await listVersionItems(doc.documentId, oldVersionId), newVersionId);
}

// ---------------------------------------------------------------- upload

/**
 * Background run after an upload: docproc (stage 1, plus the v1→v2 comparison), procedure grouping,
 * and for a new version the per-procedure carry-over or regeneration (stage 6). First versions wait
 * for the admin to generate training per procedure.
 */
export async function runUploadPipeline(documentId: string, versionId: string, filePath: string, queuedJobId: number): Promise<void> {
  await sql()`UPDATE pipeline_jobs SET status = 'done', finished_at = now() WHERE id = ${queuedJobId}`;
  const doc = await getDocument(documentId);
  const previousVersionId = doc.currentVersionId;
  await withJob(documentId, versionId, "understand", () => runDocproc(filePath, documentId, versionId));
  const clauses = await listClauses(documentId, versionId);
  if (clauses.length === 0) {
    await withJob(documentId, versionId, "understand", async () => {
      throw new Error(zeroClausesError(await listVersionIssues(documentId, versionId)));
    });
    return;
  }
  if (previousVersionId === null) {
    await withJob(documentId, versionId, "procedures", async () => {
      const drafts = await groupProcedures(doc, versionId, clauses);
      for (const [ordinal, d] of drafts.entries()) {
        await insertProcedure({ documentId, versionId, procedureKey: randomUUID(), ordinal, ...d });
      }
    });
  } else {
    const report = await getComparison(documentId, versionId);
    if (report === null) throw new Error(`docproc stored no comparison for ${documentId} ${versionId}`);
    await withJob(documentId, versionId, "update", () => applyNewVersion(doc, previousVersionId, versionId, report));
  }
  await setCurrentVersion(documentId, versionId);
}
