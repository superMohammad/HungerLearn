import "server-only";
import { sql } from "@/lib/db";
import type { CallRow, JobRow, PackageRow, VersionData } from "@/lib/cost-time";
import type { Language, Role } from "@/lib/types";

type Key = `${string}\u0000${string}`;
const key = (documentId: string, versionId: string): Key => `${documentId}\u0000${versionId}`;

function grouped<T>(rows: (T & { document_id: string; version_id: string })[]): Map<Key, T[]> {
  const out = new Map<Key, T[]>();
  for (const r of rows) out.set(key(r.document_id, r.version_id), [...(out.get(key(r.document_id, r.version_id)) ?? []), r]);
  return out;
}

/**
 * Every document version the pipeline has seen, with the rows cost-time.ts needs. Uses the app's normal
 * pool: ai_calls stays invisible to the read-only role, and only the admin scoreboard and the report read this.
 * Calls without a document (readiness text-to-SQL) are left out.
 */
export async function loadCostTimeData(): Promise<VersionData[]> {
  const db = sql();
  const [versions, calls, jobs, procedures, packages] = await Promise.all([
    db<{ document_id: string; version_id: string; role: Role; language: Language }[]>`
      SELECT v.document_id, v.version_id, d.role, d.language
      FROM (SELECT document_id, version_id FROM pipeline_jobs UNION SELECT document_id, version_id FROM procedures) v
      JOIN hl_documents d ON d.document_id = v.document_id
      ORDER BY v.document_id, v.version_id`,
    db<{ document_id: string; version_id: string; purpose: string; model: string; input_tokens: number; output_tokens: number }[]>`
      SELECT document_id, version_id, purpose, model, input_tokens, output_tokens
      FROM ai_calls WHERE document_id IS NOT NULL AND version_id IS NOT NULL ORDER BY id`,
    db<{ document_id: string; version_id: string; step: string; status: JobRow["status"]; started_at: Date; finished_at: Date | null }[]>`
      SELECT document_id, version_id, step, status, started_at, finished_at FROM pipeline_jobs ORDER BY id`,
    db<{ document_id: string; version_id: string; procedure_key: string }[]>`
      SELECT document_id, version_id, procedure_key FROM procedures ORDER BY ordinal`,
    db<{ document_id: string; version_id: string; procedure_key: string; created_at: Date; carried: boolean }[]>`
      SELECT p.document_id, p.version_id, p.procedure_key, p.created_at,
             EXISTS (SELECT 1 FROM training_items i JOIN item_events e ON e.item_id = i.id
                     WHERE i.package_id = p.id AND e.action = 'carried_over') AS carried
      FROM training_packages p ORDER BY p.created_at`,
  ]);
  const callsBy = grouped(calls);
  const jobsBy = grouped(jobs);
  const proceduresBy = grouped(procedures);
  const packagesBy = grouped(packages);
  return versions.map((v): VersionData => {
    const k = key(v.document_id, v.version_id);
    return {
      documentId: v.document_id,
      versionId: v.version_id,
      role: v.role,
      language: v.language,
      calls: (callsBy.get(k) ?? []).map((c): CallRow => ({ purpose: c.purpose, model: c.model, inputTokens: c.input_tokens, outputTokens: c.output_tokens })),
      jobs: (jobsBy.get(k) ?? []).map((j): JobRow => ({ step: j.step, status: j.status, startedAt: j.started_at, finishedAt: j.finished_at })),
      procedureKeys: (proceduresBy.get(k) ?? []).map((p) => p.procedure_key),
      packages: (packagesBy.get(k) ?? []).map((p): PackageRow => ({ procedureKey: p.procedure_key, createdAt: p.created_at, carried: p.carried })),
    };
  });
}
