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
