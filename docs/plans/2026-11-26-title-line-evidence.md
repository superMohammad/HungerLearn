# Fix: keep a numbered title line in the quote span

**Tier:** Enhanced: it changes docproc extraction (`graphs/understand.py`), a pipeline path.
**Approved:** Mohammad Almalke (`@superMohammad`), 2026-11-26, in the Claude Code session. Asked how to handle PR C's eval finding, he chose "Fix the fragility first".

## Bug
**Input:** `employee-delayed-order` v1 is a PDF, whose text layer keeps each title on the rule line ("1. Open the delay case When …"). v2 is a `.txt`, with the title on its own line.

**Expected:** the 9 unchanged clauses are `unchanged`.

**Actual:** when gemma leaves the title line out of v2's quotes, they are `changed`.
- This happens in 2 of 2 `docproc eval --real` runs that ingest the scan just before v2 (PR C), giving 2/11.
- When gemma keeps the title line, as in the baseline, the result is 11/11.

**Root cause:** `matching.same_but_title` ignores v1's inline label only when v2 shows it as its title line or heading. That evidence depended on whether the model copied the title into the quote, which varies from run to run.

## Fix
`validate_clauses` widens each located span over a numbered title line directly above it (`_with_numbered_title_line`).
- **When it applies:** only when `normalize.strip_title_line` would strip that line, the same rule `core_text` uses. So content hashes cannot change, and only the title evidence becomes deterministic.
- **Not a title:** a line that another draft in the section quotes ("3. Wear gloves") is its own clause.
- **Always content:** an unnumbered line, and a line with a number, negation, modal verb or punctuation.
- `_block_at` replaces the block lookup that was inlined in `_locate_quote`.

## Criteria → checks
1. **Title kept, hash unchanged:** a numbered title line right above the quote ends up in the span, in English, in Arabic and with a `)` number, and the content hash is the same.
   Check: `tests/test_understand_graph.py::test_a_numbered_title_line_right_above_the_quote_joins_the_span_without_changing_the_hash`.
2. **Rules stay out:** a line stays out unless `strip_title_line` drops it. That covers unnumbered lines, numbers, negations, modal verbs, `1.2 …`, `Article 4 …` and trailing punctuation. A line another draft quotes also stays out.
   Checks: `test_a_line_above_the_quote_stays_out_unless_strip_title_line_would_drop_it` and `test_a_numbered_line_that_another_draft_quotes_is_its_own_clause_not_a_title`.
3. **End to end:** an ingested `.txt` whose model leaves the title out stores the quote with the title.
   Check: `test_the_ingested_record_keeps_the_title_line_the_model_left_out`.

   All 4 tests failed before the fix and pass after.
4. **No regression on dev:** `docproc eval --real` stays at recall 1.00, precision 1.00 and diff 1.00 (baseline `.verify/fix-title-line-evidence/eval-before.log`).
5. **The PR C case is fixed:** with this fix under PR C, the eval with scans gives employee-delayed-order 11/11. Shown in PR C's evidence.

## Files
- `-/docproc/src/docproc/graphs/understand.py`: `_with_numbered_title_line`, `_block_at`, and the two-pass locate in `validate_clauses`.
- `-/docproc/tests/test_understand_graph.py`: 5 tests.

## Feature-map rows
None directly. This is docproc-only, with no UI change. It steadies F07 (v2 comparison) for documents whose versions differ in layout.

## Evidence
- `.verify/fix-title-line-evidence/eval-after.log`: no regression, with everything at 1.00 and 11/11. It ran before the stacked-title guard was added, and that guard only narrows when widening applies.
- `.verify/feat-scan-ocr-rebuild/eval-after-final.log`: the final code with PR C on top. All 9 originals and 3 scans are at 1.00, every diff is 11/11, and v2's quotes keep their title lines.

## Out of scope
- **Two drafts, one span:** a draft quoting `1. Title\nrule` and another quoting only `rule` still give two records with a non-blocking `duplicate_hash`. This predates the change.
- **Location:** the title's block now supplies `location` (page, block), the same as when the model copies the title itself.

## Rollback
Revert the PR. There are no data or schema changes, and re-processing a version restores the old spans.
