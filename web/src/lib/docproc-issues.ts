/** Pure helpers over the extraction issues docproc stores per version (`document_versions.issues`). */

export type DocprocIssue = { kind: string; page: number | null; detail: string };

/** docproc's NullOCR detail: no OCR engine is configured on this machine. */
const NO_OCR_ENGINE = "OCR not configured";
const MAX_LISTED = 5;

function describeIssues(issues: DocprocIssue[]): string {
  const listed = issues.slice(0, MAX_LISTED).map((i) => `${i.kind} page ${i.page ?? "?"}: ${i.detail}`).join("; ");
  return issues.length > MAX_LISTED ? `${listed}; +${issues.length - MAX_LISTED} more` : listed;
}

/**
 * The upload job error when docproc stored no clauses (a raw technical message, shown LTR to admins).
 * A scan on a machine without an OCR engine is the common cause, so that case says how to enable one;
 * a failure of a configured engine lists each page's detail instead.
 */
export function zeroClausesError(issues: DocprocIssue[]): string {
  const ocr = issues.filter((i) => i.kind === "ocr_failed");
  if (ocr.length > 0 && ocr.every((i) => i.detail.includes(NO_OCR_ENGINE))) {
    return (
      `docproc extracted 0 clauses: no OCR engine for pages ${ocr.map((i) => i.page ?? "?").join(", ")}. ` +
      "Scans need a live OCR engine: set DOCPROC_OCR=ovis in -/docproc/.env on a GPU machine, " +
      "or process the file with OCR JSON from colab/ovis_ocr_runner (docproc process --ocr-json)."
    );
  }
  if (ocr.length > 0) return `docproc extracted 0 clauses: OCR failed (${describeIssues(ocr)})`;
  if (issues.length === 0) return "docproc extracted 0 clauses and recorded no issues; check the file content";
  return `docproc extracted 0 clauses; issues: ${describeIssues(issues)}`;
}
