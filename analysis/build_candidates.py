"""Build Earth parents, 81 candidate windows per parent, references and the searchable corpus.

CLI (run from the repository root):
  python -m analysis.build_candidates --demo     # synthetic, is_demo=true -> data/processed/demo/
  python -m analysis.build_candidates            # real SRTM tiles under data/raw/earth/<parent_id>/
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import platform
import sys
from pathlib import Path

import numpy as np
from pyproj import Transformer

from . import config as C
from . import preprocess as P
from .extract_features import TerrainSurface, extract_reference, write_json, reference_limitations


# ---------------------------------------------------------------------------- helpers
def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def candidate_id(parent_id: str, row: int, col: int) -> str:
    return f"{parent_id}-r{row:02d}-c{col:02d}"


def square_footprint(body: str, lat: float, lon: float, cx: float, cy: float, size_m: float, densify: int = 4) -> dict:
    """GeoJSON Polygon ([lon, lat]) of a size_m square centred at local metric (cx, cy)."""
    h = size_m / 2.0
    corners = [(-h, h), (-h, -h), (h, -h), (h, h)]   # NW, SW, SE, NE: counter-clockwise (RFC 7946)
    pts = []
    for k in range(4):
        (x0, y0), (x1, y1) = corners[k], corners[(k + 1) % 4]
        for t in np.arange(densify) / densify:
            pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    xs = np.array([p[0] for p in pts]) + cx
    ys = np.array([p[1] for p in pts]) + cy
    tr = Transformer.from_crs(P.local_aeqd_crs(body, lat, lon), P.geographic_crs(body), always_xy=True)
    lons, lats = tr.transform(xs, ys)
    ring = [[round(float(a), 7), round(float(b), 7)] for a, b in zip(lons, lats)]
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def local_to_lonlat(body: str, lat: float, lon: float, x: float, y: float) -> tuple[float, float]:
    tr = Transformer.from_crs(P.local_aeqd_crs(body, lat, lon), P.geographic_crs(body), always_xy=True)
    a, b = tr.transform(x, y)
    return float(a), float(b)


def tile_bbox(tile: str) -> tuple[float, float, float, float]:
    la, lo = P.parse_hgt_tile(tile)
    return lo, la, lo + 1, la + 1


def candidate_limitations() -> list[str]:
    return [
        "Closest available window within a limited 3-parent corpus, not a global best or validated analog.",
        "Kilometre-scale (1000 m) terrain statistics only; local variation is not rock/grain roughness.",
        "Overlapping windows are correlated samples, not independent observations.",
        "Soil, temperature, biology, gravity, radiation, access and permits are not established by terrain data.",
        "Not a rover-safe route or landing-safety assessment; field suitability is unknown.",
    ]


# ---------------------------------------------------------------------------- previews
def hillshade_rgb(z: np.ndarray, valid: np.ndarray, cell_m: float = C.RESOLUTION_M) -> np.ndarray:
    zz = np.where(valid, z, np.nanmean(z[valid]) if valid.any() else 0.0)
    gy, gx = np.gradient(zz, cell_m)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(315.0), np.radians(45.0)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(shade, 0, 1)
    lo, hi = (np.nanpercentile(z[valid], [2, 98]) if valid.any() else (0, 1))
    tint = np.clip((zz - lo) / max(hi - lo, 1e-9), 0, 1)
    base = np.stack([0.55 + 0.4 * tint, 0.45 + 0.3 * tint, 0.35 + 0.15 * tint], axis=-1)
    rgb = base * (0.35 + 0.65 * shade[..., None])
    rgb[~valid] = [0.85, 0.1, 0.6]   # voids shown in magenta, never hidden
    return (np.clip(rgb, 0, 1) * 255).astype(np.uint8)


def save_preview(path: Path, rgb: np.ndarray, scale: int, grid_lines: list | None = None) -> None:
    from PIL import Image, ImageDraw
    img = Image.fromarray(rgb).resize((rgb.shape[1] * scale, rgb.shape[0] * scale), Image.NEAREST)
    if grid_lines:
        d = ImageDraw.Draw(img)
        for (r0, c0, size, color) in grid_lines:
            d.rectangle([c0 * scale, r0 * scale, (c0 + size) * scale - 1, (r0 + size) * scale - 1],
                        outline=color, width=1)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)


# ---------------------------------------------------------------------------- Earth parents
def load_earth_sources() -> dict:
    if not C.EARTH_SOURCES_JSON.exists():
        return {}
    return {s["id"]: s for s in json.loads(C.EARTH_SOURCES_JSON.read_text(encoding="utf-8"))["items"]}


def tile_of(filename: str) -> str:
    m = P.HGT_RE.search(Path(filename).name)
    if not m:
        raise P.PreprocessError(f"not an SRTM tile filename: {filename}")
    return m.group(0).upper()


def regrid_earth_parent(parent: dict):
    """Area-average every SRTM tile recorded for this parent into the buffered 1000 m parent grid.

    Tiles come from data/sources/earth_sources.json (parent_id, filename, sha256). Every tile that
    the projected parent+buffer footprint touches must be present and hash-verified.
    """
    recs = [s for s in load_earth_sources().values() if s.get("parent_id") == parent["id"]]
    lat, lon = parent["center"]["lat"], parent["center"]["lon"]
    grid = P.GridSpec(size_cells=C.PARENT_SIZE_CELLS)
    required = set(P.srtm_tiles_for_bbox(P.required_geographic_bbox("earth", lat, lon, grid)))
    have = {tile_of(r["filename"]): r for r in recs}
    not_recorded = sorted(required - set(have))
    if not_recorded:
        raise P.PreprocessError(f"{parent['id']}: footprint needs SRTM tiles with no SourceRecord: {not_recorded}")
    crs = P.local_aeqd_crs("earth", lat, lon)
    acc = P.Accumulator(grid)
    used, missing = [], []
    for tile, rec in sorted(have.items()):
        path = C.REPO_ROOT / rec["filename"]
        if not path.exists():
            missing.append(rec["filename"])
            continue
        digest = sha256_file(path)
        if digest != rec["sha256"]:
            raise P.PreprocessError(f"{path.name}: sha256 mismatch with earth_sources.json")
        src = P.read_srtm_hgt(path)
        n = P.accumulate_source(src, crs, acc)
        used.append({"source_id": rec["id"], "filename": rec["filename"], "sha256": digest,
                     "samples_binned": n, "tile": tile, "required_by_footprint": tile in required})
    if missing:
        raise P.PreprocessError(f"{parent['id']}: SRTM tiles not on disk (run scripts/fetch_data.py earth "
                                f"or copy data/raw/ from the team Drive): {missing}")
    return acc.finalize(), grid, crs, used, []


def build_parent(parent: dict, regridded=None, is_demo: bool = False, previews_dir: Path | None = None,
                 source_tiles: list | None = None):
    """Returns (parent_record, candidate_records, manifest) for one 100 km Earth parent."""
    lat, lon = parent["center"]["lat"], parent["center"]["lon"]
    if regridded is None:
        rg, grid, crs, used, no_granule = regrid_earth_parent(parent)
    else:
        rg, grid, crs = regridded
        used, no_granule = [{"source_id": s, "filename": None, "sha256": None, "tile": None}
                            for s in (source_tiles or [])], []
    surf = TerrainSurface(rg.elevation, rg.valid, rg.all_zero)
    b, W, S = grid.buffer_cells, C.WINDOW_SIZE_CELLS, C.STRIDE_CELLS
    interior = (slice(b, b + C.PARENT_SIZE_CELLS),) * 2
    parent_valid_fraction = float(rg.valid[interior].mean())
    candidates, rejected = [], []
    tile_boxes = {u["source_id"]: tile_bbox(u["tile"]) for u in used if u.get("tile")}
    for wr in range(C.WINDOWS_PER_AXIS):
        for wc in range(C.WINDOWS_PER_AXIS):
            cid = candidate_id(parent["id"], wr, wc)
            r0, c0 = b + wr * S, b + wc * S
            wm = surf.window_metrics(r0, c0, W, check_water=True)
            cx = -C.PARENT_SIZE_CELLS * C.RESOLUTION_M / 2 + (wc * S + W / 2) * C.RESOLUTION_M
            cy = C.PARENT_SIZE_CELLS * C.RESOLUTION_M / 2 - (wr * S + W / 2) * C.RESOLUTION_M
            clon, clat = local_to_lonlat("earth", lat, lon, cx, cy)
            fp = square_footprint("earth", lat, lon, cx, cy, W * C.RESOLUTION_M)
            ring = np.asarray(fp["coordinates"][0])
            w_, s_, e_, n_ = ring[:, 0].min() - 0.01, ring[:, 1].min() - 0.01, ring[:, 0].max() + 0.01, ring[:, 1].max() + 0.01
            src_ids = sorted(sid for sid, (tw, ts, te, tn) in tile_boxes.items()
                             if tw < e_ and te > w_ and ts < n_ and tn > s_) if tile_boxes else \
                sorted(u["source_id"] for u in used)
            rec = {
                "schema_version": C.SCHEMA_VERSION, "id": cid, "body": "earth", "kind": "candidate",
                "parent_id": parent["id"],
                "name": f"{'[DEMO] ' if is_demo else ''}{parent['name']} window r{wr:02d}-c{wc:02d}",
                "center": {"lat": round(clat, 7), "lon": round(clon, 7)},
                "footprint": fp,
                "coordinate_convention": "WGS84 geographic (EPSG:4326); GeoJSON [longitude, latitude]",
                "source_ids": src_ids,
                "preview_url": f"/assets/previews/{cid}.png" if previews_dir else None,
                "limitations": candidate_limitations(),
                "analysis": {"pipeline_version": C.PIPELINE_VERSION, "resolution_m": int(C.RESOLUTION_M),
                             "window_size_km": W * C.RESOLUTION_M / 1000, "valid_fraction": wm["valid_fraction"],
                             "status": wm["status"], "is_demo": is_demo, "reasons": wm["reasons"]},
                "metrics": wm["metrics"],
                "grid": {"row": wr, "col": wc, "row_offset_cells": wr * S, "col_offset_cells": wc * S,
                         "center_local_m": [cx, cy], "analysis_crs": crs.srs},
            }
            candidates.append(rec)
            if wm["status"] != "valid":
                rejected.append({"candidate_id": cid, "reasons": wm["reasons"]})
            if previews_dir:
                sl = (slice(r0, r0 + W), slice(c0, c0 + W))
                save_preview(previews_dir / f"{cid}.png", hillshade_rgb(rg.elevation[sl], rg.valid[sl]), 8)
    if previews_dir:
        lines = [(b + c["grid"]["row_offset_cells"], b + c["grid"]["col_offset_cells"], W,
                  (255, 255, 255) if c["analysis"]["status"] == "valid" else (255, 0, 0)) for c in candidates]
        save_preview(previews_dir / f"{parent['id']}.png", hillshade_rgb(rg.elevation, rg.valid), 4, lines)
    n_valid = len(candidates) - len(rejected)
    parent_rec = {
        "schema_version": C.SCHEMA_VERSION, "id": parent["id"], "body": "earth", "kind": "parent",
        "name": f"{'[DEMO] ' if is_demo else ''}{parent['name']}",
        "center": {"lat": lat, "lon": lon},
        "footprint": square_footprint("earth", lat, lon, 0, 0, C.PARENT_SIZE_CELLS * C.RESOLUTION_M, densify=10),
        "coordinate_convention": "WGS84 geographic (EPSG:4326); GeoJSON [longitude, latitude]",
        "source_ids": sorted({u["source_id"] for u in used}),
        "preview_url": f"/assets/previews/{parent['id']}.png" if previews_dir else None,
        "limitations": ["Parent coverage only; searchable units are the 20 km candidate windows.",
                        f"Centre is a {parent.get('center_status', 'planning seed')}, not a validated analog site."],
        "analysis": {"pipeline_version": C.PIPELINE_VERSION, "resolution_m": int(C.RESOLUTION_M),
                     "window_size_km": C.PARENT_SIZE_CELLS * C.RESOLUTION_M / 1000,
                     "valid_fraction": parent_valid_fraction,
                     "status": "valid" if n_valid > 0 else "invalid", "is_demo": is_demo,
                     "reasons": [] if n_valid > 0 else ["no valid candidate windows"]},
        "metrics": None,
        "windows": {"planned": len(candidates), "valid": n_valid, "rejected": len(rejected)},
    }
    interior_valid = rg.valid[interior]
    manifest = {
        "schema_version": C.SCHEMA_VERSION, "pipeline_version": C.PIPELINE_VERSION,
        "region_id": parent["id"], "kind": "parent", "body": "earth", "is_demo": is_demo,
        "center": parent["center"], "center_status": parent.get("center_status"),
        "inputs": used, "tiles_without_granule": no_granule,
        "source_product": None if is_demo else {k: C.SRTM[k] for k in
                                                ("short_name", "version", "units", "scale", "offset",
                                                 "void_value", "vertical_datum", "native_resolution")},
        "native_crs_wkt": None if is_demo else P.geographic_crs("earth").to_wkt(),
        "analysis_crs_wkt": crs.to_wkt(), "analysis_crs_proj4": crs.srs,
        "body_figure": C.BODY_FIGURES["earth"]["description"],
        "resampling": "area average by source-pixel-centre binning into 1000 m cells; "
                      f"cell valid if valid samples >= {C.MIN_CELL_SAMPLE_FRACTION} x nominal; "
                      "duplicate HGT edge row/column excluded; no gap filling",
        "buffer_cells": grid.buffer_cells, "grid_cells": grid.n,
        "grid_definition": "row 0 = north edge of buffered grid, rows increase southward, cols increase eastward",
        "regrid_stats": rg.stats,
        "coverage": {"interior_cells": int(interior_valid.size), "interior_valid_cells": int(interior_valid.sum()),
                     "interior_valid_fraction": parent_valid_fraction},
        "elevation_range_valid_interior_m": (
            [float(np.nanmin(rg.elevation[interior])), float(np.nanmax(rg.elevation[interior]))]
            if interior_valid.any() else None),
        "windows": {"planned": len(candidates), "accepted": n_valid, "rejected": rejected},
        "settings": C.frozen_settings(),
    }
    return parent_rec, candidates, manifest


def build_candidates(parent_config: dict) -> list[dict]:
    """Contract interface: CandidateRecords for one real Earth parent (no previews)."""
    return build_parent(parent_config)[1]


# ---------------------------------------------------------------------------- corpus
def corpus_digest(parents, candidates, references, inputs) -> str:
    payload = {
        "settings": C.frozen_settings(),
        "parents": [{"id": p["id"], "center": p["center"], "status": p["analysis"]["status"]} for p in parents],
        "candidates": [{"id": c["id"], "center": c["center"], "status": c["analysis"]["status"],
                        "metrics": c["metrics"]} for c in candidates],
        "references": [{"id": r["id"], "center": r["center"], "status": r["analysis"]["status"],
                        "metrics": r["metrics"]} for r in references],
        "inputs": sorted(inputs),
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return "sha256:" + hashlib.sha256(blob.encode()).hexdigest()


def pending_reference(ref: dict, is_demo: bool = False) -> dict:
    return {
        "schema_version": C.SCHEMA_VERSION, "id": ref["id"], "body": ref["body"], "kind": "reference",
        "name": ref.get("name", ref["id"]),
        "center": {"lat": ref.get("center", {}).get("lat"), "lon": ref.get("center", {}).get("lon")},
        "footprint": None, "coordinate_convention": None, "source_ids": list(ref.get("source_ids", [])),
        "preview_url": None, "limitations": reference_limitations(),
        "analysis": {"pipeline_version": C.PIPELINE_VERSION, "resolution_m": int(C.RESOLUTION_M),
                     "window_size_km": C.WINDOW_SIZE_CELLS * C.RESOLUTION_M / 1000, "valid_fraction": None,
                     "status": "pending", "is_demo": is_demo,
                     "reasons": [ref.get("pending_reason", "reference elevation data not yet handed off")]},
        "metrics": {"slope_histogram": None, "relief_p95_p05_m": None, "local_variation_m": None},
    }


def write_corpus(out_dir: Path, parents, candidates, references, manifests, is_demo: bool) -> dict:
    env = {"python": sys.version.split()[0], "platform": platform.platform(), "numpy": np.__version__}
    for mod in ("scipy", "sklearn", "pyproj"):
        try:
            env[mod] = __import__(mod).__version__
        except Exception:  # pragma: no cover
            env[mod] = "unavailable"
    inputs = [f"{i.get('source_id')}:{i.get('sha256')}" for m in manifests for i in m.get("inputs", [])]
    digest = corpus_digest(parents, candidates, references, inputs)
    write_json(out_dir / "parents.json", {"schema_version": C.SCHEMA_VERSION, "items": parents})
    write_json(out_dir / "candidates.json", {"schema_version": C.SCHEMA_VERSION, "items": candidates})
    write_json(out_dir / "references.json", {"schema_version": C.SCHEMA_VERSION, "items": references})
    for m in manifests:
        write_json(out_dir / "manifests" / f"{m['region_id']}.json", {**m, "environment": env})
    valid = [c for c in candidates if c["analysis"]["status"] == "valid"]
    sm = {
        "schema_version": C.SCHEMA_VERSION, "pipeline_version": C.PIPELINE_VERSION, "score_version": C.SCORE_VERSION,
        "corpus_version": digest, "is_demo": is_demo,
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "parents": [p["id"] for p in parents],
        "planned_windows": len(candidates), "valid_windows": len(valid),
        "rejected_windows": len(candidates) - len(valid),
        "references": {r["id"]: r["analysis"]["status"] for r in references},
        "distance": {"vector": "[8 slope-histogram probabilities, relief_p95_p05_m, local_variation_m]",
                     "d_slope": "0.5*sum|p_i-q_i|",
                     "d_relief": "|r_e-r_t|/max(|r_e|,|r_t|,1.0)",
                     "d_variation": "|v_e-v_t|/max(|v_e|,|v_t|,1.0)",
                     "D": "w*d_slope + ((1-w)/2)*(d_relief+d_variation)", "score": "100*(1-D)",
                     "profiles": C.PROFILES, "retrieval": "sklearn NearestNeighbors(algorithm='brute', metric=callable)",
                     "diversity": f"greedy, geodesic WGS84 centre separation >= {C.MIN_CENTER_DISTANCE_KM} km"},
        "settings": C.frozen_settings(), "environment": env,
        "score_meaning": ("Heuristic similarity of kilometre-scale terrain statistics within this limited corpus; "
                          "not a probability, not calibrated, no universal strong-match threshold."),
    }
    write_json(out_dir / "search_manifest.json", sm)
    return sm


# ---------------------------------------------------------------------------- demo fixtures
def synthetic_dem(kind: str, n: int, seed: int) -> np.ndarray:
    """Deterministic synthetic terrain (metres) for demo fixtures only."""
    from scipy.ndimage import gaussian_filter
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    z = gaussian_filter(rng.normal(0, 1, (n, n)), 6) * 400
    if kind in ("volcanic", "moon"):
        for _ in range(12 if kind == "moon" else 6):
            cy, cx, r = rng.uniform(0, n), rng.uniform(0, n), rng.uniform(3, 12)
            d = np.hypot(yy - cy, xx - cx) / r
            z += np.where(d < 1, -250 * (1 - d ** 2), 60 * np.exp(-((d - 1) ** 2) * 8))
    if kind == "basin":
        z += 4.0 * (yy - n / 2) + 1500 * np.exp(-((xx - n * 0.7) ** 2) / (2 * (n / 6) ** 2))
    if kind == "mars":
        z += 2.0 * xx + gaussian_filter(rng.normal(0, 1, (n, n)), 2) * 60
    return z + 500.0


def build_demo(out_dir: Path = C.DEMO_DIR) -> dict:
    regions = C.load_regions()
    previews = out_dir / "previews"
    parents, candidates, manifests = [], [], []
    kinds = {"earth-khaybar": ("volcanic", 11), "earth-pinacate": ("volcanic", 12), "earth-death-valley": ("basin", 13)}
    for pcfg in regions["parents"]:
        kind, seed = kinds.get(pcfg["id"], ("volcanic", 99))
        grid = P.GridSpec(size_cells=C.PARENT_SIZE_CELLS)
        z = synthetic_dem(kind, grid.n, seed)
        valid = np.ones_like(z, dtype=bool)
        if pcfg["id"] == "earth-pinacate":
            valid[10:25, 70:90] = False          # synthetic void -> some windows rejected
        rg = P.RegriddedGrid(np.where(valid, z, np.nan), valid, np.zeros_like(valid), 1000.0,
                             {"note": "synthetic demo grid; no source data"})
        crs = P.local_aeqd_crs("earth", pcfg["center"]["lat"], pcfg["center"]["lon"])
        pr, cands, man = build_parent(pcfg, (rg, grid, crs), is_demo=True, previews_dir=previews,
                                      source_tiles=[f"demo-synthetic-{pcfg['id']}"])
        parents.append(pr); candidates.extend(cands); manifests.append(man)
    references = []
    demo_kinds = {"moon": ("moon", 21), "mars": ("mars", 22)}
    for rcfg in regions["references"]:
        lat, lon = rcfg["center"]["lat"], rcfg["center"]["lon"]
        kind, seed = demo_kinds[rcfg["body"]]
        grid = P.GridSpec(size_cells=C.WINDOW_SIZE_CELLS)
        z = synthetic_dem(kind, grid.n, seed)
        v = np.ones_like(z, dtype=bool)
        rg = P.RegriddedGrid(z, v, np.zeros_like(v), 1000.0, {"note": "synthetic demo grid; no source data"})
        cfg = {**rcfg, "name": f"[DEMO] {rcfg['name']}", "center": {"lat": lat, "lon": lon},
               "source_ids": [f"demo-synthetic-{rcfg['id']}"]}
        rec, man = extract_reference(cfg, is_demo=True,
                                     regridded=(rg, grid, P.local_aeqd_crs(rcfg["body"], lat, lon)),
                                     previews_dir=previews)
        references.append(rec); manifests.append(man)
    sm = write_corpus(out_dir, parents, candidates, references, manifests, is_demo=True)
    write_examples(out_dir)
    return sm


def write_examples(out_dir: Path) -> None:
    """Request/response examples for Persons 2/3, generated from the demo corpus itself."""
    from .search import SearchEngine
    eng = SearchEngine(out_dir)
    r = eng.search("mars-jezero", "terrain_general")
    sel, alt = r["items"][0]["candidate_id"], (r["items"][1]["candidate_id"] if len(r["items"]) > 1 else None)
    ex = {"_note": "DEMO fixture outputs (is_demo=true, synthetic terrain). Shapes are real; numbers are not science.",
          "ranking_request": {"fn": "SearchEngine.search", "reference_id": "mars-jezero",
                              "profile": "terrain_general", "slope_weight": None, "top_k": 3},
          "ranking_response": r,
          "ranking_response_slope_weight_0": eng.search("mars-jezero", "terrain_general", slope_weight=0.0),
          "compare_request": {"fn": "SearchEngine.compare", "reference_id": "mars-jezero",
                              "selected_candidate_id": sel, "alternative_candidate_id": alt},
          "compare_response": eng.compare("mars-jezero", sel, alt, "terrain_general"),
          "sensitivity_response": eng.sensitivity("mars-jezero", "terrain_general"),
          "error_examples": {"unknown_reference_404": {"error": {"code": "not_found",
                                                               "message": "unknown reference_id 'venus'",
                                                               "retryable": False}},
                             "pending_reference_503": {"error": {"code": "data_unavailable",
                                                                 "message": "reference ... is pending: ...",
                                                                 "retryable": True}}}}
    write_json(out_dir / "example_responses.json", ex)


def build_real(out_dir: Path = C.PROCESSED_DIR, references_only: bool = False) -> dict:
    regions = C.load_regions()
    previews = out_dir / "previews"
    parents, candidates, manifests, problems = [], [], [], []
    for pcfg in ([] if references_only else regions["parents"]):
        try:
            pr, cands, man = build_parent(pcfg, previews_dir=previews)
        except P.PreprocessError as exc:
            problems.append(f"{pcfg['id']}: {exc}")
            print(f"[skip] {pcfg['id']}: {exc}")
            continue
        parents.append(pr); candidates.extend(cands); manifests.append(man)
        print(f"[ok] {pcfg['id']}: {pr['windows']}")
    references = []
    for rcfg in regions["references"]:
        try:
            rec, man = extract_reference(rcfg, previews_dir=previews)
            references.append(rec); manifests.append(man)
            print(f"[ok] {rcfg['id']}: {rec['analysis']['status']} {rec['analysis']['reasons']}")
        except P.PreprocessError as exc:
            references.append(pending_reference({**rcfg, "pending_reason": str(exc)}))
            print(f"[pending] {rcfg['id']}: {exc}")
    if references_only:
        return write_references_only(out_dir, references, manifests)
    if not parents:
        raise SystemExit("no Earth parent could be processed:\n  " + "\n  ".join(problems))
    sm = write_corpus(out_dir, parents, candidates, references, manifests, is_demo=False)
    if problems:
        print("WARNING: corpus is partial:\n  " + "\n  ".join(problems))
    return sm


def write_references_only(out_dir: Path, references, manifests) -> dict:
    """Early handoff: real references.json + manifests + previews, no Earth corpus.

    parents/candidates/search_manifest are deliberately NOT written, so search() keeps answering
    503 data_unavailable instead of ranking against an empty or stale corpus.
    """
    write_json(out_dir / "references.json", {"schema_version": C.SCHEMA_VERSION, "items": references})
    for m in manifests:
        write_json(out_dir / "manifests" / f"{m['region_id']}.json", m)
    return {"corpus_version": None, "is_demo": False, "planned_windows": 0, "valid_windows": 0,
            "rejected_windows": 0, "references": {r["id"]: r["analysis"]["status"] for r in references}}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--demo", action="store_true", help="build the synthetic is_demo=true fixture corpus")
    ap.add_argument("--references-only", action="store_true",
                    help="process only the Moon/Mars references (early handoff while Earth tiles are missing)")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args(argv)
    sm = build_demo(a.out or C.DEMO_DIR) if a.demo else build_real(a.out or C.PROCESSED_DIR, a.references_only)
    print(json.dumps({k: sm[k] for k in ("corpus_version", "is_demo", "planned_windows", "valid_windows",
                                         "rejected_windows", "references")}, indent=2))


if __name__ == "__main__":
    main()
