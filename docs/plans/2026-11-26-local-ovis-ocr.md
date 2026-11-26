# Local OvisOCR3 for scans (app and eval)

**Tier:** Enhanced · **Owner:** GPU machine (RTX 3090) · **Branch:** `feat/local-ovis-ocr`

**Approved:** Mohammad Almalke, 2026-11-26 (plan approved in the Claude Code session before implementation)

## Problem
A scanned PDF or photo uploaded in the web app yields 0 clauses: `docproc process` runs with
`ocr=json_import` and no JSON, i.e. `NullOCR`. `docproc eval` skips all three dev scans. Demo
moment 1 ("upload an Arabic scan") depends on this.

## Approach
1. Run the existing `OvisOCR` adapter (`DOCPROC_OCR=ovis`, extra `.[ovis]`) on the 3090; fix the
   loader only where the installed `transformers` breaks it. An OCR failure stays an `ocr_failed`
   issue and never crashes a run.
2. `docproc eval` scores scans when the configured OCR engine is `ovis`; otherwise it skips them
   with a reason that says how to enable OCR.
3. Machines without OCR (teammates): the web upload job error names the `ocr_failed` pages and how
   to enable OCR, instead of a generic "0 clauses".

## Acceptance criteria
- `docproc process` on `courier-pickup-wait-v1-scan-ar.pdf` and `employee-delayed-order-v1-scan-en.png`
  stores clauses from OCR text.
- `docproc eval --real` scores the 3 dev scans; the 9 originals do not regress.
- Unit tests: scan skip depends on the OCR engine; the web 0-clause error names the OCR issue.
- `verify-app F03` with a scan upload, Arabic and English.

## Out of scope
Held-out run, teammates' lanes, any change to the Colab JSON path.

## Rollback
Revert the branch; set `DOCPROC_OCR=json_import` in `-/docproc/.env`.
