from __future__ import annotations

from pathlib import Path

import pytest

from docproc.config import Settings
from docproc.embeddings import FixtureEmbedder
from docproc.llm.fixture import FixtureExtractor
from docproc.ocr import NullOCR
from docproc.pipeline import App
from docproc.storage.sqlite import SqliteRepository

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIX


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(_env_file=None, backend="sqlite", sqlite_path=str(tmp_path / "t.sqlite3"),
                    llm="fixture", embeddings="fixture", ocr="null")


@pytest.fixture
def make_app(settings, tmp_path):
    """Build an App on a fresh SQLite DB with fixture LLM + fixture embeddings."""
    def _make(repo=None, **kw) -> App:
        repo = repo or SqliteRepository(settings.sqlite_path)
        repo.init_schema()
        return App(settings, repo=repo, extractor=kw.get("extractor", FixtureExtractor()),
                   ocr=kw.get("ocr", NullOCR()), embedder=kw.get("embedder", FixtureEmbedder()))
    return _make


def run_pair(app: App, v1: Path, v2: Path, doc="doc-1", v2_id="v2", ocr=None, work_dir=None, links=True):
    work_dir = work_dir or Path(app.settings.sqlite_path).parent / "pages"
    app.ingest(v1, doc, "v1", work_dir=work_dir)
    r1 = app.compare(doc, "v1")
    app.ingest(v2, doc, v2_id, ocr=ocr, work_dir=work_dir)
    r2 = app.compare(doc, v2_id, FIX / "links.json" if links else None)
    return r1, r2


def by_number(report, number, side="new"):
    for c in report.clauses:
        s = getattr(c, side)
        if s and s.clause_number == number:
            return c
    raise KeyError(number)


def find(report, needle: str):
    from docproc.normalize import normalize

    hits = [c for c in report.clauses if normalize(needle) in normalize((c.new or c.old).quote)]
    assert len(hits) == 1, (needle, [c.status for c in hits])
    return hits[0]
