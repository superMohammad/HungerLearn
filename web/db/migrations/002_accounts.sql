-- Email + password accounts and server-side sessions (stands in for Supabase Auth in this local MVP).
-- An account is either an admin (uploads, reviews, publishes, sees readiness) or one learner.

CREATE TABLE IF NOT EXISTS accounts (
    account_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('admin', 'learner')),
    learner_id    TEXT UNIQUE REFERENCES learners(learner_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((kind = 'learner') = (learner_id IS NOT NULL))
);

-- Only the SHA-256 of the session token is stored; the raw token lives in the httpOnly cookie.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    account_id  UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sessions_account ON sessions (account_id);

-- Learner ids for self sign-ups: HL-1001, HL-1002, ...
CREATE SEQUENCE IF NOT EXISTS learner_number_seq START 1001;
