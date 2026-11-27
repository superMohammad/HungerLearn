# HungerLearn dataset improvement log

Ten improvement loops on `data/synthetic_sops/`, completed 2026-11-24. Each loop:

1. Ran a targeted check.
2. Fixed a specific, evidenced issue, or strengthened a check if the data already passed.
3. Reran the targeted check.
4. Ran the full validator.

A loop counted only when the validator passed. Outputs are in `qa/results/`, prefixed by loop number. The dataset is frozen in `FREEZE.sha256` (28 files).

The inventory is unchanged:

- 15 uploads: five per role, 9 Arabic and 6 English.
- 12 dev files and 3 held-out files.
- Formats: docx 5, txt 4, pdf 3, image PDF 2, PNG 1.
- 156 clause occurrences.
- No stable ID was changed. No identity error was found: `qa/diff_check.py` matched all 34 v1/v2 clause pairs by text alone to the same IDs.
- `employee-complaint-escalation-v1` is untouched and still the one-page live-demo upload.

## Summary

| | Before | After |
| --- | --- | --- |
| Fixture validation | PASS | PASS (old validator also passes the new data) |
| Seeded errors caught: original `validate.py` | 3 / 23 | — |
| Seeded errors caught: improved `validate.py` | — | 24 / 24 (incl. freeze) |
| Facts that restate the quote instead of a normalized label | 216 findings | 0 |
| Arabic header branches checkable against manifest | 0 / 9 | 9 / 9 |
| Version-filter distractors missing from v-scoped queries | 10 | 0 |
| Updates exercising all four learner-routing outcomes | 0 / 3 | 3 / 3 |
| Learner profiles | 7 | 12 |
| Publication-gate fixtures | 1 (structure-only check) | 1 + 8 (decision re-derived from the cited rule) |
| Source edits (quotes) | — | 7 rules in 4 uploads |

## Skills and tools

