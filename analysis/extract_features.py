"""Frozen v2.0 terrain features, shared by Earth candidates and Moon/Mars references.

Features per 20x20-cell window (computed on the buffered grid, then cropped):
  * slope histogram  - 3x3 Horn gradient, metres, degrees, edges [0,1,3,5,10,20,30,45,90]
  * relief_p95_p05_m - P95(height) - P5(height)
  * local_variation_m - median |h - mean_3x3(h)|  (regional height variability, NOT rock/grain roughness)
A cell is metric-valid only if its full 3x3 neighbourhood is valid, so voids and grid edges never
create false cliffs.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from . import config as C
from . import preprocess as P

EDGES = np.asarray(C.SLOPE_BIN_EDGES_DEG, dtype=float)


class FeatureError(ValueError):
    pass


def _neighbourhood_valid(valid: np.ndarray) -> np.ndarray:
    """True where the cell and all 8 neighbours are valid; grid border is always False."""
    out = np.zeros_like(valid, dtype=bool)
    v = valid
    out[1:-1, 1:-1] = (v[:-2, :-2] & v[:-2, 1:-1] & v[:-2, 2:] & v[1:-1, :-2] & v[1:-1, 1:-1]
                       & v[1:-1, 2:] & v[2:, :-2] & v[2:, 1:-1] & v[2:, 2:])
    return out


def horn_slope_deg(z: np.ndarray, valid: np.ndarray, dx: float = C.RESOLUTION_M, dy: float | None = None):
    """Horn (1981) 3x3 slope in degrees. Returns (slope, slope_valid); slope is NaN where invalid."""
    dy = dx if dy is None else dy
    zz = np.where(valid, z, 0.0)
    a, b, c = zz[:-2, :-2], zz[:-2, 1:-1], zz[:-2, 2:]
    d, f = zz[1:-1, :-2], zz[1:-1, 2:]
    g, h, i = zz[2:, :-2], zz[2:, 1:-1], zz[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8.0 * dx)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8.0 * dy)
    slope = np.full(z.shape, np.nan)
    slope[1:-1, 1:-1] = np.degrees(np.arctan(np.sqrt(dzdx ** 2 + dzdy ** 2)))
    ok = _neighbourhood_valid(valid)
    slope[~ok] = np.nan
    return slope, ok


def local_deviation(z: np.ndarray, valid: np.ndarray):
    """|h - mean_3x3(h)| (3x3 mean includes the centre). NaN where neighbourhood invalid."""
    zz = np.where(valid, z, 0.0)
    s = np.zeros_like(zz)
    s[1:-1, 1:-1] = sum(zz[1 + di:zz.shape[0] - 1 + di, 1 + dj:zz.shape[1] - 1 + dj]
                        for di in (-1, 0, 1) for dj in (-1, 0, 1))
    ok = _neighbourhood_valid(valid)
    dev = np.full(z.shape, np.nan)
    dev[ok] = np.abs(zz[ok] - s[ok] / 9.0)
    return dev, ok


def slope_histogram(slopes: np.ndarray) -> list[float]:
    s = np.asarray(slopes, dtype=float).ravel()
    if s.size == 0:
        raise FeatureError("empty slope sample")
    if not np.all(np.isfinite(s)):
        raise FeatureError("non-finite slope values")
    if s.min() < EDGES[0] or s.max() > EDGES[-1]:
        raise FeatureError("slope outside [0, 90] degrees")
    counts, _ = np.histogram(s, bins=EDGES)          # numpy includes the last right edge (90)
    if counts.sum() != s.size:
        raise FeatureError("histogram lost samples")
    return (counts / s.size).tolist()


class TerrainSurface:
    """Per-cell derivative layers for one buffered grid (computed once, cropped per window)."""

    def __init__(self, elevation: np.ndarray, valid: np.ndarray, all_zero: np.ndarray | None = None,
                 cell_m: float = C.RESOLUTION_M):
        self.z = np.asarray(elevation, dtype=float)
        self.valid = np.asarray(valid, dtype=bool) & np.isfinite(self.z)
        self.all_zero = np.zeros_like(self.valid) if all_zero is None else np.asarray(all_zero, bool)
        self.slope, s_ok = horn_slope_deg(self.z, self.valid, cell_m)
        self.dev, d_ok = local_deviation(self.z, self.valid)
        self.metric_valid = s_ok & d_ok & self.valid

    def window_metrics(self, r0: int, c0: int, size: int, check_water: bool = False) -> dict:
        """Metrics for the size x size interior starting at buffered-grid indices (r0, c0)."""
        sl = (slice(r0, r0 + size), slice(c0, c0 + size))
        mv = self.metric_valid[sl]
        n_valid = int(mv.sum())
        frac = n_valid / float(size * size)
        reasons = []
        if frac < C.MIN_VALID_FRACTION:
            reasons.append(f"valid_fraction_below_{C.MIN_VALID_FRACTION}: {frac:.4f}")
        if n_valid < C.MIN_VALID_CELLS:
            reasons.append(f"valid_cells_below_{C.MIN_VALID_CELLS}: {n_valid}")
        if check_water:
            zero_frac = float(self.all_zero[sl].sum()) / float(size * size)
            if zero_frac > C.MAX_EXACT_ZERO_FRACTION:
                reasons.append(f"suspected_water_or_fill: {zero_frac:.4f} of cells exactly 0 m")
        result = {"valid_fraction": frac, "valid_cells": n_valid, "reasons": reasons,
                  "status": "invalid" if reasons else "valid",
                  "metrics": {"slope_histogram": None, "relief_p95_p05_m": None, "local_variation_m": None}}
        if reasons:
            return result
        h = self.z[sl][mv]
        p95, p5 = np.percentile(h, [95, 5], method=C.PERCENTILE_METHOD)
        metrics = {
            "slope_histogram": slope_histogram(self.slope[sl][mv]),
            "relief_p95_p05_m": float(p95 - p5),
            "local_variation_m": float(np.median(self.dev[sl][mv])),
        }
        assert_finite_metrics(metrics)
        result["metrics"] = metrics
        return result


def assert_finite_metrics(m: dict) -> None:
    hist = m.get("slope_histogram")
    if hist is None or len(hist) != 8 or not all(math.isfinite(p) and p >= 0 for p in hist):
        raise FeatureError("invalid slope histogram")
    if abs(sum(hist) - 1.0) > 1e-9:
        raise FeatureError("slope histogram does not sum to one")
    for k in ("relief_p95_p05_m", "local_variation_m"):
        v = m.get(k)
        if v is None or not math.isfinite(v) or v < 0:
            raise FeatureError(f"invalid {k}: {v}")


# ---------------------------------------------------------------------------- references
def reference_grid_from_sources(region: dict, sources: list) -> tuple[P.RegriddedGrid, P.GridSpec, object]:
    body, lat, lon = region["body"], region["center"]["lat"], region["center"]["lon"]
    grid = P.GridSpec(size_cells=C.WINDOW_SIZE_CELLS)
    crs = P.local_aeqd_crs(body, lat, lon)
    acc = P.Accumulator(grid)
    for src in sources:
        P.accumulate_source(src, crs, acc)
    return acc.finalize(), grid, crs


def extract_reference(region_config: dict, is_demo: bool = False, regridded=None, previews_dir=None):
    """Run the shared pipeline on one Moon/Mars reference. Returns (RegionRecord, manifest).

    region_config: an entry of regions.json "references" with body, center{lat,lon} in the body's
    planetocentric east-positive convention, and "input" (see preprocess.read_raw_source).
    `regridded` lets tests/demo pass a ready (RegriddedGrid, GridSpec, crs) tuple.
    """
    from .build_candidates import square_footprint, sha256_file, save_preview, hillshade_rgb  # avoids a cycle

    body = region_config["body"]
    if body == "earth":
        raise FeatureError("references are Moon/Mars regions; Earth uses build_candidates")
    read_info = None
    if regridded is None:
        if region_config.get("center", {}).get("lat") is None:
            raise P.PreprocessError(f"{region_config['id']}: reference center not yet handed off")
        spec = region_config.get("input")
        if spec:                                   # explicit raw/npy/raster handoff block
            src = P.read_raw_source(spec)
            input_files = [{"path": spec["path"], "sha256": sha256_file(C.REPO_ROOT / spec["path"])}]
        else:                                      # data-setup layout: GeoTIFF named by its SourceRecord
            src, read_info, input_files = read_reference_source(region_config)
        check_reference_geometry(region_config, src)
        grid_out, grid, crs = reference_grid_from_sources(region_config, [src])
    else:
        grid_out, grid, crs = regridded
        input_files = []
    surf = TerrainSurface(grid_out.elevation, grid_out.valid)
    preview_url = None
    if previews_dir is not None:
        save_preview(Path(previews_dir) / f"{region_config['id']}.png",
                     hillshade_rgb(grid_out.elevation, grid_out.valid), 8)
        preview_url = f"/assets/previews/{region_config['id']}.png"
    b = grid.buffer_cells
    wm = surf.window_metrics(b, b, C.WINDOW_SIZE_CELLS)
    lat, lon = region_config["center"]["lat"], region_config["center"]["lon"]
    footprint = square_footprint(body, lat, lon, 0.0, 0.0, C.WINDOW_SIZE_CELLS * C.RESOLUTION_M)
    convention = (f"{body.capitalize()} planetocentric latitude, east-positive longitude on "
                  f"{C.BODY_FIGURES[body]['description']}; [lon, lat] order; NOT Earth WGS84 - never draw on Earth")
    record = {
        "schema_version": C.SCHEMA_VERSION, "id": region_config["id"], "body": body, "kind": "reference",
        "name": region_config.get("name", region_config["id"]),
        "center": {"lat": lat, "lon": lon},
        "footprint": {**footprint, "crs_note": convention},
        "coordinate_convention": convention,
        "source_ids": list(region_config.get("source_ids", [])),
        "preview_url": preview_url,
        "limitations": list(dict.fromkeys(reference_limitations() + list(region_config.get("limitations", [])))),
        "analysis": {"pipeline_version": C.PIPELINE_VERSION, "resolution_m": int(C.RESOLUTION_M),
                     "window_size_km": C.WINDOW_SIZE_CELLS * C.RESOLUTION_M / 1000,
                     "valid_fraction": wm["valid_fraction"], "status": wm["status"], "is_demo": is_demo,
                     "reasons": wm["reasons"]},
        "metrics": wm["metrics"],
    }
    manifest = {
        "schema_version": C.SCHEMA_VERSION, "pipeline_version": C.PIPELINE_VERSION,
        "region_id": region_config["id"], "kind": "reference", "body": body, "is_demo": is_demo,
        "center": region_config["center"], "center_status": region_config.get("status"),
        "inputs": input_files, "input_spec": region_config.get("input"), "native_read": read_info,
        "body_figure": C.BODY_FIGURES[body]["description"],
        "analysis_crs_wkt": crs.to_wkt(), "analysis_crs_proj4": crs.srs,
        "resampling": "area average by source-pixel-centre binning into 1000 m cells; "
                      f"cell valid if valid samples >= {C.MIN_CELL_SAMPLE_FRACTION} x nominal",
        "buffer_cells": grid.buffer_cells, "grid_cells": grid.n,
        "regrid_stats": grid_out.stats, "window": {"valid_cells": wm["valid_cells"], **wm},
        "settings": C.frozen_settings(),
    }
    return record, manifest


def read_reference_source(region_config: dict):
    """Locate the reference GeoTIFF through its SourceRecord, verify SHA-256, read it."""
    from .build_candidates import sha256_file
    sources = C.load_sources()
    ids = region_config.get("source_ids") or []
    if not ids or ids[0] not in sources:
        raise P.PreprocessError(f"{region_config['id']}: source_ids {ids} not found in data/sources/*_sources.json")
    rec = sources[ids[0]]
    path = C.REPO_ROOT / rec["filename"]
    if not path.exists():
        raise P.PreprocessError(f"{region_config['id']}: raw file missing: {rec['filename']} "
                                "(run scripts/fetch_data.py or copy data/raw/ from the team Drive)")
    digest = sha256_file(path)
    if digest != rec["sha256"]:
        raise P.PreprocessError(f"{path.name}: sha256 {digest[:12]} != SourceRecord {rec['sha256'][:12]}")
    src, info = P.read_geotiff(path, rec.get("native_crs_wkt"))
    return src, info, [{"source_id": rec["id"], "path": rec["filename"], "sha256": digest}]


def check_reference_geometry(region_config: dict, src) -> None:
    """Never accept an Earth/WGS84 figure for Moon/Mars, and require the buffered window inside the crop."""
    from pyproj import Transformer
    body = region_config["body"]
    expected = {"moon": 1737400.0, "mars": 3396190.0}[body]
    if not P._has_figure(src.native_crs):
        raise P.PreprocessError(f"{region_config['id']}: native CRS has no ellipsoid/sphere definition")
    got, minor = P._figure(src.native_crs)
    if abs(got - expected) > 1.0 or abs(minor - got) > 1.0:
        raise P.PreprocessError(f"{region_config['id']}: native CRS figure a={got} is not the {body} sphere {expected}")
    grid = P.GridSpec(size_cells=C.WINDOW_SIZE_CELLS)
    t = Transformer.from_crs(P.local_aeqd_crs(body, region_config["center"]["lat"], region_config["center"]["lon"]),
                             src.native_crs, always_xy=True)
    bx, by = t.transform(*grid.boundary_points().T)
    xmin, ymin, xmax, ymax = P.native_bounds(src)
    if not (np.min(bx) >= xmin and np.max(bx) <= xmax and np.min(by) >= ymin and np.max(by) <= ymax):
        raise P.PreprocessError(f"{region_config['id']}: buffered 24 km window is not inside the native crop "
                                f"{(xmin, ymin, xmax, ymax)} (window bbox {np.min(bx), np.min(by), np.max(bx), np.max(by)})")


def reference_limitations() -> list[str]:
    return [
        "Kilometre-scale (1000 m) regional terrain statistics only; not obstacle, rock or soil-scale roughness.",
        "Terrain data do not establish gravity, vacuum/atmosphere, radiation, temperature, illumination, "
        "regolith properties or ice.",
    ]


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, indent=2, ensure_ascii=False, allow_nan=False)
    path.write_text(text + "\n", encoding="utf-8")
