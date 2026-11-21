"""Checks against real models. All skipped unless explicitly enabled:

  $env:DOCPROC_TEST_OLLAMA="1"   # Ollama running with `ollama pull bge-m3`
  $env:DOCPROC_TEST_ST="1"       # pip install -e ".[st]"  (downloads BAAI/bge-m3, ~2.3 GB, CPU)
  $env:DOCPROC_TEST_LLM="1"      # DOCPROC_LLM=openai_compat|anthropic + key in .env
"""
import os

import pytest

from docproc.config import Settings
from docproc.models import Status
from tests.conftest import find, run_pair

pytestmark = pytest.mark.real_models


def _demo_with(make_app, fixtures_dir, embedder=None, extractor=None):
    kw = {}
    if embedder:
        kw["embedder"] = embedder
    if extractor:
        kw["extractor"] = extractor
    _, r2 = run_pair(make_app(**kw), fixtures_dir / "policy_v1.docx", fixtures_dir / "policy_v2.docx")
    return r2


def _assert_demo(r2):
    b = find(r2, "مطالبات المصروفات")
    assert b.status == Status.changed
    assert find(r2, "customer data confidential").status == Status.moved
    assert r2.summary["removed"] == 1 and r2.summary["added"] == 1


@pytest.mark.skipif(not os.environ.get("DOCPROC_TEST_OLLAMA"), reason="set DOCPROC_TEST_OLLAMA=1 with Ollama + bge-m3")
def test_ollama_bge_m3(make_app, fixtures_dir):
    from docproc.embeddings import OllamaEmbedder

    s = Settings()
    r2 = _demo_with(make_app, fixtures_dir, embedder=OllamaEmbedder(s.ollama_url, s.embedding_model))
    _assert_demo(r2)
    assert find(r2, "مطالبات المصروفات").cosine > 0.9


@pytest.mark.skipif(not os.environ.get("DOCPROC_TEST_ST"), reason="set DOCPROC_TEST_ST=1 (downloads BAAI/bge-m3)")
def test_sentence_transformers_bge_m3_cpu(make_app, fixtures_dir):
    from docproc.embeddings import SentenceTransformerEmbedder

    r2 = _demo_with(make_app, fixtures_dir, embedder=SentenceTransformerEmbedder(batch=2))
    _assert_demo(r2)
    assert find(r2, "مطالبات المصروفات").cosine > 0.9


@pytest.mark.skipif(not os.environ.get("DOCPROC_TEST_LLM"), reason="set DOCPROC_TEST_LLM=1 and configure an LLM + API key")
def test_real_llm_extraction(make_app, fixtures_dir):
    from docproc.llm import make_extractor

    s = Settings()
    assert s.llm != "fixture", "configure DOCPROC_LLM in .env"
    app = make_app(extractor=make_extractor(s))
    st = app.ingest(fixtures_dir / "policy_v1.docx", "real", "v1")
    assert len(st["records"]) >= 4
    assert not [i for i in st["issues"] if i.kind == "quote_not_found"]
