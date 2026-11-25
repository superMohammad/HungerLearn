import "server-only";
import { sql } from "@/lib/db";
import { listClauses } from "@/lib/docproc";
import { verifyEditedQuestion } from "@/lib/generation";
import { generatePackageFor } from "@/lib/pipeline";
import { getDocument, getItem, getPackage, listPackageItems } from "@/lib/repo";
import type { ItemStatus, QuestionPayload, TrainingItem } from "@/lib/types";

const REVIEWABLE: ItemStatus[] = ["draft", "verified", "approved"];

async function transition(item: TrainingItem, to: ItemStatus, actor: string, action: string, note: string): Promise<void> {
  await sql()`UPDATE training_items SET status = ${to}, updated_at = now() WHERE id = ${item.id}`;
  await sql()`
    INSERT INTO item_events (item_id, actor, action, from_status, to_status, version_id, note)
    VALUES (${item.id}, ${actor}, ${action}, ${item.status}, ${to}, ${item.versionId}, ${note})`;
}

function requireStatus(item: TrainingItem, allowed: ItemStatus[], action: string): void {
  if (!allowed.includes(item.status)) {
    throw new Error(`Cannot ${action} item ${item.id}: status is ${item.status}, expected one of ${allowed.join(", ")}`);
  }
}

export async function approveItem(itemId: string, actor: string): Promise<void> {
  const item = await getItem(itemId);
  requireStatus(item, ["draft", "verified"], "approve");
  await transition(item, "approved", actor, "approve", item.flags.length > 0 ? `approved despite flags: ${item.flags.join(",")}` : "");
}

/** Approves every reviewable item of a package (the reviewer has seen the whole package). */
export async function approvePackage(packageId: string, actor: string): Promise<void> {
  for (const item of await listPackageItems(packageId)) {
    if (item.status === "draft" || item.status === "verified") {
      await transition(item, "approved", actor, "approve_package", item.flags.length > 0 ? `approved despite flags: ${item.flags.join(",")}` : "");
    }
  }
}

/** Reject sends the package back to Stage 2: its items are rejected and a new package is generated with the reason. */
export async function rejectPackage(packageId: string, actor: string, reason: string): Promise<void> {
  const pkg = await getPackage(packageId);
  for (const item of await listPackageItems(packageId)) {
    if (REVIEWABLE.includes(item.status)) await transition(item, "rejected", actor, "reject", reason);
  }
  await generatePackageFor(pkg.procedureId, reason === "" ? "rejected by the reviewer" : reason);
}

/** A human edit (prompt, feedback, option texts) is re-checked by the same gate before approval. */
export async function editQuestion(itemId: string, actor: string, edit: { prompt: string; feedback: string; optionTexts: string[] }): Promise<void> {
  const item = await getItem(itemId);
  requireStatus(item, REVIEWABLE, "edit");
  if (item.kind === "lesson") throw new Error(`Item ${itemId} is a lesson; only questions are editable`);
  if (edit.optionTexts.length !== item.payload.options.length) {
    throw new Error(`Edit has ${edit.optionTexts.length} options, question ${itemId} has ${item.payload.options.length}`);
  }
  const payload: QuestionPayload = {
    ...item.payload,
    prompt: edit.prompt,
    feedback: edit.feedback,
    options: item.payload.options.map((o, i) => ({ ...o, text: edit.optionTexts[i] })),
  };
  const [doc, clauses] = await Promise.all([getDocument(item.documentId), listClauses(item.documentId, item.versionId)]);
  const clause = clauses.find((c) => c.stableId === item.stableId);
  if (clause === undefined) throw new Error(`Clause ${item.stableId} not found in ${item.documentId} ${item.versionId}`);
  const verdict = await verifyEditedQuestion(doc, payload, item.quote, clause);
  await sql()`
    UPDATE training_items SET payload = ${sql().json(payload)}, flags = ${sql().json(verdict.flags)}, judge_reason = ${verdict.judgeReason},
           updated_at = now()
    WHERE id = ${itemId}`;
  await transition(item, verdict.flags.length === 0 ? "verified" : "draft", actor, "edit", verdict.flags.join(","));
}

/** Publishes every approved item of a document version. Learners only ever see published items. */
/**
 * Publishes every approved item of a version. A procedure that gets a newly approved package has its
 * previously published items retired first (status outdated), so learners only ever see one package.
 */
export async function publishApproved(documentId: string, versionId: string, actor: string): Promise<number> {
  const retired = await sql()<{ id: string }[]>`
    UPDATE training_items SET status = 'outdated', updated_at = now()
    WHERE document_id = ${documentId} AND version_id = ${versionId} AND status = 'published'
      AND procedure_key IN (SELECT procedure_key FROM training_items
                            WHERE document_id = ${documentId} AND version_id = ${versionId} AND status = 'approved')
    RETURNING id`;
  for (const row of retired) {
    await sql()`
      INSERT INTO item_events (item_id, actor, action, from_status, to_status, version_id, note)
      VALUES (${row.id}, ${actor}, 'retire', 'published', 'outdated', ${versionId}, 'replaced by a newly approved package')`;
  }
  const rows = await sql()<{ id: string }[]>`
    UPDATE training_items SET status = 'published', updated_at = now()
    WHERE document_id = ${documentId} AND version_id = ${versionId} AND status = 'approved'
    RETURNING id`;
  for (const row of rows) {
    await sql()`
      INSERT INTO item_events (item_id, actor, action, from_status, to_status, version_id, note)
      VALUES (${row.id}, ${actor}, 'publish', 'approved', 'published', ${versionId}, '')`;
  }
  return rows.length;
}
