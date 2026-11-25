/** Pure: group clauses into procedures by the document's own structure (no LLM, full coverage by construction). */
import type { Clause } from "@/lib/types";

const DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

/**
 * Section key of a clause: the leading integer of its clause number ("2.1", "٢-٣", "2." → "2"),
 * else its heading, else the clause itself. Clauses sharing a section form one procedure.
 */
export function sectionKey(c: Clause): string {
  const number = (c.clauseNumber ?? "").replace(/[٠-٩]/g, (d) => DIGITS[d]);
  const root = /\d+/.exec(number);
  if (root !== null) return `n:${Number(root[0])}`;
  if (c.heading !== null && c.heading.trim() !== "") return `h:${c.heading.trim()}`;
  return `c:${c.stableId}`;
}

/** Groups in document order; every clause lands in exactly one group. */
export function groupBySection(clauses: Clause[]): Clause[][] {
  const groups = new Map<string, Clause[]>();
  for (const c of [...clauses].sort((a, b) => a.ordinal - b.ordinal)) {
    const key = sectionKey(c);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()];
}
