"""SQLite demo backend: no server, one file, float32 BLOB vectors."""
from __future__ import annotations

import sqlite3
from importlib import resources
from pathlib import Path

import numpy as np

from docproc.storage.base import SqlRepository


class SqliteRepository(SqlRepository):
    ph = jph = vph = "?"

    def __init__(self, path: str | Path) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path))
        conn.execute("PRAGMA foreign_keys = ON")
        super().__init__(conn)

    def init_schema(self) -> None:
        sql = resources.files("docproc.storage").joinpath("schema_sqlite.sql").read_text(encoding="utf-8")
        self.conn.executescript(sql)
        self.conn.commit()

    def _encode_vec(self, v: np.ndarray) -> bytes:
        return np.asarray(v, dtype=np.float32).tobytes()

    def _decode_vec(self, v) -> np.ndarray:
        return np.frombuffer(v, dtype=np.float32).copy()
