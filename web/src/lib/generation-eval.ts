/**
 * Generation eval (A2a, plan docs/plans/2026-11-27-generation-eval.md): loads the dev originals' gold
 * clauses and scores what the app's real generation code produced for them. Pure: no DB, no LLM, no
 * server-only, so `pnpm test` covers it. The run itself is web/scripts/eval-generation.mts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ResolvedItem } from "@/lib/generation";
import { initialItemState } from "@/lib/publication-rules";
import { foldDigits, quoteInClause } from "@/lib/text";
import type { Clause, HlDocument, ItemStatus, LessonPayload, PackageStatus } from "@/lib/types";

// ---------------------------------------------------------------- dataset (dev originals only)

const ManifestSchema = z.object({
  documents: z.array(
    z.object({
      document_id: z.string(),
      split: z.string(),
      variant: z.string(),
      path: z.string(),
      version: z.number().int(),
      language: z.enum(["ar", "en"]),
      role: z.enum(["courier", "employee", "partner"]),
    }),
  ),
});
const GoldClauseSchema = z.object({
  clause_id: z.string(),
  quote: z.string(),
  locator: z.object({ section: z.string().optional(), page: z.number().optional() }).passthrough(),
});
type GoldClause = z.infer<typeof GoldClauseSchema>;
const GoldSchema = z.array(
  z.object({
    document_id: z.string(),
    title: z.string(),
    procedures: z.array(z.object({ procedure_id: z.string(), title: z.string(), clause_ids: z.array(z.string()) })),
    clauses: z.array(GoldClauseSchema),
  }),
);

export type Generation = "v1/v2" | "v3";
export type EvalDocument = {
  documentId: string;
  versionId: string;
  generation: Generation;
  doc: HlDocument;
  clauses: Clause[];
  goldProcedures: { procedure_id: string; clause_ids: string[] }[];
};

const SECTION_NUMBER = /[0-9٠-٩]+/;

/**
 * Gold clauses as the app would see them from docproc: the document's own text, its section as heading,
 * and the section's first number as clause number, so groupBySection forms the document's procedures.
 * Gold facts and labels are left out (statement ""), and the model only ever sees C1, C2… refs.
 */
export function goldClauses(clauses: GoldClause[]): Clause[] {
  return clauses.map((c, i) => {
    const section = c.locator.section ?? null;
    return {
      recordId: c.clause_id,
      stableId: c.clause_id,
      ordinal: i,
      quote: c.quote,
      statement: "",
      heading: section,
      clauseNumber: section === null ? null : (SECTION_NUMBER.exec(section)?.[0] ?? null),
      page: c.locator.page ?? null,
    };
  });
}

function generationOf(documentId: string, version: number): Generation {
  if (version === 1 || version === 2) return "v1/v2";
  if (version === 3) return "v3";
  throw new Error(`${documentId}: unexpected version ${version}`);
}

/**
 * The dev originals (`split == "dev"`, `variant == "original"`) with their gold clauses. Only
 * dev/gold/extraction.json is read; scans, format copies, translations and held_out are skipped.
 */
export async function loadDevOriginals(
  datasetDir: string,
  options: { only?: string[]; manifestOverride?: unknown } = {},
): Promise<EvalDocument[]> {
  const manifestJson: unknown = options.manifestOverride ?? JSON.parse(await readFile(path.join(datasetDir, "manifest.json"), "utf8"));
  const entries = ManifestSchema.parse(manifestJson).documents.filter((d) => d.split === "dev" && d.variant === "original");
  for (const e of entries) {
    if (!e.path.startsWith("dev/")) throw new Error(`${e.document_id}: path ${e.path} is outside dev/`);
  }
  const ids = new Set(entries.map((e) => e.document_id));
  for (const id of options.only ?? []) {
    if (!ids.has(id)) throw new Error(`not a dev original: ${id} (choose from ${[...ids].join(", ")})`);
  }
  const selected = options.only === undefined ? entries : entries.filter((e) => options.only?.includes(e.document_id));
  if (selected.length === 0) return [];
  const gold = new Map(
    GoldSchema.parse(JSON.parse(await readFile(path.join(datasetDir, "dev", "gold", "extraction.json"), "utf8"))).map((g) => [g.document_id, g]),
  );
  return selected.map((e) => {
    const g = gold.get(e.document_id);
    if (g === undefined) throw new Error(`${e.document_id}: no entry in dev/gold/extraction.json`);
    return {
      documentId: e.document_id,
      versionId: `v${e.version}`,
      generation: generationOf(e.document_id, e.version),
      doc: {
        documentId: e.document_id,
        title: g.title,
        role: e.role,
        partnerType: e.role === "partner" ? "restaurant" : null,
        language: e.language,
        currentVersionId: null,
      },
      clauses: goldClauses(g.clauses),
      goldProcedures: g.procedures.map((p) => ({ procedure_id: p.procedure_id, clause_ids: p.clause_ids })),
    };
  });
}

