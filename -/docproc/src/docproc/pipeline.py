"""Thin service layer that wires settings -> adapters -> LangGraph workflows."""
from __future__ import annotations

import json
from pathlib import Path

from docproc.config import Settings
from docproc.embeddings import Embedder, make_embedder
from docproc.graphs.compare import CompareDeps, build_compare_graph
from docproc.graphs.understand import UnderstandDeps, build_understand_graph
from docproc.llm import ChangeJudge, ClauseExtractor, make_change_judge, make_extractor
from docproc.models import ComparisonReport
from docproc.ocr import OCRAdapter, make_ocr
from docproc.storage import SqlRepository, make_repository


class App:
    def __init__(
        self,
        settings: Settings,
        repo: SqlRepository | None = None,
        extractor: ClauseExtractor | None = None,
        ocr: OCRAdapter | None = None,
        embedder: Embedder | None = None,
        change_judge: ChangeJudge | None = None,
    ) -> None:
        self.settings = settings
        self.repo = repo or make_repository(settings)
        self._extractor, self._ocr, self._embedder = extractor, ocr, embedder
        self._change_judge = change_judge

    @property
    def extractor(self) -> ClauseExtractor:
        if self._extractor is None:
            self._extractor = make_extractor(self.settings)
        return self._extractor

    @property
    def change_judge(self) -> ChangeJudge:
        if self._change_judge is None:
            self._change_judge = make_change_judge(self.settings)
        return self._change_judge

    @property
    def embedder(self) -> Embedder:
        if self._embedder is None:
            self._embedder = make_embedder(self.settings)
        return self._embedder

    def ingest(self, file: str | Path, document_id: str, version_id: str, ocr: OCRAdapter | None = None,
               work_dir: str | Path = "data/pages") -> dict:
        graph = build_understand_graph(UnderstandDeps(
            repo=self.repo, extractor=self.extractor, ocr=ocr or self._ocr or make_ocr(self.settings),
            work_dir=Path(work_dir), min_page_chars=self.settings.min_page_chars,
            min_letter_ratio=self.settings.min_letter_ratio,
        ))
        return graph.invoke({"file_path": str(file), "document_id": document_id, "version_id": version_id})

    def compare(self, document_id: str, version_id: str, links: dict | str | Path | None = None) -> ComparisonReport:
        if isinstance(links, (str, Path)):
            links = json.loads(Path(links).read_text(encoding="utf-8"))
        links = self.resolve_links(document_id, links or {})
        graph = build_compare_graph(CompareDeps(repo=self.repo, embedder=self.embedder, settings=self.settings,
                                                     judge=self.change_judge, links=links))
        return graph.invoke({"document_id": document_id, "version_id": version_id})["report"]

    def resolve_links(self, document_id: str, links: dict) -> dict:
        """Links are keyed by stable_id, or by a selector "@<version_id>#<clause_number>"
        that resolves to the stable ID of that clause in that version."""
        out: dict[str, dict] = {}
        for key, val in links.items():
            if key.startswith("_"):
                continue
            if key.startswith("@") and "#" in key:
                ver, num = key[1:].split("#", 1)
                rec = next((r for r in self.repo.get_records(document_id, ver) if r.clause_number == num and r.stable_id), None)
                if rec is None:
                    continue
                key = rec.stable_id
            out[key] = {"lesson_ids": list(val.get("lesson_ids", [])), "badge_ids": list(val.get("badge_ids", []))}
        return out

    def process(self, file, document_id, version_id, links=None, ocr: OCRAdapter | None = None) -> ComparisonReport:
        self.ingest(file, document_id, version_id, ocr=ocr)
        return self.compare(document_id, version_id, links)
