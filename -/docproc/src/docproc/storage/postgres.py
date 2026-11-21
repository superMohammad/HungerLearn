"""PostgreSQL + pgvector backend for team integration (pip install -e ".[pg]")."""
from __future__ import annotations

from importlib import resources

import numpy as np

from docproc.storage.base import SqlRepository


class PostgresRepository(SqlRepository):
    ph = "%s"
    jph = "%s::jsonb"
    vph = "%s::vector"

    def __init__(self, dsn: str) -> None:
        import psycopg

        conn = psycopg.connect(dsn)
        super().__init__(conn)
        self._vector_registered = False

    def _register(self) -> None:
        if not self._vector_registered:
            from pgvector.psycopg import register_vector

            register_vector(self.conn)
            self._vector_registered = True

    def init_schema(self) -> None:
        sql = resources.files("docproc.storage").joinpath("schema_postgres.sql").read_text(encoding="utf-8")
        with self.conn.cursor() as cur:
            cur.execute(sql)
        self.conn.commit()
        self._register()

    def _exec(self, sql, params=()):
        self._register()
        return super()._exec(sql, params)

    def _encode_vec(self, v: np.ndarray):
        return np.asarray(v, dtype=np.float32)

    def _decode_vec(self, v) -> np.ndarray:
        return np.asarray(v, dtype=np.float32)

    def search_similar(self, model_id: str, vector: np.ndarray, k: int = 5) -> list[tuple[str, float]]:
        """pgvector cosine search across all stored clause embeddings (for teammates' use)."""
        cur = self._exec(
            "SELECT content_hash, 1 - (vector <=> ?v) FROM embeddings WHERE model_id=? ORDER BY vector <=> ?v LIMIT ?",
            (self._encode_vec(vector), model_id, self._encode_vec(vector), k),
        )
        return [(r[0], float(r[1])) for r in cur.fetchall()]
