/** Pure static gate for LLM-generated SQL (the database role is the second gate). */

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|set|reset|lock|vacuum|analyze|comment|execute|prepare|listen|notify)\b|pg_|;\s*\S/i;

/** Static gate before the database's own gate: one SELECT over readiness_v only. */
export function checkReadonlySql(query: string): string {
  const q = query.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(q)) throw new Error(`Rejected generated SQL (not a SELECT): ${q}`);
  if (FORBIDDEN.test(q)) throw new Error(`Rejected generated SQL (forbidden keyword or multiple statements): ${q}`);
  const tables = [...q.matchAll(/\b(?:from|join)\s+([a-z_."]+)/gi)].map((m) => m[1].replaceAll('"', "").toLowerCase());
  const foreign = tables.filter((t) => t !== "readiness_v" && t !== "public.readiness_v");
  if (foreign.length > 0) throw new Error(`Rejected generated SQL (only readiness_v is allowed, got ${foreign.join(", ")}): ${q}`);
  return q;
}
