# v3 SOP documents: long, real-looking, labelled test uploads

**Tier:** Enhanced (corpus files, validator and QA scripts, docproc eval; multi-package, over 400 lines)
**Approved:** @superMohammad, 2026-11-27

## Goal
Each dev SOP today is a one-page memo with 10–11 one-line rules. Add a v3 for each family that has a v2:
- `courier-pickup-wait` (AR);
- `employee-delayed-order` (EN);
- `partner-packing-sealing` (AR).

Each v3 is a 20–40 page professional SOP in PDF, DOCX and TXT, in Arabic and English, with the Hunger Learn logo, tables, and charts or photos where they help. That makes 18 uploads. Each is labelled as test data, so `docproc eval` scores extraction on all of them and the v2 → v3 update on the 3 originals.

Order: the courier family first, reviewed by Mohammad for look and language, then employee and partner.

## Design
- **One authoring record per family** (`data/synthetic_sops/qa/v3_authoring/<family>.py`, typed in `model.py`) holds every visible string as an Arabic/English pair:
  - front matter: document control, revision history, approval, purpose and scope, definitions, RACI, overview with a flowchart;
  - 16–17 procedures, each with when-it-applies, numbered rules, an example from the field, common mistakes, and an optional table or chart;
  - performance indicators with a chart, records, related documents, and appendices (form, checklist, FAQ).
- **Only numbered rules are gold clauses.**
  - v2 rules keep their clause IDs.
  - Each v3 rule is unchanged (exact v2 wording and facts), changed (new facts), or added. Removed rules are listed with a reason.
- **`qa/v3_render.py`** renders all six uploads per family:
  - PDF: HTML printed by headless Chrome, logo top-right on every page, page X of Y.
  - DOCX: python-docx with Word heading styles, RTL paragraphs, tables and runs for Arabic, logo in the header.
  - TXT: the same content.
  - Charts (flow, timeline, bar with target) are PNGs drawn from SVG, so chart labels never enter the extracted text.
  - Headings read «القسم N: …» / "Section N: …" / «الملحق أ: …», which docproc segments in all three formats.
- **`qa/v3_gold.py`** writes the labels from the record and the rendered files:
  - manifest: the original keeps v2's language and format; the five others are `format_copy` or `translation`, each with `source_document_id`;
  - extraction quotes and facts, with PDF pages found in the rendered file;
  - the v2 → v3 diff, derived with `validate.py`'s own rules;
  - two learners per family who hold v2, so every update exercises all four routing outcomes;
  - retrieval distractors for the v3 copy of each answer;
  - publication gates re-pointed from v2 (now superseded) to v3, each keeping the trap it tests.
- **`validate.py`**:
  - accepts v3 and the new variants;
  - checks a v3 rule is a numbered line in its section (DOCX/TXT), or that its words are on its locator page (PDF);
  - requires copies and translations to match the original's clauses, procedures and facts.
- **`qa/mutation_tests.py`** gets 7 v3 mutations. `qa/independent_audit.py` and `qa/header_audit.py` handle v3 PDFs.
- **docproc eval**: `ManifestDocument.variant` accepts the new variants, and `ingest_key` gives each copy its own document ID, so only originals share the family ID for v1 → v2 → v3.

## Acceptance criteria → checks
- 18 uploads, each PDF 20–40 pages → page count from the rendered PDFs.
- The labels match the uploads → `python validate.py` (on an unfrozen copy until the freeze is regenerated), `qa/independent_audit.py`, `qa/header_audit.py`, `qa/rtl_audit.py`.
- The validator catches v3 errors → `qa/mutation_tests.py`, all mutations caught.
- The eval scores every v3 upload and the v2 → v3 diff, with no change on the originals → `tests/test_evaluation.py` (written first, failing on the old variant `Literal`), plus `docproc eval --real` before and after.
- `node scripts/check.mjs` passes.

## Out of scope
- Scanned v3 copies.
- v3 retrieval queries, assessment cases and change pairs.
- Anything in `held_out/`.
- docproc's reading order for Arabic text PDFs. Chrome writes Arabic runs in visual order, so PyMuPDF finds no «القسم» heading and splits words at diacritics. That is a docproc fix for a separate PR.

## Risks and rollback
- **Arabic PDF quotes.** The two Arabic PDFs are checked by words, not exact lines, because no PDF reader recovers their logical order.
- **Gate re-pointing.** Re-pointing the gates changes Yasser's fixtures; `qa/v3_gold.py` names each edit.
- **Rollback:** revert the PR. The v1/v2 corpus, its labels and the freeze return to their previous state.
