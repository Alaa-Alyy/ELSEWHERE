"""Validate a processed corpus against the v2.0 contract and acceptance gates.

  python -m analysis.validate_outputs            # data/processed (real)
  python -m analysis.validate_outputs --demo     # data/processed/demo
Exit code 0 = all checks passed.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

from . import config as C
from .build_candidates import corpus_digest
from .search import SearchEngine, component_distances, feature_vector, geodesic_km, terrain_distance, SearchError

ID_RE = re.compile(r"^(earth-[a-z-]+)-r(\d{2})-c(\d{2})$")
SOURCE_FIELDS = ["id", "title", "agency", "product", "version", "landing_url", "download_url", "downloaded_at_utc",
                 "filename", "sha256", "units", "native_resolution", "native_crs_wkt", "citation",
                 "license_or_usage_notes"]


def _strict_load(path: Path):
    def bad(x):
        raise ValueError(f"{path.name}: non-standard JSON constant {x}")
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=bad)


def validate(data_dir: Path, demo: bool) -> list[str]:
    errors: list[str] = []
    err = errors.append
    files = {n: _strict_load(data_dir / f"{n}.json") for n in ("parents", "candidates", "references", "search_manifest")}
    for n in ("parents", "candidates", "references"):
        if files[n].get("schema_version") != "2.0":
            err(f"{n}.json schema_version != 2.0")
    sm = files["search_manifest"]
    for k in ("schema_version", "pipeline_version", "score_version"):
        if sm.get(k) != "2.0":
            err(f"search_manifest {k} != 2.0")
    parents, cands, refs = files["parents"]["items"], files["candidates"]["items"], files["references"]["items"]

    # identity, counts, records
    by_parent: dict[str, list] = {}
    for c in cands:
        m = ID_RE.match(c["id"])
        if not m or m.group(1) != c["parent_id"]:
            err(f"bad candidate id {c['id']}")
        by_parent.setdefault(c["parent_id"], []).append(c)
        if c["kind"] != "candidate" or c["body"] != "earth":
            err(f"{c['id']}: kind/body")
        if c["analysis"]["is_demo"] != demo:
            err(f"{c['id']}: is_demo={c['analysis']['is_demo']} in {'demo' if demo else 'real'} corpus")
        st = c["analysis"]["status"]
        if st == "valid":
            if feature_vector(c["metrics"]) is None:
                err(f"{c['id']}: valid but metrics not finite")
            else:
                h = c["metrics"]["slope_histogram"]
                if abs(sum(h) - 1) > 1e-9 or min(h) < 0:
                    err(f"{c['id']}: histogram does not sum to 1")
            if c["analysis"]["valid_fraction"] < C.MIN_VALID_FRACTION:
                err(f"{c['id']}: valid with valid_fraction < {C.MIN_VALID_FRACTION}")
        elif st == "invalid":
            if not c["analysis"].get("reasons"):
                err(f"{c['id']}: invalid without reasons")
        else:
            err(f"{c['id']}: status {st}")
        ring = c["footprint"]["coordinates"][0]
        if ring[0] != ring[-1] or not all(-180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in ring):
            err(f"{c['id']}: footprint ring not closed/WGS84")
    for p in parents:
        got = by_parent.get(p["id"], [])
        if len(got) != C.PLANNED_WINDOWS_PER_PARENT:
            err(f"{p['id']}: {len(got)} windows, expected {C.PLANNED_WINDOWS_PER_PARENT}")
        if p["metrics"] is not None or p["kind"] != "parent" or p["analysis"]["window_size_km"] != 100:
            err(f"{p['id']}: parent record shape")
        if p.get("windows", {}).get("planned") != len(got):
            err(f"{p['id']}: windows.planned mismatch")
    if sm["planned_windows"] != len(cands) or sm["valid_windows"] != sum(c["analysis"]["status"] == "valid" for c in cands):
        err("search_manifest window counts disagree with candidates.json")
    for r in refs:
        if r["kind"] != "reference" or r["body"] not in ("moon", "mars"):
            err(f"{r['id']}: reference kind/body")
        if r["analysis"]["window_size_km"] != C.WINDOW_SIZE_CELLS * C.RESOLUTION_M / 1000:
            err(f"{r['id']}: reference window size differs from candidates")
        if r["analysis"]["status"] == "valid" and r["analysis"]["is_demo"] != demo:
            err(f"{r['id']}: is_demo mismatch")

    # sources resolve
    if not demo:
        src = C.load_sources()
        for s in src.values():
            missing = [f for f in SOURCE_FIELDS if s.get(f) in (None, "")]
            if missing:
                err(f"source {s.get('id')}: missing {missing}")
        for rec in parents + cands + refs:
            for sid in rec["source_ids"]:
                if sid not in src:
                    err(f"{rec['id']}: source {sid} not in data/sources/*_sources.json")
        for r in refs:
            if r["analysis"]["status"] == "valid" and not r["source_ids"]:
                err(f"{r['id']}: valid reference without source_ids")
    for rec in parents + cands + refs:
        url = rec.get("preview_url")
        if url:
            if not url.startswith("/assets/previews/"):
                err(f"{rec['id']}: preview_url not an approved relative asset URL")
            elif not (data_dir / "previews" / url.rsplit("/", 1)[1]).exists():
                err(f"{rec['id']}: preview file missing")
    for p in parents:
        if not (data_dir / "manifests" / f"{p['id']}.json").exists():
            err(f"{p['id']}: manifest missing")

    # digest reproducibility
    inputs = []
    for m in (data_dir / "manifests").glob("*.json"):
        inputs += [f"{i.get('source_id')}:{i.get('sha256')}" for i in _strict_load(m).get("inputs", [])]
    if corpus_digest(parents, cands, refs, inputs) != sm["corpus_version"]:
        err("corpus_version digest does not match recomputation")

    # retrieval gates per valid reference
    eng = SearchEngine(data_dir)
    for r in refs:
        if r["analysis"]["status"] != "valid":
            continue
        q = feature_vector(r["metrics"])
        for profile in C.PROFILES:
            try:
                res = eng.search(r["id"], profile)
            except SearchError as exc:
                err(f"search {r['id']}/{profile}: {exc}")
                continue
            w = C.PROFILES[profile]
            brute = sorted((terrain_distance(eng.X[i], q, w), cid) for i, cid in enumerate(eng.ids))
            if [cid for _, cid in eng.ranked(r["id"], w)] != [cid for _, cid in brute]:
                err(f"{r['id']}/{profile}: NearestNeighbors order differs from brute force")
            items = res["items"]
            for it in items:
                if not (math.isfinite(it["score"]) and 0 <= it["score"] <= 100):
                    err(f"{it['candidate_id']}: score out of range")
                x = eng.X[eng.ids.index(it["candidate_id"])]
                d = component_distances(x, q)
                if not np.allclose(d, [it["distances"][k] for k in ("slope", "relief", "variation")]):
                    err(f"{it['candidate_id']}: distances mismatch")
            for i in range(len(items)):
                for j in range(i):
                    if geodesic_km(eng.candidates[items[i]["candidate_id"]]["center"],
                                   eng.candidates[items[j]["candidate_id"]]["center"]) < C.MIN_CENTER_DISTANCE_KM:
                        err(f"{r['id']}/{profile}: results closer than {C.MIN_CENTER_DISTANCE_KM} km")
            if res["scope"]["returned_windows"] != len(items) or res["scope"]["valid_windows"] != len(eng.ids):
                err(f"{r['id']}/{profile}: scope counts disagree")
            if len(items) < 3 and not res["warnings"]:
                err(f"{r['id']}/{profile}: fewer than 3 results without warning")
    return errors


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--data-dir", type=Path, default=None)
    a = ap.parse_args(argv)
    d = a.data_dir or (C.DEMO_DIR if a.demo else C.PROCESSED_DIR)
    if not (d / "search_manifest.json").exists():
        sys.exit(f"no corpus in {d}; build it first")
    errs = validate(d, a.demo)
    if errs:
        print(f"FAILED: {len(errs)} problem(s)")
        for e in errs[:50]:
            print("  -", e)
        sys.exit(1)
    print(f"OK: {d} passes v2.0 contract checks")


if __name__ == "__main__":
    main()
