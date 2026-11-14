"""Measure a user-placed Moon/Mars pin with Person 1's frozen reference pipeline."""
from __future__ import annotations

import math
import threading

from analysis import config as C
from analysis import preprocess as P
from analysis.build_candidates import square_footprint
from analysis.extract_features import TerrainSurface, reference_limitations

from .sources import PIN_LAT_LIMIT, SourceUnavailable, pin_source

_CACHE: dict[str, dict] = {}
_LOCK = threading.Lock()


class PinError(ValueError):
    pass


def pin_id(body: str, lat: float, lon: float) -> str:
    """Stable ID; coordinates rounded to 0.01 deg (~0.3-0.6 km) so repeated clicks reuse the result."""
    def f(v, pos, neg):
        return f"{abs(v):.2f}{pos if v >= 0 else neg}".replace(".", "p")
    return f"pin-{body}-{f(lat, 'n', 's')}-{f(lon, 'e', 'w')}"


def normalise(body: str, lat: float, lon: float) -> tuple[float, float]:
    if body not in PIN_LAT_LIMIT:
        raise PinError("body must be 'mars' or 'moon'")
    if not (math.isfinite(lat) and math.isfinite(lon)):
        raise PinError("lat/lon must be finite numbers")
    if abs(lat) > PIN_LAT_LIMIT[body]:
        raise PinError(f"|lat| must be <= {PIN_LAT_LIMIT[body]} on {body} (map projection limit near the pole)")
    lon = ((lon + 180.0) % 360.0) - 180.0
    return round(lat, 2), round(lon, 2)


def measure_pin(body: str, lat: float, lon: float) -> dict:
    """RegionRecord (kind=reference) for a pin, computed with the same 1000 m / 20 km pipeline."""
    lat, lon = normalise(body, float(lat), float(lon))
    rid = pin_id(body, lat, lon)
    with _LOCK:
        if rid in _CACHE:
            return _CACHE[rid]
    grid = P.GridSpec(size_cells=C.WINDOW_SIZE_CELLS)
    try:
        src, source_id = pin_source(body, lat, lon, grid.half_extent_m + 3000.0)
    except SourceUnavailable:
        raise
    except Exception as exc:  # network / GDAL errors
        raise SourceUnavailable(f"{body} elevation source unavailable: {type(exc).__name__}") from exc
    crs = P.local_aeqd_crs(body, lat, lon)
    acc = P.Accumulator(grid)
    P.accumulate_source(src, crs, acc)
    rg = acc.finalize()
    surf = TerrainSurface(rg.elevation, rg.valid)
    b = grid.buffer_cells
    wm = surf.window_metrics(b, b, C.WINDOW_SIZE_CELLS)
    convention = (f"{body.capitalize()} planetocentric latitude, east-positive longitude on "
                  f"{C.BODY_FIGURES[body]['description']}; [lon, lat] order; NOT Earth WGS84 - never draw on Earth")
    fp = square_footprint(body, lat, lon, 0.0, 0.0, C.WINDOW_SIZE_CELLS * C.RESOLUTION_M)
    record = {
        "schema_version": C.SCHEMA_VERSION, "id": rid, "body": body, "kind": "reference",
        "name": f"Pinned {body.capitalize()} window {lat:.2f}, {lon:.2f}",
        "center": {"lat": lat, "lon": lon},
        "footprint": {**fp, "crs_note": convention},
        "coordinate_convention": convention,
        "source_ids": [source_id],
        "preview_url": None,
        "limitations": reference_limitations() + [
            "User-placed pin: measured on demand with the shared pipeline; location is not a vetted site.",
        ],
        "analysis": {"pipeline_version": C.PIPELINE_VERSION, "resolution_m": int(C.RESOLUTION_M),
                     "window_size_km": C.WINDOW_SIZE_CELLS * C.RESOLUTION_M / 1000,
                     "valid_fraction": wm["valid_fraction"], "status": wm["status"], "is_demo": False,
                     "reasons": wm["reasons"]},
        "metrics": wm["metrics"],
        "pin": {"source": src.name, "elevation_range_m": [
            float(rg.stats["source_valid_elevation_min_m"] or 0), float(rg.stats["source_valid_elevation_max_m"] or 0)],
            "subsamples_per_source_pixel": rg.stats["subsamples_per_source_pixel"]},
    }
    with _LOCK:
        if len(_CACHE) > 500:
            _CACHE.clear()
        _CACHE[rid] = record
    return record
