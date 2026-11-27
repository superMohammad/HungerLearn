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

Each upload contains 10 or 11 named procedures. Each procedure addresses a distinct operational situation and has its own source citation. All 15 files contain 156 procedure occurrences, including the matching occurrences in the scans and revisions. These counts cover the v1/v2 corpus; the v3 uploads below add six files per family that has a v2.

## v3 uploads (long SOPs)

Each family with a v2 also has a v3: a full 20–40 page SOP with a cover, document control, definitions, a responsibility matrix, 17–20 procedures (rules, an example, common mistakes, tables), performance indicators, records and appendices. It carries the Hunger Learn logo, plus charts and photos as images. It comes as six uploads: PDF, DOCX and TXT, each in Arabic and English.

| Variant | Meaning |
| --- | --- |
| `original` | The family's language and v2's format. The v2 → v3 diff targets this upload. |
| `format_copy` | The same text in another format. |
| `translation` | The other language. It has the same clauses, procedures and facts, and the quotes are in its own language. |

Copies and translations point at the original through `source_document_id`, and eval scores each under its own document ID.

**Gold quotes.** Only the numbered rules ("6.1", «٦.١») are gold clauses. A quote is the rule text without its number. Context, examples, mistakes, tables and appendices are realistic but unlabelled, so they test extraction precision.

**PDF locators.** Locators give the section heading line, plus the page for PDFs. Headings read «القسم N: …» / "Section N: …".

**Arabic PDFs.** Chrome writes Arabic text in visual run order, so the validator checks those quotes by words on the cited page.

**Rebuilding.** Everything is generated from one authoring record per family in `qa/v3_authoring/`:

```sh
uv run --no-project --with python-docx==1.2.0 --with Pillow==13.0.0 --with pypdf==6.21.4 python -m qa.v3_render
uv run --no-project --with python-docx==1.2.0 --with Pillow==13.0.0 --with pypdf==6.21.4 python -m qa.v3_gold
```

Rendering needs Google Chrome or Chromium. The gold step also adds learners who hold v2, retrieval distractors for the v3 copy of each answer, and re-points the publication gates from v2 (now superseded) to v3.

## Files and labels

Upload files from the selected split’s `uploads/` directory. Use [manifest.json](manifest.json) to resolve document IDs, families, versions, formats, roles, organizations, branches, languages, procedure counts, and paths. Paths are relative to this dataset directory.

| File | What it tests |
| --- | --- |
| `{split}/gold/extraction.json` | Procedure and scope, clause-level source quotes, actionable facts, and citation locations. |
| `{split}/gold/retrieval.json` | Query text and language, applicable scope, expected clause occurrences, and plausible distractors. |
| `dev/gold/transcriptions/` | One complete reference per scanned page, including headers and table cells in reading order. |
| `dev/gold/assessments.json` | Two sample cases per role with correct actions, explanations, citations, and wrong answers that route to remedial practice. `wrong_answer.violates` lists the cited rules the wrong answer breaks; `practice_items` covers exactly those. `threshold_boundary: true` marks a case that deliberately sits on an inclusive threshold. |
| `dev/gold/version_diffs.json` | Clause changes, before and after citations, `match_basis`, `changed_facts` (before and after values of every changed fact), training approval decisions, and expected learner routing. |
| `dev/gold/learners.json` | Twelve pre-update profiles with branch, device, language, assignment, and mastery data. Every update exercises all four routing outcomes. |
| `dev/gold/flagged_draft.json` | A draft refund claim with an unsupported citation and an expected decision to block publication. |
| `{split}/gold/change_pairs.json` | Clause-level change-detection pairs: 82 dev and 24 held-out. Each starts from an exact gold quote and applies one typed edit: cosmetic, wording, threshold, negation, modality, actor, condition or step order, in Arabic and English. Each pair records materiality, severity, expected handling (`carry_forward`, `refresh_text`, `regenerate_and_reassess`) and evidence. Held-out pairs use only held-out clauses. |
| `dev/gold/publication_gates.json` | Eight Arabic and English draft claims for the publication gate: supported, wrong threshold, `>=` restated as "more than" / «أكثر من», superseded v1 citation, and Arabic-Indic `١٠` against a printed `10`. |

A `clause_id` identifies the same rule across a family's versions and scan. Use `(document_id, clause_id)` to resolve a specific citation or retrieval result. Clause IDs are labels only; they never appear in the uploads, so a system must assign and carry its own identities. Each extraction record includes the document title and scope, followed by individual procedures that link to their clause IDs. Procedure IDs stay stable across revisions and scans. Page and table-row numbers start at 1. The table header is row 1. DOCX and TXT citations use the section heading, with a row locator when applicable. Scans and text PDFs include a page locator.

### Label conventions

- **Manifest.** `branch_local` is the branch name printed in the upload header (Arabic for Arabic files, the same as `branch` otherwise). The validator checks the whole header line (organization, branch, version) and the audience line against the manifest.
- **Facts.** `trigger`, `action`, `actor`, and `negation` are short normalized English labels, never copies of the quote. Every explicit prohibition (`do not`, «لا تـ» / «ولا تـ») appears as `negation`. `exception_to` names a clause in the same document. Score triggers and actions semantically; score thresholds, negations, actors, and exceptions as fields.
- **Thresholds.** `value`, `unit`, and `operator` (`>=` is inclusive: "after 10 minutes" applies at exactly 10). A threshold written in digits carries `printed_value` with the exact glyphs (`١٥` on courier v1, `10` on courier v2). A threshold written as a word carries `source_value` (`one`, `كيسين`). A wait or deadline names the event its timer starts from.
- **Diff match basis.** `identical_text` (normalized quotes equal), `similar_text` (character-trigram similarity ≥ 0.5), `same_section_low_similarity` (a rule rewritten in place; PP-02 scores 0.496, so a text-only matcher should flag it for trainer confirmation), or `none` (added or removed).

