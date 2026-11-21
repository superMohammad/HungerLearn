"""Application settings, read from DOCPROC_* environment variables or a .env file."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DOCPROC_", env_file=".env", extra="ignore")

    # Storage
    backend: Literal["sqlite", "postgres"] = "sqlite"
    sqlite_path: str = "data/docproc.sqlite3"
    pg_dsn: str = "postgresql://docproc:docproc@localhost:5432/docproc"

    # Clause-extraction LLM
    llm: Literal["fixture", "openai_compat", "anthropic"] = "fixture"
    llm_model: str = "gpt-4o-mini"
    llm_base_url: str = "https://api.openai.com/v1"  # e.g. http://localhost:11434/v1 for Ollama
    llm_api_key: str = ""
    anthropic_api_key: str = ""
    llm_timeout_s: float = 120.0
    llm_max_retries: int = 2

    # Embeddings (BGE-M3 dense, 1024-d)
    embeddings: Literal["ollama", "st_cpu", "fixture"] = "ollama"
    embedding_model: str = "bge-m3"  # Ollama tag; st_cpu uses BAAI/bge-m3
    embedding_dim: int = 1024
    embedding_batch_size: int = 4
    ollama_url: str = "http://localhost:11434"

    # OCR
    ocr: Literal["json_import", "ovis", "null"] = "json_import"
    ocr_json: str = ""  # path to OCR JSON (keyed by version_id -> page number)
    ovis_model: str = "ATH-MaaS/OvisOCR3"

    # PDF text probe
    min_page_chars: int = 40
    min_letter_ratio: float = 0.5

    # Matching thresholds
    cosine_candidate: float = 0.72
    lexical_same_identity: float = 0.55
    anchored_lexical_min: float = 0.30
    ambiguity_margin: float = 0.03
    top_k: int = 5


@lru_cache
def get_settings() -> Settings:
    return Settings()
