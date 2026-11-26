# A4 · Scorers for publication gates and change pairs

**Tier:** Enhanced (docproc eval scorers over corpus gold; stacked on PR #7) · **Owner:** Yasser (@altayariyasser) · **Branch:** `feat/eval-gate-change-scorers` (based on `Yasser`, rebased onto `main` once #7 merges)

**Approved:** @superMohammad, 2026-11-26

**Decisions (Mohammad, 2026-11-26):**
1. **Gate:** wait for vGolden25's publication gate and score it. Don't build a second gate in docproc. Ship the scorer and the decisions contract now, and report `not scored` until the gate lands.
2. **Mapping:** approved as written, and `audience` → `regenerate_and_reassess`.

**Before the PR:** rebase this branch onto `main`. #7 was squash-merged, so the old `Yasser` commits must not come along.

## Problem
PR #7 adds two gold files that nothing scores yet:
- `dev/gold/change_pairs.json`: 82 single-clause edits (cosmetic 10, wording 10, threshold 10, negation 11, modality 11, actor 10, condition 10, step order 10; 39 Arabic, 43 English). Each one has `material` and `expected_handling` (`carry_forward` / `refresh_text` / `regenerate_and_reassess`).
- `dev/gold/publication_gates.json`: 8 draft claims (Arabic and English) with `expected_decision` (`allow_trainer_review` / `block_publication`) and `reason_code` (`supported`, `threshold_mismatch`, `operator_mismatch`, `superseded_version`).

`docproc eval` reports only extraction recall/precision and v1→v2 diff accuracy.

## Approach
1. **Change-pair scorer (system under test: docproc's own matcher).** For each pair, build two `ClauseRecord`s with the same location, heading and audience. Only the text differs (`before` / `after`). Run the real `matching.change_reasons` and `matching.status_for` on them. No LLM, no embeddings, so the result is deterministic and runs on any laptop. Map the result to a handling:
   - no content reason (`unchanged` / `moved`) → `carry_forward`
   - only `wording changed` → `refresh_text`
   - any of `numbers`, `negation`, `modality`, `audience` → `regenerate_and_reassess`

   Score: handling accuracy; material recall (material pairs sent to `regenerate_and_reassess`); false-material count (non-material pairs sent to reassessment); per-`change_type` and per-language breakdown; list of wrong pair IDs.

   Expected finding, not a bug in the scorer: actor, condition and step-order edits have no dedicated reason in `matching.py`. They will likely come out as `refresh_text`, so those material changes are missed. The scorer makes that gap visible. Fixing the matcher is a separate pipeline PR, with `docproc eval --real` before and after.
2. **Publication-gate scorer.** A pure function scores a list of decisions `{gate_id, decision, reason_code}` against the gold. Outputs: decision accuracy, blocked-when-should-block (target 8 of 8 hard cases → 0 unsafe allows), wrongly-blocked supported claims, and reason-code agreement. See the open question for which gate produces the decisions.
3. **Wiring.** `run_eval` loads both gold files from `dev/gold/` only and adds `change_pairs` and `publication_gates` blocks to `EvalReport`. They appear in `docproc eval` output and in `out/eval_dev_*.json`. `held_out/` is never read.

## Acceptance criteria → checks
- Given hand-made pairs (identical text; a 15→20 threshold in Arabic-Indic digits; an added «لا»; a reworded actor), when scored, then the handling and counts equal hand-computed values → `pytest tests/test_evaluation.py`, tests written first.
- Given hand-made gate decisions (all correct; one unsafe allow; one wrongly blocked supported claim), then accuracy, the unsafe-allow count and the wrongly-blocked count are exact → same file.
- Given the dev gold files, when `run_eval` runs with fixtures, then the report contains both blocks and all 82 pair IDs are scored → `pytest`.
- `docproc eval` prints the new numbers, and `out/eval_dev_fixture.json` contains them → command output in the PR.
- `node scripts/check.mjs docproc` passes.

## Files
- `-/docproc/src/docproc/evaluation.py`: gold models, the two scorers and the `EvalReport` fields.
- `-/docproc/src/docproc/cli.py`: print the new numbers.
- `-/docproc/tests/test_evaluation.py`: hand-made cases plus a dev-gold run.
- No change to `matching.py`, prompts, models or storage.

Feature-map rows: none (no UI).

## Eval delta
The extraction and diff numbers must be unchanged before and after, because no pipeline code changes. The change-pair numbers are deterministic, so the fixture run already gives the real figure. I will still ask Mohammad for one `docproc eval --real` run to confirm the existing numbers don't move.

## Open questions for @superMohammad
1. **Which gate do the gate scores measure?** docproc has no claim-level gate today. The web verifier (`generation.ts`: quote check plus LLM judge) checks quotes, not paraphrased claims. vGolden25's lane is building the deterministic publication gate in `web/`. My proposal: A4 ships the scorer and the decisions contract now and reports `publication_gates: not scored (no gate implementation)`. When vGolden25's gate lands, a small `node` script runs it over the 8 claims and writes the decisions file that `docproc eval` scores. The alternative is a deterministic reference gate in docproc (digit-folded numbers, inclusive vs exclusive wording, active-version citation), which would duplicate the web gate.
2. Is the handling mapping above right? In particular, should `audience` count as `regenerate_and_reassess`?

## Out of scope
Fixing the matcher gaps the scorer reveals; held-out scoring; the scoreboard (A2d).

## Rollback
Revert the PR. Only eval code and tests change; app behaviour and stored data are untouched.