// ---------------------------------------------------------------- scoring

export type ProcedureOutcome = {
  procedureKey: string;
  title: string;
  clauses: Clause[];
  result: { kind: "package"; status: PackageStatus; items: ResolvedItem[] } | { kind: "error"; message: string };
};

export type Citation = {
  clause_id: string | null;
  quote: string;
  normalized: boolean;
  exact: boolean;
  /** The cited clause's text when the citation fails a check, so a reviewer can read why; null otherwise. */
  clause_text: string | null;
};

export type ScoredItem = {
  kind: ResolvedItem["kind"];
  ordinal: number;
  status: ItemStatus;
  flags: string[];
  citations: Citation[];
  /**
   * The app's flags, plus, for a quote that matches its clause only after the app's normalization:
   * quote_digits_differ when the printed digits are the difference (15 vs ١٥), else quote_not_exact
   * (punctuation, spacing, diacritics).
   */
  failed_checks: string[];
  /** Marked verified (no warning for the trainer) but failing a check. */
  silent_failure: boolean;
  /** Failing a check while canPublishWithFlags still lets a trainer approve and publish it. */
  publishable_with_failed_check: boolean;
  judge_reason: string;
};

export type ScoredProcedure = {
  procedure_key: string;
  title: string;
  clause_ids: string[];
  package_status: PackageStatus | null;
  error: string | null;
  items: ScoredItem[];
};

const DIGIT_RUN = /[0-9٠-٩۰-۹]+/g;
const DIGIT = /[0-9٠-٩۰-۹]/;

/** Whether the clause prints this number as a whole number (not inside a longer one: 15 is not in 150). */
function printsNumber(clauseQuote: string, run: string): boolean {
  for (let at = clauseQuote.indexOf(run); at >= 0; at = clauseQuote.indexOf(run, at + 1)) {
    if (!DIGIT.test(clauseQuote[at - 1] ?? "") && !DIGIT.test(clauseQuote[at + run.length] ?? "")) return true;
  }
  return false;
}

/**
 * The quote's printed digits differ from the clause's: the quote matches only once digits are folded
 * (15 against ١٥), or, when other characters differ too, one of its numbers is not printed as such.
 */
function digitsDiffer(quote: string, clauseQuote: string): boolean {
  if (exactInClause(foldDigits(quote), foldDigits(clauseQuote))) return true;
  return (quote.match(DIGIT_RUN) ?? []).some((run) => !printsNumber(clauseQuote, run));
}

/** Exact: the trimmed quote appears verbatim in the clause, so printed digits must match. */
function exactInClause(quote: string, clauseQuote: string): boolean {
  const q = quote.trim();
  return q.length >= 3 && clauseQuote.includes(q);
}

function citationsOf(item: ResolvedItem): { stableId: string | null; quote: string }[] {
  if (item.kind === "lesson") {
    const payload = item.payload as LessonPayload;
    const refs = [...payload.key_points, ...(payload.video?.shots ?? [])];
    return refs.map((r) => ({ stableId: r.stable_id === "unknown" ? null : r.stable_id, quote: r.quote }));
  }
  // A question with an unknown ref falls back to the procedure's first clause in buildPackage; it cites nothing.
  return [{ stableId: item.flags.includes("unknown_clause_ref") ? null : item.stableId, quote: item.quote }];
}

export function scoreProcedure(outcome: ProcedureOutcome, canPublish: (flags: readonly string[]) => boolean): ScoredProcedure {
  const base = { procedure_key: outcome.procedureKey, title: outcome.title, clause_ids: outcome.clauses.map((c) => c.stableId) };
  if (outcome.result.kind === "error") return { ...base, package_status: null, error: outcome.result.message, items: [] };
  const { status: packageStatus } = outcome.result;
  const byId = new Map(outcome.clauses.map((c) => [c.stableId, c]));
  const items = outcome.result.items.map((item): ScoredItem => {
    const state = initialItemState(packageStatus, item.flags);
    const citations = citationsOf(item).map(({ stableId, quote }): Citation => {
      const clause = stableId === null ? undefined : byId.get(stableId);
      const normalized = clause !== undefined && quoteInClause(quote, clause.quote);
      const exact = clause !== undefined && exactInClause(quote, clause.quote);
      return { clause_id: clause?.stableId ?? null, quote, normalized, exact, clause_text: exact ? null : (clause?.quote ?? null) };
    });
    // A citation that passes the app's check but not the exact one always has its clause text.
    const inexact = citations.flatMap((c) => (c.normalized && !c.exact && c.clause_text !== null ? [{ quote: c.quote, clause: c.clause_text }] : []));
    const digits = inexact.some((c) => digitsDiffer(c.quote, c.clause));
    const other = inexact.some((c) => !exactInClause(foldDigits(c.quote), foldDigits(c.clause)));
    const failed = [...state.flags, ...(digits ? ["quote_digits_differ"] : []), ...(other ? ["quote_not_exact"] : [])];
    return {
      kind: item.kind,
      ordinal: item.ordinal,
      status: state.status,
      flags: state.flags,
      citations,
      failed_checks: failed,
      silent_failure: state.status === "verified" && failed.length > 0,
      publishable_with_failed_check: failed.length > 0 && canPublish(state.flags),
      judge_reason: item.judgeReason,
    };
  });
  return { ...base, package_status: packageStatus, error: null, items };
}

