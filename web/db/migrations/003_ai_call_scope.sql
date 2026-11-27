-- 003: tie every AI call to the document and version it was for (cost and time per document).
-- Plan: docs/plans/2026-11-26-ai-call-scope.md. Idempotent: `pnpm db:migrate` re-applies every file.
-- Both columns are nullable: rows logged before 003 cannot be linked (no backfill), and calls that
-- belong to no document (readiness text-to-SQL) keep NULL. No grant changes: hl_readonly still sees
-- only readiness_v.
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS document_id TEXT REFERENCES hl_documents(document_id);
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS version_id  TEXT;
-- Added only once, so a re-run takes no table lock and does not re-scan ai_calls.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ai_calls_version_needs_document' AND conrelid = 'ai_calls'::regclass) THEN
        ALTER TABLE ai_calls ADD CONSTRAINT ai_calls_version_needs_document CHECK (version_id IS NULL OR document_id IS NOT NULL);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_ai_calls_doc ON ai_calls (document_id, version_id);
