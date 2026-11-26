import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sql } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import type { Clause, ClauseStatus } from "@/lib/types";

const run = promisify(execFile);
const PROCESS_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Stages 1 and 6 run in docproc (Python + LangGraph): parse → extract clauses with exact
 * quotes → hash + EmbeddingGemma 2 vectors → compare with the previous version.
 * Results land in the shared Postgres; this function only starts the run.
 */
export async function runDocproc(filePath: string, documentId: string, versionId: string): Promise<void> {
  const env = serverEnv();
  try {
    await run(env.docprocBin, ["process", filePath, "--doc", documentId, "--version", versionId], {
      cwd: env.docprocDir,
      timeout: PROCESS_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    throw new Error(
      `docproc process failed for document=${documentId} version=${versionId} file=${filePath}: ${stderr.slice(-1500)}`,
      { cause: error },
    );
  }
}

type ClauseRow = {
  record_id: string;
  stable_id: string;
  ordinal: number;
  quote: string;
  statement: string;
  heading: string | null;
  clause_number: string | null;
  page: number | null;
};

/**
 * Clauses of a version whose identity is settled. docproc writes `clause_versions` first and
 * assigns `stable_id` in its compare step, so rows still being processed are left out.
 */
export async function listClauses(documentId: string, versionId: string): Promise<Clause[]> {
  const rows = await sql()<ClauseRow[]>`
    SELECT record_id, stable_id, ordinal, quote, statement, heading, clause_number,
           (location->>'page')::int AS page
    FROM clause_versions
    WHERE document_id = ${documentId} AND version_id = ${versionId} AND stable_id IS NOT NULL
    ORDER BY ordinal`;
  return rows.map((r) => ({
    recordId: r.record_id,
    stableId: r.stable_id,
    ordinal: r.ordinal,
    quote: r.quote,
    statement: r.statement,
    heading: r.heading,
    clauseNumber: r.clause_number,
    page: r.page,
  }));
}

export type VersionSummary = { versionId: string; seq: number; sourceFile: string; createdAt: Date };

export async function listVersions(documentId: string): Promise<VersionSummary[]> {
  const rows = await sql()<{ version_id: string; seq: number; source_file: string; created_at: Date }[]>`
    SELECT version_id, seq, source_file, created_at FROM document_versions
    WHERE document_id = ${documentId} ORDER BY seq`;
  return rows.map((r) => ({ versionId: r.version_id, seq: r.seq, sourceFile: r.source_file, createdAt: r.created_at }));
}

type ReportSide = { quote: string; heading: string | null };
type ReportClause = {
  status: ClauseStatus;
  stable_id: string | null;
  old: ReportSide | null;
  new: ReportSide | null;
  change_reasons: string[];
};
export type ComparisonReport = {
  old_version_id: string | null;
  new_version_id: string;
  complete: boolean;
  summary: Record<ClauseStatus, number>;
  clauses: ReportClause[];
};

export async function getComparison(documentId: string, versionId: string): Promise<ComparisonReport | null> {
  const rows = await sql()<{ report: ComparisonReport }[]>`
    SELECT report FROM comparisons WHERE document_id = ${documentId} AND new_version_id = ${versionId}`;
  return rows.length === 0 ? null : rows[0].report;
}
