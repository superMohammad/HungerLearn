-- HungerLearn app schema. docproc owns: documents, document_versions, clauses,
-- clause_versions, embeddings, comparisons (created by `docproc init-db`).
-- The app owns everything below. Applied by `pnpm db:migrate`.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per uploaded document family (an SOP).
CREATE TABLE IF NOT EXISTS hl_documents (
    document_id   TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('courier', 'employee', 'partner')),
    partner_type  TEXT CHECK (partner_type IN ('restaurant', 'cafe')),
    language      TEXT NOT NULL CHECK (language IN ('ar', 'en')),
    current_version_id TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((role = 'partner') = (partner_type IS NOT NULL))
);

-- Procedures of a document version: groups of clauses (stable ids) with a title and steps.
-- procedure_key stays the same across versions so mastery and badges follow the procedure.
CREATE TABLE IF NOT EXISTS procedures (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id   TEXT NOT NULL REFERENCES hl_documents(document_id),
    version_id    TEXT NOT NULL,
    procedure_key TEXT NOT NULL,
    ordinal       INTEGER NOT NULL,
    title         TEXT NOT NULL,
    steps         JSONB NOT NULL,
    stable_ids    JSONB NOT NULL,
    UNIQUE (document_id, version_id, procedure_key)
);

-- One generated training package per procedure version and role (training-generator output).
CREATE TABLE IF NOT EXISTS training_packages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procedure_id  UUID NOT NULL REFERENCES procedures(id),
    document_id   TEXT NOT NULL,
    version_id    TEXT NOT NULL,
    procedure_key TEXT NOT NULL,
    role          TEXT NOT NULL,
    language      TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('ok', 'needs_human', 'skipped')),
    skip_reason   TEXT,
    flags         JSONB NOT NULL,
    resource_requests JSONB NOT NULL,
    ideas         JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_packages_procedure ON training_packages (procedure_id);

-- Reviewable units of a package: the lesson (with its video plan), practice and exam questions.
-- Every item cites one clause (stable_id + exact quote).
CREATE TABLE IF NOT EXISTS training_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id    UUID NOT NULL REFERENCES training_packages(id),
    document_id   TEXT NOT NULL REFERENCES hl_documents(document_id),
    version_id    TEXT NOT NULL,
    procedure_key TEXT NOT NULL,
    role          TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('lesson', 'practice', 'exam')),
    ordinal       INTEGER NOT NULL,
    stable_id     TEXT NOT NULL,
    quote         TEXT NOT NULL,
    payload       JSONB NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('draft', 'verified', 'approved', 'published', 'outdated', 'rejected')),
    flags         JSONB NOT NULL DEFAULT '[]'::jsonb,
    judge_reason  TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_items_package ON training_items (package_id);
CREATE INDEX IF NOT EXISTS ix_items_doc_version ON training_items (document_id, version_id);
CREATE INDEX IF NOT EXISTS ix_items_status ON training_items (status);

