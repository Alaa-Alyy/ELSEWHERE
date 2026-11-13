"""Load and validate the small processed JSON registries once at startup (read-only indexes)."""
from __future__ import annotations

import json
import logging
import math
from pathlib import Path

from .config import Settings

log = logging.getLogger("missionmatch.data")

SCHEMA_VERSION = "2.0"
PIPELINE_VERSION = "2.0"
SOURCE_FIELDS = ("id", "title", "agency", "product", "version", "landing_url", "download_url",
                 "downloaded_at_utc", "filename", "sha256", "units", "native_resolution",
                 "native_crs_wkt", "citation", "license_or_usage_notes")


def read_json(path: Path) -> dict:
    with open(path, encoding="utf-8-sig") as f:  # tolerate BOM written by Windows tools
        return json.load(f)


def _finite_metrics(m: dict | None) -> bool:
    if not m:
        return False
    h = m.get("slope_histogram")
    vals = [m.get("relief_p95_p05_m"), m.get("local_variation_m")]
    if h is None or len(h) != 8 or any(v is None for v in vals):
        return False
    nums = list(h) + vals
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in nums) and abs(sum(h) - 1.0) < 1e-6


class DataRepository:
    """Registries for references, parents, candidates and sources. Never mixes demo into real mode."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.demo = settings.demo_fixtures
        self.problems: list[str] = []
        self.references: dict[str, dict] = {}
        self.parents: dict[str, dict] = {}
        self.candidates: dict[str, dict] = {}
        self.sources: dict[str, dict] = {}
        self._load()

    # ----------------------------------------------------------------- loading
    def _load_items(self, name: str) -> list[dict]:
        p = self.settings.corpus_dir / name
        if not p.exists():
            self.problems.append(f"{name} missing in {p.parent.name}/")
            return []
        doc = read_json(p)
        if doc.get("schema_version") != SCHEMA_VERSION:
            self.problems.append(f"{name}: schema_version {doc.get('schema_version')!r} != 2.0")
            return []
        return doc.get("items", [])

    def _load(self) -> None:
        for rec in self._load_items("references.json"):
            self._check_record(rec, "reference")
            self.references[rec["id"]] = rec
        for rec in self._load_items("parents.json"):
            self.parents[rec["id"]] = rec
        for rec in self._load_items("candidates.json"):
            self._check_record(rec, "candidate")
            self.candidates[rec["id"]] = rec

        for p in sorted(self.settings.sources_dir.glob("*_sources.json")):
            for s in read_json(p).get("items", []):
                self.sources[s["id"]] = {k: s.get(k, "unknown") for k in SOURCE_FIELDS}

        if self.demo:
            # Fixture corpora cite synthetic source IDs; register them explicitly as DEMO entries.
            used = {sid for r in self.all_records() for sid in r.get("source_ids", [])}
            for sid in sorted(used - set(self.sources)):
                self.sources[sid] = {k: "unknown" for k in SOURCE_FIELDS} | {
                    "id": sid, "title": f"DEMO synthetic fixture ({sid}) - not a real data source",
                    "agency": "MissionMatch demo", "product": "synthetic", "version": "demo",
                    "landing_url": None, "download_url": None,
                    "license_or_usage_notes": "Synthetic interface-test data; not a measurement.",
                }
        else:
            demo_recs = [r["id"] for r in self.all_records() if r.get("analysis", {}).get("is_demo")]
            if demo_recs:
                self.problems.append(f"real mode refuses is_demo records: {demo_recs[:3]}...")
                # drop them: real mode must never serve fixtures
                for store in (self.references, self.parents, self.candidates):
                    for rid in [k for k, v in store.items() if v.get("analysis", {}).get("is_demo")]:
                        del store[rid]
        unknown = {sid for r in self.all_records() for sid in r.get("source_ids", [])} - set(self.sources)
        if unknown:
            self.problems.append(f"source_ids not in registry: {sorted(unknown)[:5]}")
        for msg in self.problems:
            log.warning("data: %s", msg)

    def _check_record(self, rec: dict, kind: str) -> None:
        a = rec.get("analysis", {})
        if a.get("pipeline_version") != PIPELINE_VERSION:
            self.problems.append(f"{rec.get('id')}: pipeline_version {a.get('pipeline_version')!r}")
        if a.get("status") == "valid" and not _finite_metrics(rec.get("metrics")):
            self.problems.append(f"{rec.get('id')}: status valid but metrics not finite/complete")
        if kind == "candidate" and rec.get("footprint", {}).get("type") != "Polygon":
            self.problems.append(f"{rec.get('id')}: missing Polygon footprint")

    # ----------------------------------------------------------------- queries
    def all_records(self) -> list[dict]:
        return [*self.references.values(), *self.parents.values(), *self.candidates.values()]

    def sources_for(self, ids) -> list[dict]:
        return [self.sources[i] for i in ids if i in self.sources]

    @property
    def references_valid(self) -> bool:
        return bool(self.references) and all(
            r["analysis"].get("status") == "valid" and _finite_metrics(r.get("metrics")) for r in self.references.values())

    @property
    def corpus_present(self) -> bool:
        return len(self.parents) == 3 and len(self.candidates) > 0