## Development and held-out evaluation

Use `dev/uploads/` for the development index and `dev/gold/` for prompt development and reference checks. Keep all three held-out families and their labels out of prompt development and the dev index.

For held-out evaluation, freeze the configuration and create a fresh index from the three source files in `held_out/uploads/` only. Send the held-out query text and its applicable scope at evaluation time. Use `held_out/gold/` in the scorer to match extracted claims and citations against the procedure and clause labels and to score retrieval against the expected occurrences.

- **OvisOCR.** Use the three dev scans for OCR checks. The Arabic courier scan has a 1.2° tilt and mild noise. The Arabic partner PDF and English PNG are clean grayscale. Score against the transcribed logical text, permitting line-wrap whitespace changes. Check table reading order by reading the right-hand condition before the left-hand action in each Arabic row. Preserve Arabic-Indic digits and ASCII digits as printed when scoring exact character fidelity. Compare `١٥` on the courier v1 scan with `10` in the selectable-text v2 DOCX.
- **BGE-M3.** Each split includes questions for all three roles and both languages. There are 30 dev questions and nine held-out questions, with 24 cross-language questions across both splits. With a scope filter, use role, organization, family, and version. Every dev query scoped to one version of a two-version family lists the other version's occurrence of the same rule as a wrong match; for unchanged rules the text is identical, so only the version filter can exclude it. For unfiltered dev runs, use the labeled wrong matches to inspect cross-role and stale-version ranking errors. Dev query targets use original documents. If you also index scans, canonicalize scan hits to `source_document_id` before scoring and deduplicate by clause occurrence.
- **Updates and learner routing.** Apply each dev v2 to its original family. Changed items require reapproval, added items require initial approval, removed items retire, and unchanged items remain valid. Use the new document ID for current citations and refresh the quote or locator wherever `update_citation` is true. For mastered learners assigned the replaced SOP at the applicable branch, use `reassessment_clause_ids` to test the changed or added rules. In-progress learners receive the updated assignment. Out-of-scope or unassigned learners retain their existing mastery states.

## Live judge demo

Upload [employee-complaint-escalation-v1-en.pdf](held_out/uploads/employee-complaint-escalation-v1-en.pdf) in a fresh session. This one-page held-out SOP gives the app distinct conditions to extract and cite, then turn into trainer-reviewed assessment material.

## Validate locally

Run from the repository root with Python 3.11 or later. Install the dataset validator’s two dependencies if needed.

```sh
python -m pip install Pillow==13.0.0 pypdf==6.21.4
python data/synthetic_sops/validate.py
```

The validator checks upload inventory, format coverage, 10 to 20 procedures per file, family and split isolation, clause references, source quotes and locators, image-only files, scan hashes and transcription completeness, version pairings, and training and learner routing. Quote comparisons preserve wording, punctuation, and digit glyphs while allowing PDF line-wrap whitespace.

It also enforces the label conventions above. That covers:

- headers and audience lines;
- normalized facts and prohibitions;
- glyph-exact `printed_value` and timer start events;
- other-version retrieval distractors;
- diff `match_basis` and `changed_facts`;
- assessment thresholds and remediation;
- publication-gate decisions re-derived from the cited rule;
- routing coverage per update;
- gold-label leakage into upload text or metadata;
- a 150 dpi floor and no EXIF/XMP text on scans;
- change pairs: each label must be supported by evidence re-derived from the text (numbers, negations, modal verbs, actors, condition words, order words, in Arabic and English);
- the freeze.

### Freeze

`FREEZE.sha256` pins the SHA-256 of all 30 data files (manifest, uploads, gold). While it exists, any edit to a pinned file, or an added or removed data file, fails validation. After a reviewed change, regenerate it on purpose with `python qa/freeze.py`.

### QA scripts and reports

The `qa/` folder holds the targeted checks from the improvement loops. `qa/results/` holds their before and after outputs. [IMPROVEMENT_LOG.md](IMPROVEMENT_LOG.md) records every change.

Report these separately:

| Kind | Command (from this directory) | Status at freeze |
| --- | --- | --- |
| Fixture validation | `python validate.py` | PASS |
| Seeded-error tests | `python qa/mutation_tests.py` | 36/36 caught |
| Change pairs (rebuild from authoring record) | `python qa/change_pairs_authoring.py`, then `python qa/freeze.py` | 106 pairs, each accepted only under its own label |
| Independent re-parse | `python qa/independent_audit.py` | 776 quotes, 126 references, 0 problems (124 quotes in Arabic v3 PDFs are checked only by `validate.py`) |
| Scan checks (no OCR model) | `python qa/scan_qa.py` | 3 scans pass |
| Diff recomputation | `python qa/diff_check.py` | 6 diffs reproduced (v1 → v2 and v2 → v3) |
| Dense retrieval (model run) | `python qa/retrieval_baseline.py --model intfloat/multilingual-e5-small` | dev, proxy model only |
| BGE-M3 retrieval | `python qa/retrieval_baseline.py --model BAAI/bge-m3` | not run (model not installed) |
| OvisOCR | — | not run (no OCR engine installed) |
| HungerLearn end-to-end | — | not run (no app in this folder) |

The QA scripts need extra packages beyond the validator: `numpy pypdfium2 pdfplumber python-docx`, plus `torch transformers` for the retrieval baseline. Models load from the local Hugging Face cache only.
