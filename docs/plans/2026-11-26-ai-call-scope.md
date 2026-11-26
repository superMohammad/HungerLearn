# A2b · Tie every AI call to its document (migration 003) and price models in config

**Tier:** High-risk (adds `web/db/migrations/003_ai_call_scope.sql`) · **Owner:** Yasser (@altayariyasser) · **Branch:** `feat/ai-call-scope` (from `main`)

**Approved:** @superMohammad, 2026-11-26

**Decisions (Mohammad, 2026-11-26):**
1. **docproc's LLM calls:** logging them goes in a separate PR.
2. **Foreign key:** a foreign key to `hl_documents` is OK.
3. **Setting:** `LLM_PRICES_USD_PER_MTOK` (JSON) is OK.

**Also in this PR:** add `LLM_PRICES_USD_PER_MTOK` to the env file the `web-e2e` job writes in `.github/workflows/ci.yml`. It is required, so that job fails without it. That file is High-risk, so mention it in the PR.

## Problem
`ai_calls` logs purpose, model, prompt version, tokens and duration, but not which document or version a call was for. So the architecture's "cost per document" and "time per document" metrics (section 5) cannot be computed. Model prices exist nowhere, so a token count cannot become dollars.

## Approach
1. **Migration `web/db/migrations/003_ai_call_scope.sql`** (idempotent, because `pnpm db:migrate` re-applies every file on each run):
   ```sql
   ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS document_id TEXT REFERENCES hl_documents(document_id);
   ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS version_id  TEXT;
   ALTER TABLE ai_calls DROP CONSTRAINT IF EXISTS ai_calls_version_needs_document;
   ALTER TABLE ai_calls ADD CONSTRAINT ai_calls_version_needs_document CHECK (version_id IS NULL OR document_id IS NOT NULL);
   CREATE INDEX IF NOT EXISTS ix_ai_calls_doc ON ai_calls (document_id, version_id);
   ```
   Both columns are nullable: old rows stay as they are (no backfill, because the link cannot be recovered), and calls that belong to no document keep NULL.
2. **`web/src/lib/ai.ts`**: `AiCallSpec` gets a required field `scope: { documentId: string; versionId: string } | { documentId: string; versionId: null } | null`. Required means the TypeScript compiler catches any caller that forgets it, so scope can't silently go missing. Every caller passes it:
   - `understand.name_procedures` (`generation.ts:70`): document and version.
   - `generate.package` (`generation.ts:188`): document and version.
   - `verify.judge` (`generation.ts:202`): document and version.
   - `readiness.text_to_sql` (`readiness.ts:76`): `null`, because it is about learners, not a document.
3. **Prices from configuration (`web/src/lib/env.ts`)**: a new required variable `LLM_PRICES_USD_PER_MTOK`, a JSON map from model ID to `{ "input": number, "output": number }` in USD per million tokens. For example, `{"gemma4:latest":{"input":0,"output":0}}` for local Ollama (an explicit zero, not a missing entry). The parser validates it with zod, so a bad value fails loudly at startup. A model with no price raises an error that names the model when cost is computed. There are no defaults, which follows the "no fallbacks" rule. Cost is computed when read (tokens × the configured price), not stored, so fixing a price fixes every report.
4. `web/.env.example` and `scripts/setup-teammate.mjs` get the new variable.

## Design note: threat model
| Risk | Mitigation |
|---|---|
| The migration breaks the shared database or locks a big table | `ADD COLUMN` with no default is metadata-only in Postgres 17; `ai_calls` is small; every statement is `IF NOT EXISTS` / drop-then-add, so re-runs are no-ops. |
| `hl_readonly` (text-to-SQL) gains access to cost or document data | No grant changes. 001 revokes everything and grants only `readiness_v`; `ai_calls` stays invisible to `hl_readonly`. A test asserts `hl_readonly` cannot `SELECT` from `ai_calls`. |
| Cost data leaks to non-admins | Nothing reads the new columns in this PR. The admin-only scoreboard (A2d) is a separate Standard PR with its own session check. |
| A caller logs the wrong document (misattributed cost) | Scope is a typed, required argument taken from the same `doc` / `version` objects the call already uses. The foreign key rejects unknown documents. The CHECK rejects a version without a document. |
| The foreign key blocks a future document deletion | The app has no document deletion today. Any future deletion must decide what happens to its cost history. This is noted here so that decision happens explicitly. |
| Prices are wrong or missing, giving silently wrong dollars | No default price. A missing model is a loud error. Zero for local models has to be written explicitly. |
| Secrets in config | Prices are not secret. `LLM_API_KEY` handling is unchanged. |
| Insert failure after a successful LLM call | Same behaviour as today: the insert throws and the call retries. A bad scope (unknown document) is a programming error and should fail loudly. |

## Acceptance criteria → checks
- Given a fresh database, when `pnpm db:migrate` runs twice, then both runs succeed and `ai_calls` has nullable `document_id` and `version_id`, the foreign key, the CHECK and the index → migration test against the CI Postgres (`web-e2e` / `docproc-postgres` job style), written first.
- Given an existing `ai_calls` row from before 003, after migrating it still exists with NULL scope → same test.
- Given `generateStructured` called for a package, then the logged row carries that document and version; for text-to-SQL, both are NULL → unit test with a stubbed model and database.
- Given `hl_readonly`, then `SELECT … FROM ai_calls` is denied → test.
- Given `LLM_PRICES_USD_PER_MTOK` that is missing, not JSON, negative, or lacks the configured model, then the error names the problem → `env` unit tests.
- `node scripts/check.mjs web` passes, `/security-review` has no open finding, and `verify-app` passes on the upload → generate row (F-row to confirm in `docs/feature-map.md`) in Arabic and English, to show nothing regressed.

## Files
- `web/db/migrations/003_ai_call_scope.sql`: new.
- `web/src/lib/ai.ts`: scope on `AiCallSpec`, written in the insert.
- `web/src/lib/generation.ts`, `web/src/lib/readiness.ts`: pass the scope (readiness is a High-risk path; one argument added, no logic change).
- `web/src/lib/env.ts`: price map parsing.
- `web/.env.example`, `scripts/setup-teammate.mjs`: new variable.
- Tests under `web/` for the above.

## Rollback
The columns are nullable and unused by old code, so reverting the app code is safe with the migration left in place. To remove it fully, run `ALTER TABLE ai_calls DROP CONSTRAINT IF EXISTS ai_calls_version_needs_document; DROP INDEX IF EXISTS ix_ai_calls_doc; ALTER TABLE ai_calls DROP COLUMN IF EXISTS version_id, DROP COLUMN IF EXISTS document_id;` by hand, then delete `003_ai_call_scope.sql`. Because `db:migrate` re-applies every file, deleting the file alone does not drop the columns. Cost history recorded in the meantime is lost on full rollback.

## Open questions for @superMohammad
1. **docproc's LLM calls (clause extraction) are not in `ai_calls` at all.** For a true cost per document (A2c), docproc would have to log its calls too, either into the same table or reported back to `web`. Should that be part of this PR, or a separate one?
2. Is a foreign key to `hl_documents` acceptable, or do you prefer a plain column (no FK) to keep future deletion simple?
3. Is the variable name and format `LLM_PRICES_USD_PER_MTOK` (JSON) fine?

## Out of scope
Cost and time reports (A2c), the scoreboard (A2d), and any backfill of old rows.
