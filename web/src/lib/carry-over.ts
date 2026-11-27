import type { Dict } from "@/lib/i18n";
import { reasonLabel } from "@/lib/reasons";
import type { Clause, ClauseStatus, ComparisonReport, Procedure, TrainingItem } from "@/lib/types";

/** Stage 6 decisions, kept pure so they are tested without a database. `pipeline.ts` applies them. */

/** Statuses whose clause text is the same on v2: only its place in the document may differ. */
const KEEP: ReadonlySet<ClauseStatus> = new Set(["unchanged", "moved"]);

export function clauseStatuses(report: ComparisonReport): Map<string, ClauseStatus> {
  return new Map(report.clauses.filter((c) => c.stable_id !== null).map((c) => [c.stable_id as string, c.status]));
}

/**
 * The v1 package carries over when every clause the procedure cited kept its text and none dropped
 * out. A clause the report does not mention counts as removed.
 */
export function carriesOver(old: Pick<Procedure, "stableIds">, next: Pick<Procedure, "stableIds">, status: ReadonlyMap<string, ClauseStatus>): boolean {
  return old.stableIds.every((s) => KEEP.has(status.get(s) ?? "removed")) && next.stableIds.length === old.stableIds.length;
}

/**
 * The clauses an item cites in its own version: a lesson's key points and shots, or a question's clause.
 * A carried item keeps its stable ids and gets the new version id, so its citation follows a moved clause.
 */
export function citedClauses(item: TrainingItem, clauses: readonly Clause[]): Clause[] {
  const ids = item.kind === "lesson"
    ? new Set([...item.payload.key_points.map((k) => k.stable_id), ...(item.payload.video?.shots ?? []).map((s) => s.stable_id)])
    : new Set([item.stableId]);
  return clauses.filter((c) => ids.has(c.stableId));
}

/** One line per clause whose text changed, for the learner's update notice. Moved clauses are not changes. */
export function changeLines(report: ComparisonReport, stableIds: ReadonlySet<string>, labels: Dict["reasons"]): string[] {
  return report.clauses
    .filter((c) => !KEEP.has(c.status) && c.stable_id !== null && stableIds.has(c.stable_id))
    .map((c) => {
      const text = (c.new ?? c.old)?.quote ?? "";
      const reasons = c.change_reasons.filter((r) => r !== "location changed").map((r) => reasonLabel(r, labels));
      return `• ${text.slice(0, 160)}${reasons.length > 0 ? ` (${reasons.join(labels.join)})` : ""}`;
    });
}

// ---------------------------------------------------------------- B7: the "What changed" lesson

export type ChangeKind = "changed" | "added" | "removed";
/** One clause whose text a learner must re-learn: old text (null when added) and new text (null when removed). */
export type ClauseChange = { stableId: string; change: ChangeKind; before: string | null; after: string | null; reasons: string[] };

/**
 * Net change of the procedure's clauses across consecutive comparisons (oldest first): the text in the
 * version the learner learned against the text now. Moved and unchanged clauses, and changes that were
 * undone by a later upload, are left out. A needs_review clause always counts as changed. A broken or
 * incomplete chain throws: a partial diff could hide a change.
 */
export function netChanges(hops: readonly ComparisonReport[], stableIds: ReadonlySet<string>): ClauseChange[] {
  if (hops.length === 0) throw new Error("no comparison to build the what-changed lesson from");
  hops.forEach((h, i) => {
    if (!h.complete) throw new Error(`the comparison for ${h.new_version_id} is incomplete; the what-changed lesson cannot be built`);
    const prev = hops[i - 1];
    if (prev !== undefined && h.old_version_id !== prev.new_version_id) {
      throw new Error(`comparison chain is broken: ${prev.new_version_id} is followed by a comparison from ${h.old_version_id} to ${h.new_version_id}`);
    }
  });
  type Track = { before: string | null; after: string | null; review: boolean; reasons: string[] };
  const tracks = new Map<string, Track>();
  hops.forEach((h, i) => {
    const seen = new Set<string>();
    for (const c of h.clauses) {
      if (c.stable_id === null || !stableIds.has(c.stable_id)) continue;
      seen.add(c.stable_id);
      const t = tracks.get(c.stable_id) ?? { before: i === 0 ? (c.old?.quote ?? null) : null, after: null, review: false, reasons: [] };
      t.after = c.new?.quote ?? null;
      t.review ||= c.status === "needs_review";
      if (!KEEP.has(c.status)) t.reasons.push(...c.change_reasons.filter((r) => r !== "location changed"));
      tracks.set(c.stable_id, t);
    }
    // A clause a report does not mention counts as removed (the same rule as carriesOver).
    for (const [id, t] of tracks) if (!seen.has(id)) t.after = null;
  });
  const changes: ClauseChange[] = [];
  for (const [stableId, t] of tracks) {
    if (t.before === null && t.after === null) continue;
    if (t.before === null) changes.push({ stableId, change: "added", before: null, after: t.after, reasons: [] });
    else if (t.after === null) changes.push({ stableId, change: "removed", before: t.before, after: null, reasons: [] });
    else if (t.before !== t.after || t.review) changes.push({ stableId, change: "changed", before: t.before, after: t.after, reasons: [...new Set(t.reasons)] });
  }
  return changes;
}
