# HungerLearn synthetic SOP dataset

This corpus exercises SOP ingestion, role-specific rule extraction with citations, trainer approval, assessment and remedial practice, supervisor mastery views, and reassessment after a document update. All organizations, branches, identifiers, and policies are fictional. Each upload carries a synthetic-data notice in its source language.

## Corpus

| Role | Arabic | English | Dev | Held out | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Courier | 4 | 1 | 4 | 1 | 5 |
| Company employee | 1 | 4 | 4 | 1 | 5 |
| Partner restaurant staff | 4 | 1 | 4 | 1 | 5 |
| **Total** | **9** | **6** | **12** | **3** | **15** |

The uploads include three selectable-text PDFs, five DOCX files, four UTF-8 TXT files, two image-only PDFs, and one PNG. Each role has two independently authored dev v1 SOPs, one in Arabic and one in English. One of those families also has a v2 and a scan of its v1. Each role has one additional document family reserved for held-out evaluation.

Each upload contains 10 or 11 named procedures. Each procedure addresses a distinct operational situation and has its own source citation. All 15 files contain 156 procedure occurrences, including the matching occurrences in the scans and revisions.

## Files and labels

Upload files from the selected split’s `uploads/` directory. Use [manifest.json](manifest.json) to resolve document IDs, families, versions, formats, roles, organizations, branches, languages, procedure counts, and paths. Paths are relative to this dataset directory.

| File | What it tests |
| --- | --- |
| `{split}/gold/extraction.json` | Procedure and scope, clause-level source quotes, actionable facts, and citation locations. |
| `{split}/gold/retrieval.json` | Query text and language, applicable scope, expected clause occurrences, and plausible distractors. |
| `dev/gold/transcriptions/` | One complete reference per scanned page, including headers and table cells in reading order. |
| `dev/gold/assessments.json` | Two sample cases per role with correct actions, explanations, citations, and wrong answers that route to remedial practice. |
| `dev/gold/version_diffs.json` | Clause changes, before and after citations, training approval decisions, and expected learner routing. |
| `dev/gold/learners.json` | Seven pre-update profiles with branch, device, language, assignment, and mastery data. |
| `dev/gold/flagged_draft.json` | A draft refund claim with an unsupported citation and an expected decision to block publication. |

A `clause_id` identifies the same rule across a family's versions and scan. Use `(document_id, clause_id)` to resolve a specific citation or retrieval result. Each extraction record includes the document title and scope, followed by individual procedures that link to their clause IDs. Procedure IDs stay stable across revisions and scans. Page and table-row numbers start at 1. The table header is row 1. DOCX and TXT citations use the section heading, with a row locator when applicable. Scans and text PDFs include a page locator.

## Development and held-out evaluation

Use `dev/uploads/` for the development index and `dev/gold/` for prompt development and reference checks. Keep all three held-out families and their labels out of prompt development and the dev index.

For held-out evaluation, freeze the configuration and create a fresh index from the three source files in `held_out/uploads/` only. Send the held-out query text and its applicable scope at evaluation time. Use `held_out/gold/` in the scorer to match extracted claims and citations against the procedure and clause labels and to score retrieval against the expected occurrences.

- **OvisOCR.** Use the three dev scans for OCR checks. The Arabic courier scan has a 1.2° tilt and mild noise. The Arabic partner PDF and English PNG are clean grayscale. Score against the transcribed logical text, permitting line-wrap whitespace changes. Check table reading order by reading the right-hand condition before the left-hand action in each Arabic row. Preserve Arabic-Indic digits and ASCII digits as printed when scoring exact character fidelity. Compare `١٥` on the courier v1 scan with `10` in the selectable-text v2 DOCX.
- **BGE-M3.** Each split includes questions for all three roles and both languages. There are 30 dev questions and nine held-out questions, with 24 cross-language questions across both splits. With a scope filter, use role, organization, family, and version. For unfiltered dev runs, use the labeled wrong matches to inspect cross-role and stale-version ranking errors. Dev query targets use original documents. If you also index scans, canonicalize scan hits to `source_document_id` before scoring and deduplicate by clause occurrence.
- **Updates and learner routing.** Apply each dev v2 to its original family. Changed items require reapproval, added items require initial approval, removed items retire, and unchanged items remain valid. Use the new document ID for current citations and refresh the quote or locator wherever `update_citation` is true. For mastered learners assigned the replaced SOP at the applicable branch, use `reassessment_clause_ids` to test the changed or added rules. In-progress learners receive the updated assignment. Out-of-scope or unassigned learners retain their existing mastery states.

## Live judge demo

Upload [employee-complaint-escalation-v1-en.pdf](held_out/uploads/employee-complaint-escalation-v1-en.pdf) in a fresh session. This one-page held-out SOP gives the app distinct conditions to extract and cite, then turn into trainer-reviewed assessment material.

## Validate locally

Run from the repository root with Python 3.11 or later. Install the dataset validator’s two dependencies if needed.

```sh
python -m pip install Pillow==13.0.0 pypdf==6.21.4
python data/synthetic_sops/validate.py
```

The validator checks upload inventory, format coverage, 10 to 20 procedures per file, family and split isolation, clause references, source quotes and locators, image-only files, scan hashes and transcription completeness, version pairings, and training and learner routing. Quote comparisons preserve wording, punctuation, and digit glyphs while allowing PDF line-wrap whitespace. Arabic DOCX renders and final scan pages were also inspected for shaping, reading order, tables, and mixed digits. The fixture check runs locally. OvisOCR, BGE-M3, and HungerLearn end-to-end evaluations are separate runs.