| Skill or tool | Source and verification | Used for |
| --- | --- | --- |
| Anthropic **docx** skill | Local SKILL.md read; matches [anthropics/skills](https://github.com/anthropics/skills) `skills/docx` (Apache 2.0 per the repo README) | Loop 3: unpack → minimal `word/document.xml` edit (phrases were single runs, so `merge_runs.py` was not needed) → repack → `scripts/office/validate.py --original` (PASS, paragraph counts unchanged) |
| Anthropic **pdf** skill | Local SKILL.md read; matches the repo's `skills/pdf` | Loop 2: ReportLab rebuild of the English PDF; an identity rebuild was pixel-identical to the original. pdfplumber/pypdf/pypdfium2 extraction and rendering in loops 2, 5 and 10 |
| SOP audit rubric (Andrew Luxem, *Standard Operating Procedures* skill v1.0, MIT) | [Playbook page](https://www.andrewluxem.com/playbooks/standard-operating-procedures) and [repo](https://github.com/andrewluxem/standard-operating-procedures) `assets/sop-audit-scorecard.md` (10 dimensions, 0–2) | Loops 2 and 3: observable trigger, owner, one action per step, exceptions and completion. Found the unanchored PS-03 timer, the PS-10/PS-11 quantity conflict, and the vague CH-01 trigger |
| asadeisa/arabic-office-skills `arabic-docx` (MIT) | [Repo](https://github.com/asadeisa/arabic-office-skills) reachable. Its SKILL.md documents `audit_docx` checks; the audit code itself was not fetched, so it was **not installed** | Loop 3: the documented checks were reimplemented in `qa/rtl_audit.py` (`w:bidi`, `w:rtl`, `bCs`/`szCs`, `bidiVisual`, section `bidi`, `jc`, presentation forms) |
| NVIDIA NeMo **Data Designer** skill (Apache-2.0) | [SKILL.md](https://github.com/NVIDIA/skills/blob/main/skills/data-designer/SKILL.md) read; the repo describes itself as "Official, NVIDIA-verified Agent Skills" | **Not used.** It requires configured LLM model aliases (`data-designer config`) and none exist here. The new fixtures (5 learners, 8 gates, 13 distractors) were few enough to write by hand and verify against the SOP clause by clause |
| Microsoft Word (installed) via COM | — | DOCX → PDF rendering for visual checks (no LibreOffice on the machine) |
| `intfloat/multilingual-e5-small` (already in the local HF cache) | — | Loop 6 proxy retrieval run. BGE-M3 is not installed |

Other candidates surfaced by search but not used:

- [rtl-document-translation](https://skills.sh/belumume/claude-skills/rtl-document-translation): a translation workflow, not QA.
- [SOP Authoring](https://claudeskills.info/skills/thebushidocollective/han/sop-authoring/): written for agent SOPs, not operational SOPs.
- [NVIDIA SkillEvaluator](https://docs.nvidia.com/skills/skillevaluator/eval-datasets): evaluates skills, not datasets.

## Loop 1 — Inventory and metadata

- **Check.** `qa/header_audit.py` compares each upload's visible header and audience line with the manifest. `qa/mutation_tests.py` (new) seeds known errors into a temp copy and runs the validator.
- **Issue.** All 15 headers were consistent. However, the validator checked only the organization, never the branch, version line or audience. The 9 Arabic headers print an Arabic branch name the manifest did not record, so they could not be checked at all. A manifest branch error passed validation.
- **Change.**
  - Added `branch_local` to all 15 manifest entries.
  - The validator now checks the full header line (organization, branch, version) and the role's audience line.
- **Files.** `manifest.json`, `validate.py`, `qa/header_audit.py`, `qa/mutation_tests.py`.
- **Result.**
  - Header audit: 0 mismatches. Unverifiable Arabic branches went from 9 to 0.
  - Mutations `wrong_branch` and `wrong_branch_local`: 0/2 → 2/2 caught.
  - Validator: PASS.

## Loop 2 — English SOPs

- **Check.** SOP scorecard read of the four English uploads, plus `qa/sop_lint.py` rule T1: a wait or deadline threshold must name its timer's start event.
- **Issues.**
  - **PS-03:** "has not answered after 7 minutes" has no start event (T1: 1 finding).
  - **PS-10 vs PS-11:** PS-10 said "hold one unit" while PS-11 requires the full quantity for multi-unit orders. The gold even encoded `threshold: 1 unit`. PS-16 inherited "the held unit".
  - **CH-01:** "For an unanswered handoff" is not an observable trigger.
- **Change.**
  - PS-03: "…7 minutes after you send the request…".
  - PS-10: "…hold the quantity you will offer…".
  - PS-16: "…release the held stock…".
  - CH-01: "If the customer does not answer when you reach the delivery address, …". The PDF was regenerated with ReportLab using the original geometry and colours.
  - Gold quotes and facts updated. The validator now enforces T1.
- **Regression fixed mid-loop.** The validator rejected the stale PS-10 threshold ("Malformed numeric threshold"). The facts were corrected before the loop was counted.
- **Files.** `dev/uploads/partner-item-substitution-v1-en.txt`, `dev/uploads/courier-failed-handoff-v1-en.pdf`, `dev/gold/extraction.json`, `validate.py`, `qa/sop_lint.py`.
- **Result.**
  - T1 findings: 1 → 0.
  - Mutation `unanchored_timer`: caught.
  - Validator: PASS.
  - Render: `qa/results/02_render_courier-failed-handoff-v1.png`.

## Loop 3 — Arabic SOPs

- **Check.**
  - `qa/rtl_audit.py` on the 5 Arabic DOCX files.
  - Native-language wording review of all 9 Arabic sources.
  - A digit-fidelity mutation.
  - Word renders of the changed files.
- **Issues.**
  - **RTL audit:** run and table markup is correct (0 errors). `jc=left` on 137 bidi paragraphs and 5 sections without `w:bidi` are warnings. Word renders them correctly (start alignment) but other renderers may not. They were left unchanged, since two of these files have scans derived from them.
  - **EC-12:** «ولا تسجلها **كخصم** مكتمل» is a calque.
  - **EC-14:** «غاب رقم العملية **من** البلاغ» uses the wrong preposition.
  - **PV-11 (held-out):** «**أدلّه** على» is a first-person form used where an imperative is required.
  - **Digit fidelity:** the validator folded Arabic-Indic digits before matching, so ٢٤ → 24 in both source and gold passed unnoticed.
- **Change.**
  - Wording: «خصماً مكتملاً», «عن البلاغ», «نبّهه إلى».
  - Thresholds now record their exact digit glyphs. These were first stored in `source_value`; loop 10 moved them to `printed_value` for compatibility.
  - The validator checks the glyphs against the raw quote.
  - `rtl_audit.py` separates errors from warnings.
- **Files.** `dev/uploads/employee-duplicate-charge-v1-ar.docx`, `held_out/uploads/partner-counter-verification-v1-ar.docx`, both `gold/extraction.json`, `validate.py`, `qa/rtl_audit.py`.
- **Result.**
  - RTL errors: 0.
  - Mutation `digit_glyph_loss`: MISSED → CAUGHT.
  - DOCX skill validator: PASS on both files.
  - Validator: PASS.
  - Renders: `qa/results/03_render_*.png`.

## Loop 4 — Extraction and citations

- **Check.**
  - Quotes and locators: the validator's exact-substring and locator checks, which passed.
  - `qa/facts_audit.py` on facts quality.
  - A prohibition-versus-negation cross-check.
- **Issue.** 216 findings. In 64 rules (106 occurrences across versions and scans), `trigger`/`action` were copies of the quote, in Arabic for Arabic sources, so a fact-level scorer could not compare them. The copy rule was refined once during the loop: a 6-word overlap rule wrongly flagged faithful English labels, so the final rule flags Arabic script, or a copied span that keeps its "If/When…" marker or runs 10+ words.
- **Change.**
  - Normalized English facts authored for each rule from its quote, recorded in `qa/facts_authoring.py`.
  - `negation`, `exceptions`, `actor` and `exception_to` added where the quote states them.
  - The validator now rejects restated facts, requires an action or prohibition, requires `negation` for every explicit «لا تـ» or "do not", and checks that `exception_to` resolves.
- **Files.** Both `gold/extraction.json`, `validate.py`, `qa/facts_audit.py`, `qa/facts_authoring.py`.
- **Result.**
  - Facts audit: 216 → 0.
  - Missing negations: 0.
  - Mutations `copied_facts`, `dangling_exception`, `dropped_negation`: caught.
  - Validator: PASS.

## Loop 5 — Scans and OCR

- **Check.** `qa/scan_qa.py`: poppler `pdftotext`, PNG metadata, effective dpi, projection-profile skew, and page renders.
- **Finding.** The data passes:
  - 0 hidden text characters.
  - 180 dpi on every scan.
  - Measured skew +1.20° against the declared 1.2°; 0° against 0° for the two clean scans.
  - Visually, the courier scan shows «الإصدار 1», «١٥ دقيقة» and the v1 heading «قبل المغادرة».

  Two OCR-input defects would still have passed the validator: a raster downsampled to about 118 dpi (it only required ≥1000 px), and text hidden in PNG EXIF.
- **Change.** The validator now enforces a 150 dpi floor and rejects PNG EXIF, XMP and comment metadata.
- **Files.** `validate.py`, `qa/scan_qa.py`.
- **Result.**
  - Mutations `low_resolution_scan`, `exif_hidden_text`: 0/2 → 2/2 caught.
  - Validator: PASS.
  - **OvisOCR not run:** it is not installed or cached, and no OCR engine exists on this machine.

## Loop 6 — Multilingual retrieval

- **Check.** I verified every query target by hand against its SOP: all 39 targets are correct. `qa/retrieval_filter_audit.py` classified each distractor by the scope filter it violates.
- **Issues.**
  - 10 dev queries scoped to one version of a two-version family did not list the identical rule in the other version, so their version filter went untested.
  - In the proxy embedding run, three filtered misses ranked an unlabelled but plausible rule first.
- **Change.**
  - Added 10 other-version distractors.
  - Added 3 hard negatives: CW-03 for dev-courier-01, CH-13 for dev-courier-06, CW-16 for dev-courier-08, each with a reason checked against the quotes.
  - The validator requires the other-version distractor.
- **Files.** `dev/gold/retrieval.json`, `validate.py`, `qa/retrieval_filter_audit.py`, `qa/retrieval_baseline.py`.
- **Result.**
  - Missing version distractors: 10 → 0.
  - Mutations: `missing_version_distractor` is caught. `stale_retrieval_target` was already caught by the existing scope check.
  - Validator: PASS.
- **Model run (proxy, dev only, e5-small), filtered:** recall@3 0.90, MRR 0.783, cross-language recall@3 0.889.
- **Model run, unfiltered:** recall@3 0.367; a labelled wrong match outranks the target in 60% of queries.
- **BGE-M3 not run:** not in the local cache. Held-out retrieval was not run, to keep it out of development.

## Loop 7 — Version diffs

- **Check.** `qa/diff_check.py` recomputed every diff from text alone, ignoring gold IDs, and spelled out the CW-02 scenario.
- **Finding.** 33 of 34 labels reproduced. PP-02 scores a trigram similarity of 0.496 against v1, just under 0.5, so a text-only matcher misses it. The gold label `changed` is right: same heading, same first sentence. Nothing in the gold recorded that difficulty, and the 15→10 change existed only implicitly.
- **Change.** Each diff entry gains a `match_basis`:
  - `identical_text`, `similar_text` or `none`;
  - `same_section_low_similarity` for PP-02.

  Each changed entry gains `changed_facts` with before and after values:
  - CW-02: threshold 15 (١٥) → 10 (10);
  - ED-02: action and actor;
  - PP-02: exceptions.

  The validator re-derives both fields from the extraction. `diff_check.py` gained a same-section pass.
- **Files.** `dev/gold/version_diffs.json`, `validate.py`, `qa/diff_check.py`.
- **Result.**
  - 34/34 labels reproduced.
  - CW-02 scenario: 10/10 checks pass (reapproval of `training-cw-02`, A-C1 linked, only CW-02 reassessed, HL-101 reassess, HL-103 updated assignment, HL-102 untouched).
  - Mutations `wrong_threshold_change`, `overstated_match_basis`: caught. `missed_rule_change` was already caught by the existing check.
  - Validator: PASS.

## Loop 8 — Assessments

- **Check.** Solved each case from its cited SOP before comparing with gold (`qa/results/08_assessment_solve.md`). Limitation: these gold answers had been seen earlier in the session.
- **Issues.**
  - **A-C1:** sat on the 10-minute boundary.
  - **A-C2:** sat on the 6-minute boundary, and its remediation omitted CH-03, which the wrong answer breaks.
  - **A-E1:** asked "Who" while the key is an action.
  - **A-P2:** did not say whether the offer had been sent, and its key omitted the PS-10 hold.
- **Change.**
  - A-C1 set at 12 minutes, so v2 says report and v1 says wait.
  - A-C2 set at seven minutes, with remediation adding `training-ch-03`.
  - A-E1 reworded. It stays at 8 minutes with `threshold_boundary: true` to match the video-demo late-order lesson.
  - A-P2 clarified, with PS-10 added.
  - `wrong_answer.violates` added to all six cases.
  - The validator checks that remediation equals the violated rules, that scenarios reach the cited threshold, that the boundary flag is honest, and that a case on a changed threshold separates v1 from v2.
- **Files.** `dev/gold/assessments.json`, `validate.py`.
- **Result.**
  - Mutations `scenario_below_threshold`, `incomplete_remediation`, `non_discriminating_case`: 0/3 → 3/3 caught.
  - Validator: PASS.

## Loop 9 — Approval and learner routing

- **Check.** Counted routing outcomes per update and reviewed the publication-gate coverage.
- **Issues.**
  - The courier update lacked `unaffected_no_assignment`.
  - The employee update lacked `update_in_progress_assignment`.
  - The partner update lacked both.
  - No learner had mastered the **same** family at another branch.
  - The one gate fixture was checked for shape only, and no gate tested thresholds.
- **Change.**
  - Five learners added: HL-104, HL-105 (same family at Papaya Bend), HL-203, HL-303 and HL-304. Impacts were recomputed and hand-checked.
  - `dev/gold/publication_gates.json` adds 8 Arabic and English gates: supported; wrong threshold; `>=` restated as "more than" or «أكثر من»; superseded v1 citation; and ١٠ against a printed 10.
  - The validator re-derives each gate decision and requires all four routing outcomes in every update.
- **Files.** `dev/gold/learners.json`, `dev/gold/version_diffs.json`, `dev/gold/publication_gates.json`, `validate.py`.
- **Result.**
  - Updates covering all outcomes: 0/3 → 3/3.
  - The reassessed set is still exactly HL-101, HL-201 and HL-301.
  - Mutations `strict_operator_allowed`, `superseded_citation_allowed`, `routing_gap`: caught. `out_of_branch_reassessed` was already caught by the existing routing rule, now with a fixture to test it.
  - Validator: PASS.

## Loop 10 — Final audit and freeze

- **Check.**
  - `qa/independent_audit.py` re-parses every upload with different parsers (pdfplumber, python-docx, raw bytes). It re-finds all 156 quotes and their headings, resolves 109 references, and scans for leaked gold labels.
  - Renders of the courier v2 DOCX and the live-demo PDF.
  - A compatibility run of the original validator.
- **Issues.**
  - Leakage was unchecked: a label placed in DOCX properties passed.
  - The original validator **rejected** the improved data because loop 3 had changed the meaning of `source_value`.
- **Change.**
  - The validator rejects gold labels in upload text or metadata.
  - Digit glyphs moved to a new `printed_value` field, so `source_value` keeps its original meaning (number words).
  - Added `qa/freeze.py` and `FREEZE.sha256`; the validator verifies the freeze.
  - README updated.
- **Files.** `validate.py`, both `gold/extraction.json`, `dev/gold/version_diffs.json`, `qa/independent_audit.py`, `qa/freeze.py`, `FREEZE.sha256`, `README.md`.
- **Result.**
  - Independent audit: 0 problems.
  - Mutation `label_leak_in_metadata`: MISSED → caught. `freeze_tamper`: caught.
  - Full suite: 24/24.
  - The original validator now passes the improved data, and catches 3 of the same 23 seeded errors.
  - Validator: PASS (frozen, 28 files).
  - Renders: `qa/results/10_render_*.png`.

## Addendum (2026-11-25) — clause-level change pairs

- **Why.** The research recommended at least 10 edit pairs per change type, in Arabic and English. Three whole-document diffs cannot measure detection per type.
- **Change.** `dev/gold/change_pairs.json` (82 pairs) and `held_out/gold/change_pairs.json` (24 pairs).
  - Each pair starts from an exact gold clause quote and applies one typed edit.
  - Types: cosmetic, wording, threshold, negation, modality, actor, condition, order.
  - Development has 10 or more pairs per type in both languages; held-out has 3 per type.
  - Held-out pairs use only held-out clauses, and no SOP upload changed.
  - The edits are recorded as exact replacements in `qa/change_pairs_authoring.py`.
- **Checks.**
  - The validator re-derives evidence from the two texts (numbers, negations, modal verbs, actors, condition and order words) and rejects any pair whose text does not support its label.
  - A discrimination test re-checked every pair under all 8 labels. At first 103/106 accepted only their own label: three condition pairs that mention the customer also passed as actor changes. After tightening the actor rule, the result is **106/106** (`qa/results/11_change_pairs_discrimination.txt`).
- **Bugs found and fixed.**
  - The matching normalizer turned tatweel (ـ) into a space, so a purely cosmetic «التوزيـــع» would read as a different word. Fixed in `validate.py` and `qa/diff_check.py`.
  - «ما لم» ("unless") was counted as a negation; it now counts as a condition.
- **Result.**
  - Seeded errors: 29/29 caught. The five new ones are a threshold change mislabelled as wording, a wording pair that adds a time limit, a downgraded safety severity, a held-out pair built on a dev clause, and a drifted "before" text.
  - Validator: PASS, re-frozen at 30 files.
  - The original validator still passes the data.
- **Still needed.** A native Arabic speaker should read a sample of the Arabic "after" texts for natural wording.

## Addendum (2026-11-27): v3 long SOP uploads

- **Why.** Every dev upload was a one-page memo. Real SOPs are 20–40 pages, with front matter, tables, figures, examples and appendices around the rules, so extraction precision and the v2 → v3 update were never tested on realistic documents.
- **Change.** Each family that has a v2 gets a v3: courier pickup wait (AR), employee delayed order (EN) and partner packing (AR).
  - Each v3 comes as six uploads: PDF, DOCX and TXT, in Arabic and English. That makes 18 files, with the PDFs at 28–29 pages.
  - Hunger Learn logo, tables, three charts drawn as PNG images, and a role photo.
  - Rules carry over from v2:
    - courier: 52 rules (6 unchanged, 4 changed, 1 removed, 42 new);
    - employee: 38 rules (5 unchanged, 4 changed, 1 removed, 29 new);
    - partner: 34 rules (7 unchanged, 3 changed, 1 removed, 24 new).
  - Everything is generated from one bilingual authoring record per family (`qa/v3_authoring/`) by `qa/v3_render.py` (Chrome for the PDFs, python-docx for the DOCX files) and `qa/v3_gold.py`.
- **Labels.**
  - Manifest variants `format_copy` and `translation` point at the original.
  - Extraction labels, with PDF pages read from the rendered files.
  - The v2 → v3 diff and its learner routing (6 new learners who hold v2).
  - Retrieval distractors for the v3 copy of each answer.
  - Publication gates G-01…G-06 point at v3, because v2 is now superseded. The three retrieval queries that called v2 "current" or "new" now name version 2.
  - Not moved: the assessment cases A-C1, A-E1, A-P1 and the flagged draft still cite v2. They test v2 only; do not publish them as current training.
- **Checks.**
  - `validate.py` checks v3 rules as numbered lines inside their sections, or by words on the cited page for PDFs. It also checks the copy and translation metadata, and that copies match the original's clauses and facts.
  - English PDF quotes are matched as written on their cited page. Arabic translations must quote the same text in all three formats.
  - Nine new mutations; 38/38 seeded errors are caught.
  - `independent_audit.py` and `header_audit.py` handle v3 PDFs.
- **Finding.** Chrome writes Arabic PDF text in visual run order:
  - pypdf returns presentation forms, and NUL for one mark glyph;
  - pdfplumber reverses the letters;
  - PyMuPDF splits words at diacritics.

  So the 124 quotes in the three Arabic PDFs are checked only by the validator's word check. docproc detects no «القسم» headings in them. A docproc fix is a separate follow-up.
- **Eval (`docproc eval --real`, gemma4, RTX 3090, 67 min).**
  - The v1/v2 documents are unchanged: all at 1.00, and the v1 → v2 diffs are 33/33.
  - v3 recall is 1.00 everywhere except the Arabic PDFs (0.96, 0.92 and 0.85), and precision is 0.62–0.88. Context, tables and checklists produce extra rules, by design.
  - v2 → v3 diffs:
    - courier 52/53: the removed rule went to review because the new version was incomplete;
    - employee 38/39: a removed rule was matched to a new similar rule;
    - partner 35/35.

## Not run, and why

- **OvisOCR:** not installed or cached. No OCR engine is on the machine, and the GPU (RTX 3050 Laptop) was not tested for it.
- **BGE-M3:** not in the local Hugging Face cache. The retrieval script runs it once it is downloaded.
- **Held-out retrieval or extraction evaluation:** deliberately not run, so the held-out families stay out of development. Held-out sources and labels were only verified (PV-11 wording, normalized facts).
- **HungerLearn end-to-end:** no application code in this project folder.

## Follow-ups outside this dataset

- `video-demo/production-details.json` fingerprints for `dev/gold/extraction.json`, `dev/gold/assessments.json` and `employee-duplicate-charge-v1-ar.docx` are now stale. The clauses the videos depict (ED-01 to ED-03, ED-13, EC-02, EC-03) are unchanged.
- `data.zip` at the project root still holds the pre-improvement dataset.
- `docProps/thumbnail.jpeg` inside the two edited DOCX files still shows the old first page. Word regenerates it on save.

## Rerun

From `data/synthetic_sops/`, with Python 3.11+:

```sh
python -m pip install Pillow==13.0.0 pypdf==6.21.4                 # validator
python -m pip install numpy pypdfium2 pdfplumber python-docx        # QA scripts
python validate.py                                                 # fixture validation (checks the freeze)
python qa/mutation_tests.py                                        # 38 seeded errors, all must be caught
python qa/independent_audit.py
python qa/header_audit.py
python qa/sop_lint.py
python qa/facts_audit.py
python qa/rtl_audit.py dev/uploads/*.docx held_out/uploads/*.docx
python qa/scan_qa.py
python qa/retrieval_filter_audit.py
python qa/diff_check.py
python qa/retrieval_baseline.py --model intfloat/multilingual-e5-small   # needs torch + transformers
python qa/retrieval_baseline.py --model BAAI/bge-m3                      # after downloading BGE-M3
python qa/freeze.py                                                # only after a reviewed data change
```
