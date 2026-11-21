"""Repository shared by the SQLite and PostgreSQL backends.

Both backends run the same SQL (only placeholders, JSON and vector encodings differ), and
all matching rules live in docproc.matching, so results are identical across backends.

Identity model:
  clauses          one row per stable clause ID (cross-version identity)
  clause_versions  one row per clause per document version (quote, location, hash, ...)
Re-ingesting a version replaces only that version's clause_versions rows; earlier versions
and their records stay untouched.
"""
from __future__ import annotations

import json
from typing import Any, Iterable

import numpy as np

from docproc.models import ClauseRecord, ComparisonReport, ExtractionIssue, SourceLocation, VersionInfo


def _loads(v: Any) -> Any:
    if v is None:
        return None
    return json.loads(v) if isinstance(v, (str, bytes)) else v


class SqlRepository:
    ph = "?"            # parameter placeholder
    jph = "?"           # JSON parameter placeholder
    vph = "?"           # vector parameter placeholder

    def __init__(self, conn) -> None:
        self.conn = conn

    # -- dialect hooks -------------------------------------------------------------------
    def _encode_vec(self, v: np.ndarray) -> Any:
        raise NotImplementedError

    def _decode_vec(self, v: Any) -> np.ndarray:
        raise NotImplementedError

    def init_schema(self) -> None:
        raise NotImplementedError

    def _q(self, sql: str) -> str:
        return sql.replace("?j", self.jph).replace("?v", self.vph).replace("?", self.ph)

    def _exec(self, sql: str, params: Iterable = ()):
        cur = self.conn.cursor()
        cur.execute(self._q(sql), tuple(params))
        return cur

    def commit(self) -> None:
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # -- versions ------------------------------------------------------------------------
    def upsert_version(self, info: VersionInfo, records: list[ClauseRecord]) -> None:
        """Idempotent: same (document_id, version_id) replaces that version's records."""
        cur = self._exec(
            "SELECT seq FROM document_versions WHERE document_id=? AND version_id=?",
            (info.document_id, info.version_id),
        )
        row = cur.fetchone()
        if row is None:
            cur = self._exec("SELECT COALESCE(MAX(seq), 0) FROM document_versions WHERE document_id=?", (info.document_id,))
            seq = int(cur.fetchone()[0]) + 1
            self._exec("INSERT INTO documents (document_id) VALUES (?) ON CONFLICT (document_id) DO NOTHING", (info.document_id,))
            self._exec(
                "INSERT INTO document_versions (document_id, version_id, seq, source_file, file_format, page_count,"
                " failed_pages, issues) VALUES (?, ?, ?, ?, ?, ?, ?j, ?j)",
                (info.document_id, info.version_id, seq, info.source_file, info.file_format, info.page_count,
                 json.dumps(info.failed_pages), json.dumps([i.model_dump() for i in info.issues], ensure_ascii=False)),
            )
        else:
            self._exec(
                "UPDATE document_versions SET source_file=?, file_format=?, page_count=?, failed_pages=?j, issues=?j"
                " WHERE document_id=? AND version_id=?",
                (info.source_file, info.file_format, info.page_count, json.dumps(info.failed_pages),
                 json.dumps([i.model_dump() for i in info.issues], ensure_ascii=False), info.document_id, info.version_id),
            )
        # keep stable IDs already assigned to identical records (safe re-run)
        cur = self._exec(
            "SELECT record_id, stable_id FROM clause_versions WHERE document_id=? AND version_id=?",
            (info.document_id, info.version_id),
        )
        previous = {r[0]: r[1] for r in cur.fetchall()}
        self._exec("DELETE FROM clause_versions WHERE document_id=? AND version_id=?", (info.document_id, info.version_id))
        for r in records:
            sid = r.stable_id or previous.get(r.record_id)
            self._exec(
                "INSERT INTO clause_versions (record_id, document_id, version_id, ordinal, stable_id, quote, statement,"
                " steps, audiences, audience_source, audience_evidence, clause_number, heading, location, content_hash)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?j, ?j, ?, ?, ?, ?, ?j, ?)",
                (r.record_id, r.document_id, r.version_id, r.ordinal, sid, r.quote, r.statement,
                 json.dumps(r.steps, ensure_ascii=False), json.dumps([a.value for a in r.audiences]),
                 r.audience_source, r.audience_evidence, r.clause_number, r.heading,
                 r.location.model_dump_json(), r.content_hash),
            )
        self.commit()

    def get_version(self, document_id: str, version_id: str) -> VersionInfo | None:
        cur = self._exec(
            "SELECT source_file, file_format, page_count, failed_pages, issues, created_at FROM document_versions"
            " WHERE document_id=? AND version_id=?",
            (document_id, version_id),
        )
        row = cur.fetchone()
        if not row:
            return None
        return VersionInfo(
            document_id=document_id, version_id=version_id, source_file=row[0], file_format=row[1],
            page_count=row[2], failed_pages=_loads(row[3]) or [],
            issues=[ExtractionIssue(**i) for i in (_loads(row[4]) or [])],
        )

    def list_versions(self, document_id: str) -> list[str]:
        cur = self._exec("SELECT version_id FROM document_versions WHERE document_id=? ORDER BY seq", (document_id,))
        return [r[0] for r in cur.fetchall()]

    def previous_version(self, document_id: str, version_id: str) -> str | None:
        cur = self._exec(
            "SELECT version_id FROM document_versions WHERE document_id=? AND seq < "
            "(SELECT seq FROM document_versions WHERE document_id=? AND version_id=?) ORDER BY seq DESC LIMIT 1",
            (document_id, document_id, version_id),
        )
        row = cur.fetchone()
        return row[0] if row else None

    def get_records(self, document_id: str, version_id: str) -> list[ClauseRecord]:
        cur = self._exec(
            "SELECT record_id, ordinal, stable_id, quote, statement, steps, audiences, audience_source,"
            " audience_evidence, clause_number, heading, location, content_hash FROM clause_versions"
            " WHERE document_id=? AND version_id=? ORDER BY ordinal",
            (document_id, version_id),
        )
        return [
            ClauseRecord(
                record_id=r[0], document_id=document_id, version_id=version_id, ordinal=r[1], stable_id=r[2],
                quote=r[3], statement=r[4], steps=_loads(r[5]) or [], audiences=_loads(r[6]) or ["unspecified"],
                audience_source=r[7], audience_evidence=r[8], clause_number=r[9], heading=r[10],
                location=SourceLocation(**_loads(r[11])), content_hash=r[12],
            )
            for r in cur.fetchall()
        ]

    # -- identities ----------------------------------------------------------------------
    def register_clauses(self, document_id: str, first_versions: dict[str, str]) -> None:
        """Create stable clause identities (no-op if they already exist)."""
        for sid, first_version in first_versions.items():
            self._exec(
                "INSERT INTO clauses (stable_id, document_id, first_version_id, last_version_id) VALUES (?, ?, ?, ?)"
                " ON CONFLICT (stable_id) DO NOTHING",
                (sid, document_id, first_version, first_version),
            )
        self.commit()

    def set_record_stable_ids(self, mapping: dict[str, str]) -> None:
        """Attach IDs to historical records that never had one (e.g. the first version)."""
        for record_id, sid in mapping.items():
            self._exec("UPDATE clause_versions SET stable_id=? WHERE record_id=?", (sid, record_id))
        self.commit()

    def assign_identities(
        self, document_id: str, version_id: str, assignments: dict[str, str | None], removed_ids: Iterable[str],
    ) -> None:
        """Point this version's records at stable IDs and mark removed identities."""
        for record_id, sid in assignments.items():
            self._exec("UPDATE clause_versions SET stable_id=? WHERE record_id=?", (sid, record_id))
            if sid:
                self._exec(
                    "UPDATE clauses SET last_version_id=?, removed_in_version_id=NULL WHERE stable_id=?",
                    (version_id, sid),
                )
        for sid in removed_ids:  # historical records stay in clause_versions
            self._exec("UPDATE clauses SET removed_in_version_id=? WHERE stable_id=?", (version_id, sid))
        self.commit()

    def clause_history(self, stable_id: str) -> list[ClauseRecord]:
        cur = self._exec(
            "SELECT document_id, version_id FROM clause_versions WHERE stable_id=?", (stable_id,)
        )
        out = []
        for doc, ver in cur.fetchall():
            out.extend(r for r in self.get_records(doc, ver) if r.stable_id == stable_id)
        return out

    # -- embeddings ----------------------------------------------------------------------
    def get_embeddings(self, model_id: str, hashes: list[str]) -> dict[str, np.ndarray]:
        out: dict[str, np.ndarray] = {}
        for h in set(hashes):
            cur = self._exec("SELECT vector FROM embeddings WHERE model_id=? AND content_hash=?", (model_id, h))
            row = cur.fetchone()
            if row:
                out[h] = self._decode_vec(row[0])
        return out

    def put_embeddings(self, model_id: str, vectors: dict[str, np.ndarray]) -> None:
        for h, v in vectors.items():
            self._exec(
                "INSERT INTO embeddings (model_id, content_hash, dim, vector) VALUES (?, ?, ?, ?v)"
                " ON CONFLICT (model_id, content_hash) DO NOTHING",
                (model_id, h, int(v.shape[0]), self._encode_vec(v)),
            )
        self.commit()

    # -- links & reports -----------------------------------------------------------------
    def set_links(self, links: dict[str, dict[str, list[str]]]) -> None:
        for sid, l in links.items():
            self._exec(
                "INSERT INTO clause_links (stable_id, lesson_ids, badge_ids) VALUES (?, ?j, ?j)"
                " ON CONFLICT (stable_id) DO UPDATE SET lesson_ids=excluded.lesson_ids, badge_ids=excluded.badge_ids",
                (sid, json.dumps(l.get("lesson_ids", [])), json.dumps(l.get("badge_ids", []))),
            )
        self.commit()

    def get_links(self, stable_ids: Iterable[str]) -> dict[str, dict[str, list[str]]]:
        out = {}
        for sid in set(s for s in stable_ids if s):
            cur = self._exec("SELECT lesson_ids, badge_ids FROM clause_links WHERE stable_id=?", (sid,))
            row = cur.fetchone()
            if row:
                out[sid] = {"lesson_ids": _loads(row[0]) or [], "badge_ids": _loads(row[1]) or []}
        return out

    def save_report(self, report: ComparisonReport) -> None:
        self._exec(
            "INSERT INTO comparisons (document_id, new_version_id, old_version_id, complete, report) VALUES (?, ?, ?, ?, ?j)"
            " ON CONFLICT (document_id, new_version_id) DO UPDATE SET old_version_id=excluded.old_version_id,"
            " complete=excluded.complete, report=excluded.report",
            (report.document_id, report.new_version_id, report.old_version_id, bool(report.complete),
             report.model_dump_json()),
        )
        self.commit()

    def get_report(self, document_id: str, version_id: str) -> ComparisonReport | None:
        cur = self._exec("SELECT report FROM comparisons WHERE document_id=? AND new_version_id=?", (document_id, version_id))
        row = cur.fetchone()
        return ComparisonReport.model_validate(_loads(row[0])) if row else None
