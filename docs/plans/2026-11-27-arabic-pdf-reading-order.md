# docproc: read Arabic text PDFs (Chrome/Skia) in logical order

**Approved:** @superMohammad 2026-11-27 (in session)

## Context
- The v3 eval showed docproc reading the three Arabic v3 PDFs badly:
  - recall is courier 0.96, employee 0.92, partner 0.85, against 1.00 for the same text as DOCX or TXT;
  - **no «القسم N:» headings are detected**, so sections and procedures fall apart.
- Any Arabic SOP that a customer saves from a browser or Word to PDF will look like this, so it is a product bug, not a dataset quirk.

**Root cause** (measured on `partner-packing-sealing-v3-ar.pdf` with PyMuPDF 1.28.6, the version docproc uses):
- Inside each PDF span, Chrome writes glyphs in logical order with exact positions. But the spans are written out of order. `_page_text` (`-/docproc/src/docproc/loaders/pdf.py:38`) joins them in stream order, so a heading comes out as «مطابقة الملصق:٦ القسم» and a rule number as «١.٦.طابق…».
- One span can jump across the line: a sentence-final «.» at x=155 is followed by text starting at x=408. A span can also cover several rows of a wrapped paragraph; one PyMuPDF "line" was 36 pt tall.
- A letter with shadda or tanween is drawn as a **zero-width glyph** with a phantom space on each side, giving «تع ّذ ر» for «تعذّر» and «مشروب ًا».
- Table cells in the same row are sorted left to right, which is the wrong order for RTL.
- `repair_arabic_order` (`normalize.py:83`) only fixes runs whose *letters* are reversed (the older `tests/fixtures/policy_v2.pdf` case). It never fires here.
- No MuPDF flag fixes this. I tried `TEXT_COLLECT_STRUCTURE`, `TEXT_SEGMENT` and `TEXT_ACCURATE_BBOXES`. The PDF is tagged (`/StructTreeRoot`, `/Lang (ar)`), but the tags only give paragraph boundaries, not the order inside a line.

**Prototype (read-only, in this session):** rebuilding each row from glyph positions took exact gold-quote matches from **0 to 44 of 124**, and detected headings from **0 to 41**. The remaining failures all come from three cases, listed in step 3.

## Approach: rebuild each row from glyph geometry (a visual-to-logical bidi pass)
New pure module **`-/docproc/src/docproc/loaders/pdf_bidi.py`**, typed dataclasses with no PyMuPDF types inside, so it can be tested without PDFs:

1. **Runs.** Split each span's glyphs (from `rawdict`) into runs of glyphs that touch on the page. Break when the row changes or when the next glyph is not adjacent (gap > 0.35 × font size). Keep stream order inside a run; Chrome writes it logically, which keeps lam-alef ligatures and marks intact.
2. **Rows.** Group runs by vertical centre (tolerance 0.5 × font size). Order rows top to bottom. Table cells at the same height go right to left on RTL rows.
3. **Order within a row.** A row is RTL when it has more Arabic letters than Latin letters. Then:
   - Sort runs by right edge, descending.
   - Keep a stretch of LTR runs (Latin, digits, and the neutrals between them such as `-`, `:`, `/`, `.`) in left-to-right order. This keeps `TF-418`, `2026-12-01` and `MF-OPS-017` intact.
   - **The three remaining cases from the prototype:**
     - Arabic-Indic numbers with a separator («٦.١») follow the bidi AN+CS rule, so they stay in left-to-right order.
     - A zero-width glyph joins the run before it with no space, with marks after the base, and the phantom spaces next to it are dropped.
     - Spaces come only from geometric gaps (gap > 0.15 × font size), never from space glyphs.
   - LTR rows keep exactly today's behaviour.
4. **`pdf.py`.** `_page_text` uses `pdf_bidi` for every text block, then applies NFC as today.
   - `PdfPage.order_repaired_lines` now counts rows whose rebuilt order differs from stream order, so the `reading_order_repaired` issue still fires (`graphs/understand.py:81`).
   - `repair_arabic_order` stays as the step after it, for letter-reversed PDFs (`policy_v2.pdf`). This is not a fallback: it handles a different defect.

**Tier: Enhanced** (docproc extraction change). Steps:
- this plan saved to `docs/plans/2026-11-27-arabic-pdf-reading-order.md` with your approval;
- failing tests first;
- eval delta;
- a second review.

No new dependencies. No schema change. `-/docproc/AGENTS.md` is not touched, so the PR does not become High-risk.

## Files
- `-/docproc/src/docproc/loaders/pdf_bidi.py`: new, the pure reconstruction.
- `-/docproc/src/docproc/loaders/pdf.py`: `_page_text` and the repaired-row count.
- `-/docproc/tests/test_pdf_bidi.py`: new. One case per behaviour above, built from synthetic glyph records:
  - out-of-order runs;
  - the jump to a sentence-final «.»;
  - a wrapped span;
  - `TF-418` and `2026-12-01`;
  - «٦.١»;
  - zero-width shadda;
  - RTL table cells;
  - an LTR row left unchanged.
- `-/docproc/tests/test_loaders_pdf.py`: new, run on real PDFs:
  - **all 124 gold quotes in the three Arabic v3 PDFs appear exactly on their cited page**, after whitespace collapse;
  - every «القسم N:» heading is a line of its own;
  - the English PDFs' page text is **byte-identical** to today's, as a regression guard;
  - `policy_v2.pdf` still reports `reading_order_repaired`.

  The test reads the PDFs from `data/synthetic_sops/dev/uploads/` (dev only, never `held_out/`).
- `-/docproc/README.md`: one paragraph on how Arabic PDFs are read.

## Verification
1. **Failing first:** the new loader test against today's `_page_text`. Expected: 0/124 exact quotes and 0 headings. Keep that output.
2. **After:**
   - 124/124 exact quotes and every heading found;
   - the English PDFs unchanged;
   - `pytest` green;
   - `node scripts/check.mjs` green.
3. **Eval delta** (`docproc eval --real` on `dev/`, gemma4 on the 3090):
   - Before is the v3 run on current main (docproc unchanged since). Arabic PDF recall: courier 0.96, employee 0.92, partner 0.85.
   - Target: the Arabic PDFs match their DOCX/TXT copies (recall 1.00).
   - No other document drops.
4. `verify-app` F03: upload `courier-pickup-wait-v3-ar.pdf` in the app, in Arabic and English. Procedures should be grouped by «القسم» sections, matching the DOCX upload.

## Out of scope
- `validate.py` still checks Arabic PDF quotes by word bag. It reads with pypdf on purpose, as an independent reader.
- Scanned Arabic PDFs are OCR's job.