export type Summary = {
  procedures: number;
  packages_skipped: number;
  procedures_failed: number;
  items: number;
  /** Share of items whose every citation passes (an item with no citation does not pass); null without items. */
  citation_accuracy: { normalized: number | null; exact: number | null };
  citations: { total: number; normalized_pass: number; exact_pass: number };
  items_with_failed_check: number;
  silent_failures: number;
  /** Silent failures by failed check (quote_digits_differ, quote_not_exact, …); an item can count under several. */
  silent_failures_by_check: Record<string, number>;
  publishable_with_failed_check: number;
  /** Items per failed check, over every item with a failed check. */
  failed_check_counts: Record<string, number>;
};

function countChecks(items: ScoredItem[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const check of items.flatMap((i) => i.failed_checks)) counts.set(check, (counts.get(check) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

export function summarize(procedures: ScoredProcedure[]): Summary {
  const items = procedures.flatMap((p) => p.items);
  const citations = items.flatMap((i) => i.citations);
  const passes = (i: ScoredItem, key: "normalized" | "exact"): boolean => i.citations.length > 0 && i.citations.every((c) => c[key]);
  return {
    procedures: procedures.length,
    packages_skipped: procedures.filter((p) => p.package_status === "skipped").length,
    procedures_failed: procedures.filter((p) => p.error !== null).length,
    items: items.length,
    citation_accuracy: {
      normalized: rate(items.filter((i) => passes(i, "normalized")).length, items.length),
      exact: rate(items.filter((i) => passes(i, "exact")).length, items.length),
    },
    citations: {
      total: citations.length,
      normalized_pass: citations.filter((c) => c.normalized).length,
      exact_pass: citations.filter((c) => c.exact).length,
    },
    items_with_failed_check: items.filter((i) => i.failed_checks.length > 0).length,
    silent_failures: items.filter((i) => i.silent_failure).length,
    silent_failures_by_check: countChecks(items.filter((i) => i.silent_failure)),
    publishable_with_failed_check: items.filter((i) => i.publishable_with_failed_check).length,
    failed_check_counts: countChecks(items),
  };
}

// ---------------------------------------------------------------- report

export type DocumentResult = {
  document: EvalDocument;
  procedures: ScoredProcedure[];
  /** A failure before any package (e.g. procedure naming), recorded instead of dropping the document. */
  error: string | null;
  tokens: { calls: number; input: number; output: number };
};

function groupSummary<K extends string>(docs: DocumentResult[], key: (d: DocumentResult) => K): Record<K, Summary> {
  const groups = new Map<K, ScoredProcedure[]>();
  for (const d of docs) groups.set(key(d), [...(groups.get(key(d)) ?? []), ...d.procedures]);
  return Object.fromEntries([...groups].map(([k, procs]) => [k, summarize(procs)])) as Record<K, Summary>;
}

export function buildReport(run: Record<string, unknown>, docs: DocumentResult[]) {
  return {
    run,
    totals: { ...summarize(docs.flatMap((d) => d.procedures)), documents: docs.length, documents_failed: docs.filter((d) => d.error !== null).length },
    by_generation: groupSummary(docs, (d) => d.document.generation),
    by_language: groupSummary(docs, (d) => d.document.doc.language),
    by_role: groupSummary(docs, (d) => d.document.doc.role),
    documents: docs.map((d) => ({
      document_id: d.document.documentId,
      version_id: d.document.versionId,
      generation: d.document.generation,
      language: d.document.doc.language,
      role: d.document.doc.role,
      error: d.error,
      tokens: d.tokens,
      summary: summarize(d.procedures),
      procedures: d.procedures,
    })),
  };
}
