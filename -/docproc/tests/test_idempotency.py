from tests.conftest import run_pair


def _count(repo, table):
    return repo._exec(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def test_rerunning_same_versions_is_safe(make_app, fixtures_dir):
    app = make_app()
    _, first = run_pair(app, fixtures_dir / "policy_v1.docx", fixtures_dir / "policy_v2.docx")
    counts = {t: _count(app.repo, t) for t in ("document_versions", "clause_versions", "clauses", "embeddings")}
    _, second = run_pair(app, fixtures_dir / "policy_v1.docx", fixtures_dir / "policy_v2.docx")
    assert {t: _count(app.repo, t) for t in counts} == counts
    key = lambda r: sorted((c.status.value, c.stable_id) for c in r.clauses)
    assert key(first) == key(second)
    assert app.repo.list_versions("doc-1") == ["v1", "v2"]


def test_embeddings_are_reused_by_hash(make_app, fixtures_dir):
    calls = []

    from docproc.embeddings import FixtureEmbedder

    class Counting(FixtureEmbedder):
        def embed(self, texts):
            calls.append(len(texts))
            return super().embed(texts)

    app = make_app(embedder=Counting())
    run_pair(app, fixtures_dir / "policy_v1.docx", fixtures_dir / "policy_v2.docx")
    # v1: 4 new clauses. v2: unchanged + moved reuse cached vectors; only B' and E are new.
    assert calls == [4, 2]
    app.compare("doc-1", "v2")
    assert calls == [4, 2], "re-running compare must not re-embed anything"
