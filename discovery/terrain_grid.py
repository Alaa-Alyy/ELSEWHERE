"""Elevation grid of one 20 km window (20 x 20 cells at 1000 m) for DISPLAY (3D terrain view).

Built with exactly the same steps as the measurement (local AEQD grid on the body's own figure,
area-average binning via Person 1's Accumulator), so what is drawn is what was measured.
Earth uses the local SRTMGL30 mosaic for every window (curated windows were measured on SRTMGL1).
"""
from __future__ import annotations

import math
import threading

import numpy as np

from analysis import config as C
from analysis import preprocess as P

from .sources import PIN_LAT_LIMIT, SourceUnavailable, earth_mosaic, pin_source

_CACHE: dict[tuple, dict] = {}
_LOCK = threading.Lock()
EARTH_LAT_LIMIT = 60.0


class TerrainGridError(ValueError):
    pass


def elevation_grid(body: str, lat: float, lon: float) -> dict:
    if body not in ("earth", "mars", "moon"):
        raise TerrainGridError("body must be 'earth', 'mars' or 'moon'")
    if not (math.isfinite(lat) and math.isfinite(lon)):
        raise TerrainGridError("lat/lon must be finite numbers")
    limit = EARTH_LAT_LIMIT if body == "earth" else PIN_LAT_LIMIT[body]
    if abs(lat) > limit:
        raise TerrainGridError(f"|lat| must be <= {limit} for {body}")
    lat, lon = round(float(lat), 3), round(((float(lon) + 180.0) % 360.0) - 180.0, 3)
    key = (body, lat, lon)
    with _LOCK:
        if key in _CACHE:
            return _CACHE[key]

    grid = P.GridSpec(size_cells=C.WINDOW_SIZE_CELLS)
    half = grid.half_extent_m + 3000.0
    try:
        if body == "earth":
            src, source_id = earth_mosaic().crop(lat, lon, half), "earth-srtmgl30"
        else:
            src, source_id = pin_source(body, lat, lon, half)
    except SourceUnavailable:
        raise
    except Exception as exc:  # missing local files, network / GDAL errors
        raise SourceUnavailable(f"{body} elevation source unavailable: {type(exc).__name__}") from exc

    acc = P.Accumulator(grid)
    P.accumulate_source(src, P.local_aeqd_crs(body, lat, lon), acc)
    rg = acc.finalize()
    return remember(body, lat, lon, rg, grid, src, source_id)


def remember(body: str, lat: float, lon: float, rg, grid, src, source_id: str) -> dict:
    """Store the window grid of an already-binned raster (used by pins so a 3D view costs nothing extra)."""
    lat, lon = round(float(lat), 3), round(((float(lon) + 180.0) % 360.0) - 180.0, 3)
    key = (body, lat, lon)
    b, n = grid.buffer_cells, C.WINDOW_SIZE_CELLS
    z = np.asarray(rg.elevation, dtype=float)[b:b + n, b:b + n]
    ok = np.asarray(rg.valid, dtype=bool)[b:b + n, b:b + n] & np.isfinite(z)
    rows = [[round(float(z[r, c]), 1) if ok[r, c] else None for c in range(n)] for r in range(n)]
    vals = z[ok]
    item = {
        "body": body, "center": {"lat": lat, "lon": lon},
        "cell_m": int(C.RESOLUTION_M), "size": n,
        "row_order": "north to south", "col_order": "west to east",
        "elevation_m": rows,
        "min_m": round(float(vals.min()), 1) if vals.size else None,
        "max_m": round(float(vals.max()), 1) if vals.size else None,
        "valid_fraction": round(float(ok.mean()), 3),
        "source": {"id": source_id, "name": getattr(src, "name", source_id),
                   "note": "Same 1000 m grid and binning as the terrain measurement. Display only."},
    }
    with _LOCK:
        if len(_CACHE) > 400:
            _CACHE.clear()
        _CACHE[key] = item
    return item