-- Audit log: who did what, when, against which clause version.
CREATE TABLE IF NOT EXISTS item_events (
    id            BIGSERIAL PRIMARY KEY,
    item_id       UUID NOT NULL REFERENCES training_items(id),
    actor         TEXT NOT NULL,
    action        TEXT NOT NULL,
    from_status   TEXT,
    to_status     TEXT NOT NULL,
    version_id    TEXT NOT NULL,
    note          TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_events_item ON item_events (item_id);

-- Video of a lesson item, rendered once and reused by every learner.
CREATE TABLE IF NOT EXISTS lesson_videos (
    item_id       UUID PRIMARY KEY REFERENCES training_items(id),
    status        TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
    video_path    TEXT,
    error         TEXT NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learners (
    learner_id    TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('courier', 'employee', 'partner')),
    branch        TEXT NOT NULL,
    language      TEXT NOT NULL CHECK (language IN ('ar', 'en')),
    device        TEXT NOT NULL CHECK (device IN ('phone', 'laptop', 'tablet'))
);

-- One row per answer. `confidence` is the learner's confidence tap; sure + wrong = highest risk.
CREATE TABLE IF NOT EXISTS attempts (
    id            BIGSERIAL PRIMARY KEY,
    learner_id    TEXT NOT NULL REFERENCES learners(learner_id),
    item_id       UUID NOT NULL REFERENCES training_items(id),
    document_id   TEXT NOT NULL,
    version_id    TEXT NOT NULL,
    procedure_key TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('practice', 'exam')),
    format        TEXT NOT NULL,
    answer        JSONB NOT NULL,
    confidence    TEXT NOT NULL CHECK (confidence IN ('sure', 'unsure')),
    correct       BOOLEAN NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_attempts_learner_proc ON attempts (learner_id, document_id, procedure_key);

-- Mastery and badge per learner and procedure.
CREATE TABLE IF NOT EXISTS mastery (
    learner_id    TEXT NOT NULL REFERENCES learners(learner_id),
    document_id   TEXT NOT NULL REFERENCES hl_documents(document_id),
    procedure_key TEXT NOT NULL,
    version_id    TEXT NOT NULL,
    state         TEXT NOT NULL CHECK (state IN ('not_started', 'in_progress', 'mastered', 'needs_refresh')),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (learner_id, document_id, procedure_key)
);

CREATE TABLE IF NOT EXISTS notifications (
    id            BIGSERIAL PRIMARY KEY,
    learner_id    TEXT NOT NULL REFERENCES learners(learner_id),
    document_id   TEXT NOT NULL,
    version_id    TEXT NOT NULL,
    message       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Background pipeline runs (upload → docproc → procedures → generation), shown in the trainer UI.
CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id            BIGSERIAL PRIMARY KEY,
    document_id   TEXT NOT NULL REFERENCES hl_documents(document_id),
    version_id    TEXT NOT NULL,
    step          TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
    error         TEXT NOT NULL DEFAULT '',
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_jobs_doc ON pipeline_jobs (document_id, version_id);

-- Every AI call is logged (cost, prompt version).
CREATE TABLE IF NOT EXISTS ai_calls (
    id            BIGSERIAL PRIMARY KEY,
    purpose       TEXT NOT NULL,
    model         TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    duration_ms   INTEGER NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read-only surface for "ask in plain Arabic" (LLM text-to-SQL): one row per learner ×
-- procedure that has published training for the learner's role in the current version.
CREATE OR REPLACE VIEW readiness_v AS
SELECT l.learner_id, l.name, l.role, l.branch,
       p.document_id, p.procedure_key, p.title AS procedure_title,
       COALESCE(m.state, 'not_started') AS state,
       (SELECT COUNT(*) FROM attempts a
         WHERE a.learner_id = l.learner_id AND a.document_id = p.document_id AND a.procedure_key = p.procedure_key
           AND a.confidence = 'sure' AND NOT a.correct)::int AS confident_wrong,
       m.updated_at
FROM learners l
JOIN hl_documents d ON d.role = l.role
JOIN procedures p ON p.document_id = d.document_id AND p.version_id = d.current_version_id
LEFT JOIN mastery m ON m.learner_id = l.learner_id AND m.document_id = p.document_id AND m.procedure_key = p.procedure_key
WHERE EXISTS (SELECT 1 FROM training_items i
              WHERE i.document_id = p.document_id AND i.version_id = p.version_id
                AND i.procedure_key = p.procedure_key AND i.status = 'published');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hl_readonly') THEN
        CREATE ROLE hl_readonly LOGIN PASSWORD 'hl_readonly';
    END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hl_readonly;
GRANT USAGE ON SCHEMA public TO hl_readonly;
GRANT SELECT ON readiness_v TO hl_readonly;
ALTER ROLE hl_readonly SET default_transaction_read_only = on;
ALTER ROLE hl_readonly SET statement_timeout = '3s';
