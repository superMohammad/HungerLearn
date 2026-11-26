/** Pure helpers over the extraction issues docproc stores per version (`document_versions.issues`). */
import { z } from "zod";

/** docproc's `ExtractionIssue.kind` (-/docproc/src/docproc/models.py). */
const ISSUE_KINDS = [
  "page_failed", "ocr_failed", "invalid_extraction", "quote_not_found", "quote_fuzzy_matched",
  "audience_evidence_missing", "llm_error", "duplicate_hash", "reading_order_repaired",
] as const;

const DocprocIssueSchema = z.object({
  kind: z.enum(ISSUE_KINDS),
  page: z.number().int().nullish().transform((p) => p ?? null),
  detail: z.string(),
});

export type DocprocIssue = z.output<typeof DocprocIssueSchema>;

/** Validates the JSONB `issues` column (null when docproc recorded none). Throws on a shape docproc does not write. */
export function parseDocprocIssues(raw: unknown): DocprocIssue[] {
  return raw === null ? [] : z.array(DocprocIssueSchema).parse(raw);
}

/** docproc's NullOCR detail (pinned by -/docproc/tests/test_ocr_adapter.py): no OCR engine is configured. */
const NO_OCR_ENGINE = "OCR not configured";
const MAX_LISTED = 5;
const MAX_DETAIL = 100;

function shorten(detail: string): string {
  return detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL - 1)}…` : detail;
}

function describeIssues(issues: DocprocIssue[]): string {
  const listed = issues.slice(0, MAX_LISTED).map((i) => `${i.kind} page ${i.page ?? "?"}: ${shorten(i.detail)}`).join("; ");
  return issues.length > MAX_LISTED ? `${listed}; +${issues.length - MAX_LISTED} more` : listed;
}

/**
 * The upload job error when docproc stored no clauses (a raw technical message, shown LTR to admins).
 * A scan on a machine without an OCR engine is the common cause, so that case says how to enable one
 * (and still lists any other issues); a failure of a configured engine lists each page's detail instead.
 */
export function zeroClausesError(issues: DocprocIssue[]): string {
  const ocr = issues.filter((i) => i.kind === "ocr_failed");
  if (ocr.length > 0 && ocr.every((i) => i.detail.includes(NO_OCR_ENGINE))) {
    const others = issues.filter((i) => i.kind !== "ocr_failed");
    return (
      `docproc extracted 0 clauses: no OCR engine for pages ${ocr.map((i) => i.page ?? "?").join(", ")}. ` +
      "Scans need a live OCR engine: set DOCPROC_OCR=ovis for docproc (its .env or environment) on a GPU machine, " +
      "or process the file with OCR JSON from colab/ovis_ocr_runner (docproc process --ocr-json)." +
      (others.length > 0 ? ` Other issues: ${describeIssues(others)}` : "")
    );
  }
  if (ocr.length > 0) return `docproc extracted 0 clauses: OCR failed (${describeIssues(ocr)})`;
  if (issues.length === 0) return "docproc extracted 0 clauses and recorded no issues; check the file content";
  return `docproc extracted 0 clauses; issues: ${describeIssues(issues)}`;
}
