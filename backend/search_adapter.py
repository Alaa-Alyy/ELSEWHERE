"""Thin, replaceable adapter over Person 1's analysis.search. No score formula lives here."""
from __future__ import annotations

import logging

from analysis.search import DataUnavailableError, InvalidInputError, SearchEngine, SearchError, UnknownIdError

from .config import Settings

log = logging.getLogger("missionmatch.search")

__all__ = ["SearchAdapter", "SearchError", "UnknownIdError", "InvalidInputError", "DataUnavailableError"]


class SearchAdapter:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.engine: SearchEngine | None = None
        self.error: str | None = None
        try:
            self.engine = SearchEngine.load(settings.corpus_dir)
        except DataUnavailableError as exc:
            self.error = str(exc)
            log.warning("search engine unavailable: %s", exc)
            return
        if not settings.demo_fixtures and self.engine.is_demo:
            # Real mode must never serve fixture corpora.
            self.error = "real mode refused a corpus marked is_demo=true"
            self.engine = None
            log.error(self.error)

    @property
    def ready(self) -> bool:
        return self.engine is not None

    def _require(self) -> SearchEngine:
        if self.engine is None:
            raise DataUnavailableError(f"search corpus not available: {self.error}")
        return self.engine

    @property
    def corpus_version(self) -> str | None:
        return self.engine.corpus_version if self.engine else None

    def search(self, reference_id: str, profile: str, slope_weight: float | None, top_k: int = 3) -> dict:
        return self._require().search(reference_id, profile, slope_weight, top_k)

    def compare(self, reference_id: str, selected_id: str, alternative_id: str | None,
                profile: str, slope_weight: float | None) -> dict:
        return self._require().compare(reference_id, selected_id, alternative_id, profile, slope_weight)

    def sensitivity(self, reference_id: str, profile: str, slope_weight: float | None) -> dict:
        return self._require().sensitivity(reference_id, profile, slope_weight)

    def parents_count(self) -> int:
        return len(self._require().parents)
