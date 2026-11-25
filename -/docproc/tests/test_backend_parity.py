"""SQLite and PostgreSQL share the workflow and matching rules; results must be identical.

The PostgreSQL leg runs only when DOCPROC_PG_DSN points at a database with pgvector:
    docker compose up -d ; $env:DOCPROC_PG_DSN="postgresql://docproc:docproc@localhost:5432/docproc"
"""
import os
import uuid

import pytest

from docproc.storage.sqlite import SqliteRepository
from tests.conftest import run_pair


def _signature(report):
    return sorted((c.status.value, c.stable_id, (c.new or c.old).clause_number) for c in report.clauses)


def test_sqlite_in_memory_matches_file_backend(make_app, fixtures_dir):
    _, a = run_pair(make_app(), fixtures_dir / "policy_v1.docx", fixtures_dir / "policy_v2.docx")
    _, b = run_pair(make_app(repo=SqliteRepository(":memory:")), fixtures_dir / "policy_v1.docx", fixtures_dir / "policy_v2.docx")
    assert _signature(a) == _signature(b)


@pytest.mark.postgres
@pytest.mark.skipif(not os.environ.get("DOCPROC_PG_DSN"), reason="DOCPROC_PG_DSN not set (no PostgreSQL available)")
def test_postgres_matches_sqlite(make_app, fixtures_dir):
    from docproc.storage.postgres import PostgresRepository

    doc = f"parity-{uuid.uuid4().hex[:8]}"
    _, a = run_pair(make_app(), fixtures_dir / "policy_v1.docx", fixtures_dir / "policy_v2.docx", doc=doc)
    pg = PostgresRepository(os.environ["DOCPROC_PG_DSN"], 1024)
    _, b = run_pair(make_app(repo=pg), fixtures_dir / "policy_v1.docx", fixtures_dir / "policy_v2.docx", doc=doc)
    assert _signature(a) == _signature(b)
    assert pg.search_similar("fixture:char3-1024", pg.get_embeddings("fixture:char3-1024", [b.clauses[0].new.content_hash])[b.clauses[0].new.content_hash], k=1)[0][1] > 0.99
