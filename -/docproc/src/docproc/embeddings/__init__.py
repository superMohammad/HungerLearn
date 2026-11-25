"""BGE-M3 dense embeddings. Backends: Ollama (default), sentence-transformers on CPU, fixture."""
from __future__ import annotations

import hashlib
import math
from typing import Protocol

import httpx
import numpy as np

from docproc.config import Settings
from docproc.normalize import normalize


class Embedder(Protocol):
    model_id: str  # stored with every vector so different models never mix
    dim: int

    def embed(self, texts: list[str]) -> np.ndarray: ...


def _l2(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return (v / n).astype(np.float32)


class OllamaEmbedder:
    """POST /api/embed on a local Ollama server (`ollama pull bge-m3`). CPU-only works."""

    def __init__(self, url: str = "http://localhost:11434", model: str = "bge-m3", dim: int = 1024, batch: int = 4):
        self.url, self.model, self.dim, self.batch = url.rstrip("/"), model, dim, batch
        self.model_id = f"ollama:{model}"

    def embed(self, texts: list[str]) -> np.ndarray:
        out: list[list[float]] = []
        for i in range(0, len(texts), self.batch):
            try:
                r = httpx.post(f"{self.url}/api/embed", json={"model": self.model, "input": texts[i:i + self.batch]}, timeout=300)
                r.raise_for_status()
            except httpx.ConnectError as e:
                raise RuntimeError(
                    f"Ollama is not reachable at {self.url}. Install Ollama and run `ollama pull {self.model}`, "
                    "or set DOCPROC_EMBEDDINGS=fixture (testing) / st_cpu (sentence-transformers)."
                ) from e
            except httpx.HTTPStatusError as e:
                raise RuntimeError(f"Ollama error {e.response.status_code}: {e.response.text[:200]} "
                                   f"(did you run `ollama pull {self.model}`?)") from e
            out.extend(r.json()["embeddings"])
        return _l2(np.asarray(out, dtype=np.float32).reshape(len(texts), -1)) if out else np.zeros((0, self.dim), np.float32)


class SentenceTransformerEmbedder:
    """BAAI/bge-m3 dense vectors on CPU via sentence-transformers (~2.3 GB download, ~2.5 GB RAM)."""

    def __init__(self, model: str = "BAAI/bge-m3", batch: int = 4):
        from sentence_transformers import SentenceTransformer

        self.st = SentenceTransformer(model, device="cpu")
        self.st.max_seq_length = 1024  # clauses are short; keeps RAM low on an 8 GB laptop
        self.batch = batch
        self.dim = self.st.get_sentence_embedding_dimension()
        self.model_id = f"st:{model}"

    def embed(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), np.float32)
        v = self.st.encode(texts, batch_size=self.batch, normalize_embeddings=True, convert_to_numpy=True)
        return v.astype(np.float32)


class EmbeddingGemmaEmbedder:
    """google/embeddinggemma-2 text vectors via sentence-transformers (>=6.1).

    Clause-vs-clause matching is symmetric, so every text uses the model's STS prompt
    ("task: sentence similarity | query: "). Vectors are 768-d and L2-normalized.
    """

    def __init__(self, model: str, device: str, batch: int) -> None:
        from sentence_transformers import SentenceTransformer

        self.st = SentenceTransformer(model, device=device)
        self.batch = batch
        self.dim = self.st.get_embedding_dimension()
        self.model_id = f"st:{model}:STS"

    def embed(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), np.float32)
        v = self.st.encode(texts, prompt_name="STS", batch_size=self.batch,
                           normalize_embeddings=True, convert_to_numpy=True)
        return v.astype(np.float32)


class FixtureEmbedder:
    """Deterministic hashed character-trigram vectors. Similar text => high cosine, like BGE-M3,
    which is exactly what we need to prove that 30 -> 15 days is still caught by the text check."""

    model_id = "fixture:char3-1024"

    def __init__(self, dim: int = 1024):
        self.dim = dim

    def embed(self, texts: list[str]) -> np.ndarray:
        m = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, t in enumerate(texts):
            n = f"  {normalize(t)}  "
            for j in range(len(n) - 2):
                h = int.from_bytes(hashlib.blake2b(n[j:j + 3].encode(), digest_size=4).digest(), "little")
                m[i, h % self.dim] += 1.0
            m[i] = np.sqrt(m[i])  # damp frequent trigrams
        return _l2(m)


def make_embedder(settings: Settings) -> Embedder:
    if settings.embeddings == "ollama":
        return OllamaEmbedder(settings.ollama_url, settings.embedding_model, settings.embedding_dim, settings.embedding_batch_size)
    if settings.embeddings == "st_cpu":
        return SentenceTransformerEmbedder("BAAI/bge-m3", settings.embedding_batch_size)
    if settings.embeddings == "embeddinggemma":
        return EmbeddingGemmaEmbedder(settings.embedding_model, settings.embedding_device, settings.embedding_batch_size)
    return FixtureEmbedder(settings.embedding_dim)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    d = float(np.dot(a, b))
    return d if not math.isnan(d) else 0.0
