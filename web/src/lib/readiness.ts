import "server-only";
import { z } from "zod";
import { generateStructured } from "@/lib/ai";
import { readonlySql, sql } from "@/lib/db";
import { checkReadonlySql } from "@/lib/sql-guard";
import type { MasteryState, Role } from "@/lib/types";

export type ReadinessRow = {
  learnerId: string;
  name: string;
  role: Role;
  branch: string;
  documentId: string;
  procedureKey: string;
  procedureTitle: string;
  state: MasteryState;
  /** Answers given with "sure" that were wrong: the highest-risk signal. */
  confidentWrong: number;
};

export type ReadinessFilter = { role: Role | null; branch: string | null; learnerId: string | null };

export async function readinessRows(filter: ReadinessFilter): Promise<ReadinessRow[]> {
  const rows = await sql()<{
    learner_id: string; name: string; role: Role; branch: string; document_id: string; procedure_key: string;
    procedure_title: string; state: MasteryState; confident_wrong: number;
  }[]>`
    SELECT learner_id, name, role, branch, document_id, procedure_key, procedure_title, state, confident_wrong
    FROM readiness_v
    WHERE (${filter.role}::text IS NULL OR role = ${filter.role})
      AND (${filter.branch}::text IS NULL OR branch = ${filter.branch})
      AND (${filter.learnerId}::text IS NULL OR learner_id = ${filter.learnerId})
    ORDER BY confident_wrong DESC, procedure_title, branch, name`;
  return rows.map((r) => ({
    learnerId: r.learner_id, name: r.name, role: r.role, branch: r.branch, documentId: r.document_id, procedureKey: r.procedure_key,
    procedureTitle: r.procedure_title, state: r.state, confidentWrong: r.confident_wrong,
  }));
}

export type ProcedureReadiness = { procedureKey: string; title: string; mastered: number; total: number };
export type BranchReadiness = { branch: string; mastered: number; total: number };

/** Pure aggregation: % mastered per procedure and per branch. */
export function summarize(rows: ReadinessRow[]): { procedures: ProcedureReadiness[]; branches: BranchReadiness[] } {
  const procedures = new Map<string, ProcedureReadiness>();
  const branches = new Map<string, BranchReadiness>();
  for (const r of rows) {
    const p = procedures.get(r.procedureKey) ?? { procedureKey: r.procedureKey, title: r.procedureTitle, mastered: 0, total: 0 };
    const b = branches.get(r.branch) ?? { branch: r.branch, mastered: 0, total: 0 };
    const mastered = r.state === "mastered" ? 1 : 0;
    procedures.set(r.procedureKey, { ...p, mastered: p.mastered + mastered, total: p.total + 1 });
    branches.set(r.branch, { ...b, mastered: b.mastered + mastered, total: b.total + 1 });
  }
  return { procedures: [...procedures.values()], branches: [...branches.values()] };
}

// ---------------------------------------------------------------- ask in plain Arabic

const PROMPT_VERSION = "ask-v1";
const MAX_ROWS = 50;
const SqlSchema = z.object({ sql: z.string(), answer_intro: z.string() });

const VIEW_DOC = `View readiness_v (one row per learner × trained procedure of their role):
  learner_id text, name text, role text ('courier'|'partner'|'employee'), branch text,
  document_id text, procedure_key text, procedure_title text,
  state text ('not_started'|'in_progress'|'mastered'|'needs_refresh'),
  confident_wrong int (answers marked "sure" that were wrong: highest risk), updated_at timestamptz`;

export type AskResult = { question: string; sql: string; intro: string; columns: string[]; rows: string[][] };

/**
 * LLM → SQL over the read-only view, executed as `hl_readonly` inside a READ ONLY transaction.
 * The AI can never change data: the role has SELECT on one view and nothing else.
 */
export async function askReadiness(question: string): Promise<AskResult> {
  const draft = await generateStructured({
    purpose: "readiness.text_to_sql",
    promptVersion: PROMPT_VERSION,
    // About learners, not a document: no scope.
    scope: null,
    schema: SqlSchema,
    system: `You translate a supervisor's question (Arabic or English) into one PostgreSQL SELECT.
${VIEW_DOC}
Rules: query only readiness_v; one SELECT statement; no semicolons; LIMIT ${MAX_ROWS} at most.
"Mastered/أتقن/اجتاز" means state = 'mastered'; "has not mastered/لم يتقن/لم يجتز" means state <> 'mastered'.
Match procedure names with ILIKE on procedure_title or document_id using the key word(s) from the question.
Always include name and branch when listing people.
answer_intro: one short sentence in the question's language introducing the result.`,
    prompt: question,
  });
  const query = checkReadonlySql(draft.sql);
  const rows = await readonlySql().begin("read only", async (tx) => tx.unsafe(query));
  const records = rows as unknown as Record<string, string | number | boolean | Date | null>[];
  const columns = records.length > 0 ? Object.keys(records[0]) : [];
  return {
    question,
    sql: query,
    intro: draft.answer_intro,
    columns,
    rows: records.slice(0, MAX_ROWS).map((r) => columns.map((c) => (r[c] === null ? "—" : r[c] instanceof Date ? (r[c] as Date).toISOString().slice(0, 10) : String(r[c])))),
  };
}
