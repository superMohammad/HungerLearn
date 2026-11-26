# PR C: read scans with local OvisOCR3 (rebuild of the reverted #8)

**Tier:** High-risk: it changes `-/docproc/AGENTS.md`, a rules file. It is also multi-package (docproc, web, docs) and touches `evaluation.py`, a pipeline path.
**Approved:** Mohammad Almalke (`@superMohammad`), 2026-11-26. This is step 3 of the approved plan
`docs/plans/2026-11-26-enforce-pr-policy-and-redo-ocr.md`. In the session he said "start PR B & C", then "ok approve you to do all remaining tasks".

## Goal
On the GPU machine (`DOCPROC_OCR=ovis`), scans become usable everywhere:
- the web upload and `docproc process` OCR them in-process;
- `docproc eval --real` scores the 3 dev scans;
- on a machine without OCR, a 0-clause upload says why.

The `ovis` adapter predates #8 and is unchanged.

## Criteria → checks
1. **Eval skips scans without live OCR.** Given `ocr=null` or `json_import`, the eval skips each dev scan, and the reason names `DOCPROC_OCR=ovis`. Given `ocr=ovis`, it scores them.
   Check: `tests/test_evaluation.py::test_skip_reason_skips_scans_only_without_live_ocr`.
2. **Scan scores don't overwrite originals.** Given a live OCR engine, the eval scores each scan under `<family>-scan`, and the originals' extraction and diff scores are unchanged.
   Check: `test_run_eval_with_live_ocr_scores_scans_apart_from_their_originals`, using a stub OCR.
3. **The eval CLI enables OCR only for `--real` with `ovis`.** An imported OCR JSON can't leak into eval scores.
   Check: code review of `cli.py`; criterion 1 covers the path.
4. **Zero-clause error names the cause.** Given an upload with 0 clauses:
   - with "OCR not configured" issues, the job error names the pages and `DOCPROC_OCR=ovis`, and lists any other issues;
   - with a configured engine's failures, it lists each page's error, with each detail shortened;
   - long lists are capped;
   - other issue kinds are listed;
   - the stored JSONB is validated with zod.

   Checks:
   - 7 tests in `web/src/lib/logic.test.ts`;
   - `tests/test_ocr_adapter.py` pins NullOCR's text;
   - an app walk with `DOCPROC_OCR=null`: screenshots `F03-no-ocr-{ar,en}.png`.
5. **Eval delta on dev.** `docproc eval --real` after the change scores the 3 scans and leaves the 9 originals at the baseline:
   - recall, precision and diff accuracy 1.00;
   - the baseline is in `.verify/feat-scan-ocr-rebuild/eval-before.log`.
6. **F03 works on a real scan, AR and EN.** Uploading a dev scan through the app reaches done, with procedures listed.
   Check: the verify-app skill; screenshots `F03-ar.png` (Arabic PDF scan) and `F03-en.png` (English PNG scan).
7. **Full feature-map walk.**
   Check: `node scripts/verify-app.mjs`, the scripted F01, F02 and F06. The LLM rows F04, F05 and F07 are untouched by this change and are listed in the PR as not re-walked, with that reason.

All new tests are written first and must fail before the implementation.

## Files
- `-/docproc/src/docproc/evaluation.py`: `skip_reason(…, ocr_engine)`, `ingest_key`, `run_eval`.
- `-/docproc/src/docproc/cli.py`: the eval's OCR override.
- `-/docproc/tests/test_evaluation.py`: tests 1 and 2.
- `web/src/lib/docproc-issues.ts` (new, pure): `zeroClausesError`.
- `web/src/lib/docproc.ts`: `listVersionIssues`.
- `web/src/lib/pipeline.ts`: uses them.
- `web/src/lib/logic.test.ts`: test 4.
- `-/docproc/AGENTS.md`: the OCR line.
- `-/docproc/README.md`: a pointer to it.
- `-/docproc/src/docproc/config.py`: `OcrEngine` is defined once.
- `-/docproc/src/docproc/ocr/null.py`: the comment on the pinned text.
- `-/docproc/tests/test_ocr_adapter.py`: the pin test.
- `docs/feature-map.md`: F03.

## Feature-map rows
F03 in AR and EN, plus the scripted F01, F02 and F06.

## Out of scope
- Changes to the `ovis` adapter.
- Held-out runs.
- New dependencies: `.[ovis]` is already declared and installed here.

## Rollback
Revert the PR. Machines without a GPU keep the out-of-process OCR path. There are no data or schema changes, and `document_versions.issues` is only read.
