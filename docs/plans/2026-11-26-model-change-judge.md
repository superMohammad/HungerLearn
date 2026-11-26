# The AI model decides whether a matched rule changed (v1 → v2)

**Tier:** Enhanced (matching pipeline, new prompt and model call, docproc + web i18n) · **Owner:** Yasser (@altayariyasser) · **Branch:** `feat/model-change-judge` (from `main`; carries the A4 scorer from closed PR #16)

**Approved:** @superMohammad, 2026-11-27

Decisions on the open questions (@superMohammad):
1. The owner's gemma4 runs with a 32768-token context (Ollama picks it automatically; `OLLAMA_CONTEXT_LENGTH` is not set). Set the default `llm_context_tokens=32768`. A teammate whose server has a smaller context sets `DOCPROC_LLM_CONTEXT_TOKENS` to match it (Ollama silently truncates).
2. About 3 to 11 judge calls per v2 document is OK until the separate PR logs docproc calls in `ai_calls`.

Condition: gemma4 thinks by default and its thinking tokens count against `change_max_output_tokens=512`, so answers would be cut off. The judge call turns thinking off (or budgets for it), with a test. The one-line `-/docproc/AGENTS.md` note stays out of this PR; Mohammad adds it separately.

Implemented as: a separate `change_reasoning_effort` setting (default `none`) that the openai_compat judge sends on every call, independent of `llm_reasoning_effort` for extraction (test: `test_the_judge_turns_thinking_off_even_when_extraction_thinks`). Claude Opus 5.5 cannot turn thinking off, so the Anthropic judge uses low effort and reserves 4096 tokens for its answer.

## Problem
The A4 change-pair scorer (closed PR #16, carried here) runs docproc's fixed rules (`matching.change_reasons`) on the 82 typed edits in `dev/gold/change_pairs.json`:
- 44/82 handled correctly, **material recall 0.42 (26/62)**.
- actor 0/10, order 0/10, condition 1/10, modality 7/11, negation 8/11.

A changed actor, condition or step order is labelled "wording changed". So on a v2 upload, learners would not be reassessed for real rule changes.

## Decision (Yasser)
The **model alone** decides whether a matched pair changed and how. The fixed rules stay only as the offline stand-in (`FixtureJudge`), because tests and the fixture eval cannot call a model. The context window must be handled explicitly.

## Approach
1. **Schema** (`models.py`): `ChangeVerdict { kind, old_evidence, new_evidence, explanation }`. `kind` is one of `none`, `cosmetic`, `wording`, `threshold`, `negation`, `modality`, `actor`, `condition`, `order`, `audience`. Materiality follows from the kind:
   - `none` / `cosmetic` → unchanged
   - `wording` → changed (text)
   - all others → changed (material)
2. **Prompt and adapters** (`llm/`, same pattern as the extractor):
   - `CHANGE_SYSTEM_PROMPT` plus a `CHANGE_PROMPT_VERSION` constant. It defines each kind with Arabic and English examples: `١٠` = `10` is no change; `>=` vs «أكثر من» is a threshold change; an added «إلا إذا» / "unless" is a condition; «ولا تـ» → «و…» is negation; «يجب» → «يمكنك» / «يُفضّل» is modality.
   - The clause texts are data, never instructions.
   - `ChangeJudge` protocol, implemented by `OpenAICompatJudge` (json_schema, temperature 0, `max_tokens`, rejects a cut-off answer, retries with the validation error fed back), `AnthropicJudge` and `FixtureJudge`.
   - `make_change_judge(settings)`. `App.change_judge` is passed through `CompareDeps` to the `Matcher`.
3. **Context window** (`config.py`):
   - Only matched pairs whose normalized text differs are sent to the model, one call each with just `heading`, `old_quote` and `new_quote`. Identical, moved or hash-matched pairs cost nothing.
   - New settings: `llm_context_tokens` (default 32768, the owner's gemma4 server; must match the server, e.g. `OLLAMA_CONTEXT_LENGTH`, because Ollama silently truncates) and `change_max_output_tokens` (default 512).
   - A conservative estimate (`ceil(utf8_bytes / 2)`) plus the output budget must fit. Otherwise there is no call and no truncation: the pair becomes `needs_review` with the token numbers in the reason.
4. **Matching** (`matching.py`; rules stay only here): in `assign()`, identical body or `same_but_title` → unchanged/moved without a call. Otherwise: guard, then `judge`, then **evidence check** (each evidence string must occur in its quote, else `needs_review`). Then `reasons = ["<kind>: <old> -> <new>"]` plus `location changed`. `CONTENT_REASONS` and `status_for` use the kinds; `change_reasons` becomes `rule_change_reasons`, used only by `FixtureJudge`.
5. **Scorer** (`evaluation.py`): `score_change_pairs(pairs, judge)` follows the same path as `assign()`. `run_eval` uses `app.change_judge`. `needs_review` counts as not caught.
6. **Web labels**: `web/src/lib/i18n/{en,ar}.ts` get `reasons.prefix` labels for the new kinds, plus the `reasonLabel` test. `pipeline.ts` is unchanged (`KEEP = {unchanged, moved}`).

## Acceptance criteria → checks
- Identical text → no judge call, unchanged → `tests/test_matching.py` (scripted fake judge, written first).
- An actor verdict → `changed`, reason `actor: courier -> dispatcher` → same.
- Evidence not in the quote → `needs_review` → same.
- A pair over the context budget → `needs_review`, judge never called → same.
- A cut-off answer (`finish_reason: length`) → retried, then an error with context → stubbed HTTP transport test.
- `FixtureJudge` reproduces 44/82 on the dev change pairs; matching, idempotency and backend-parity tests stay green → `pytest`.
- `node scripts/check.mjs docproc web` passes; `verify-app` on the v2 carry-over row in Arabic and English.

## Eval delta
- Fixture: extraction 0.81/0.86, diff 0.73, change pairs 44/82, all unchanged.
- **Real** (`docproc eval --real`, GPU or Yasser's own endpoint): headline is change-pair material recall vs 0.42. Also per type, `needs_review` count, calls, latency, and a second run for stability.

## Open questions for @superMohammad
1. Default `llm_context_tokens=4096` (Ollama's default). Does your gemma4 server run with a larger `OLLAMA_CONTEXT_LENGTH`?
2. In v2 compare, a real run now makes one LLM call per reworded pair (about 3 to 11 per dev document). Is that cost acceptable, given these calls are not yet logged in `ai_calls` (your separate-PR decision)?

## Out of scope
Logging docproc LLM calls in `ai_calls` (separate PR); `refresh_text` vs regenerate in web carry-over; editing `-/docproc/AGENTS.md` (High-risk; one-line architecture note suggested to Mohammad).

## Rollback
Revert the PR. `DOCPROC_LLM=fixture` restores rule behaviour without a revert.
