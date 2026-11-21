PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
    document_id TEXT PRIMARY KEY,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_versions (
    document_id  TEXT NOT NULL REFERENCES documents(document_id),
    version_id   TEXT NOT NULL,
    seq          INTEGER NOT NULL,
    source_file  TEXT,
    file_format  TEXT,
    page_count   INTEGER,
    failed_pages TEXT,
    issues       TEXT,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, version_id)
);

CREATE TABLE IF NOT EXISTS clauses (
    stable_id             TEXT PRIMARY KEY,
    document_id           TEXT NOT NULL REFERENCES documents(document_id),
    first_version_id      TEXT NOT NULL,
    last_version_id       TEXT NOT NULL,
    removed_in_version_id TEXT
);

CREATE TABLE IF NOT EXISTS clause_versions (
    record_id         TEXT PRIMARY KEY,
    document_id       TEXT NOT NULL,
    version_id        TEXT NOT NULL,
    ordinal           INTEGER NOT NULL,
    stable_id         TEXT REFERENCES clauses(stable_id),
    quote             TEXT NOT NULL,
    statement         TEXT NOT NULL,
    steps             TEXT,
    audiences         TEXT,
    audience_source   TEXT,
    audience_evidence TEXT,
    clause_number     TEXT,
    heading           TEXT,
    location          TEXT,
    content_hash      TEXT NOT NULL,
    FOREIGN KEY (document_id, version_id) REFERENCES document_versions(document_id, version_id)
);
CREATE INDEX IF NOT EXISTS ix_cv_version ON clause_versions(document_id, version_id);
CREATE INDEX IF NOT EXISTS ix_cv_hash ON clause_versions(content_hash);
CREATE INDEX IF NOT EXISTS ix_cv_stable ON clause_versions(stable_id);

CREATE TABLE IF NOT EXISTS embeddings (
    model_id     TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    dim          INTEGER NOT NULL,
    vector       BLOB NOT NULL,
    PRIMARY KEY (model_id, content_hash)
);

CREATE TABLE IF NOT EXISTS clause_links (
    stable_id  TEXT PRIMARY KEY,
    lesson_ids TEXT,
    badge_ids  TEXT
);

CREATE TABLE IF NOT EXISTS comparisons (
    document_id    TEXT NOT NULL,
    new_version_id TEXT NOT NULL,
    old_version_id TEXT,
    complete       INTEGER NOT NULL,
    report         TEXT NOT NULL,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, new_version_id)
);
