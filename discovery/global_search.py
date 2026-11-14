"""Search the global Earth window corpus with Person 1's frozen distance (vectorised, exact formula).

The callable in analysis.search.terrain_distance is evaluated per pair by NearestNeighbors(brute);
on ~1M windows that is far too slow, so the SAME formula is evaluated in numpy over all rows.
tests/discovery checks the vectorised values against analysis.search.terrain_distance.
"""
from __future__ import annotations

import json
import math
import threading
from pathlib import Path

import numpy as np

from analysis import config as C
from analysis.search import InvalidInputError, feature_vector, resolve_weight, weights_for

from .build_global import OUT_DIR, lattice
from .known_analogs import nearest_known_analog

SCORE_VERSION = "2.0"
DEFAULT_MIN_KM = 100.0     # discovery: spread results across the planet, not one mountain range
MAX_TOP_K = 10


class GlobalUnavailable(RuntimeError):
    pass


def vector_distances(hist: np.ndarray, relief: np.ndarray, variation: np.ndarray, q: np.ndarray):
    """Component distances of every row to query vector q (8 hist, relief, variation)."""
    f = C.STABILIZATION_FLOOR_M
    d_slope = 0.5 * np.abs(hist - q[:8]).sum(axis=1)
    d_relief = np.abs(relief - q[8]) / np.maximum(np.maximum(np.abs(relief), abs(q[8])), f)
    d_var = np.abs(variation - q[9]) / np.maximum(np.maximum(np.abs(variation), abs(q[9])), f)
    return d_slope, d_relief, d_var


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi, dl = p2 - p1, np.radians(lon2 - lon1)
    h = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(np.minimum(h, 1.0)))


class GlobalIndex:
    def __init__(self, out_dir: Path = OUT_DIR):
        npz, man = out_dir / "earth_windows.npz", out_dir / "earth_windows_manifest.json"
        if not npz.exists() or not man.exists():
            raise GlobalUnavailable("global Earth corpus not built (python -m discovery.build_global)")
        d = np.load(npz)
        self.parent_index, self.row, self.col = d["parent_index"], d["row"], d["col"]
        self.lat, self.lon = d["lat"], d["lon"]
        self.hist = d["hist"].astype(np.float64)
        self.relief = d["relief"].astype(np.float64)
        self.variation = d["variation"].astype(np.float64)
        self.valid_fraction = d["valid_fraction"]
        self.manifest = json.loads(man.read_text(encoding="utf-8"))
        self.corpus_version = self.manifest["corpus_version"]
        self.parents = {i: (la, lo) for i, la, lo in lattice()}
        self.n = int(self.lat.size)
        self._lock = threading.Lock()

    # ----------------------------------------------------------------- identity / geometry
    def window_id(self, i: int) -> str:
        return f"earth-global-p{int(self.parent_index[i]):05d}-r{int(self.row[i]):02d}-c{int(self.col[i]):02d}"

    def index_of(self, wid: str) -> int:
        try:
            _, _, p, r, c = wid.split("-")
            pi, rr, cc = int(p[1:]), int(r[1:]), int(c[1:])
        except Exception:
            raise KeyError(wid)
        hits = np.nonzero((self.parent_index == pi) & (self.row == rr) & (self.col == cc))[0]
        if hits.size != 1:
            raise KeyError(wid)
        return int(hits[0])

    def record(self, i: int) -> dict:
        """CandidateRecord-shaped dict (geometry recomputed with Person 1's footprint function)."""
        from analysis.build_candidates import square_footprint
        plat, plon = self.parents[int(self.parent_index[i])]
        half = C.PARENT_SIZE_CELLS * C.RESOLUTION_M / 2
        cx = -half + (int(self.col[i]) * C.STRIDE_CELLS + C.WINDOW_SIZE_CELLS / 2) * C.RESOLUTION_M
        cy = half - (int(self.row[i]) * C.STRIDE_CELLS + C.WINDOW_SIZE_CELLS / 2) * C.RESOLUTION_M
        lat, lon = float(self.lat[i]), float(self.lon[i])
        known = nearest_known_analog(lat, lon)
        return {
            "schema_version": "2.0", "id": self.window_id(i), "body": "earth", "kind": "candidate",
            "parent_id": f"earth-global-p{int(self.parent_index[i]):05d}",
            "name": f"Earth window {lat:.3f}, {lon:.3f}",
            "center": {"lat": round(lat, 6), "lon": round(lon, 6)},
            "footprint": square_footprint("earth", plat, plon, cx, cy, C.WINDOW_SIZE_CELLS * C.RESOLUTION_M),
            "coordinate_convention": "WGS84 geographic (EPSG:4326); GeoJSON [longitude, latitude]",
            "source_ids": self.source_ids(lat, lon),
            "preview_url": None,
            "limitations": list(self.manifest["limitations"]) + [
                "Global screening result: not field-validated; verify with higher-resolution data and on site.",
            ],
            "analysis": {"pipeline_version": C.PIPELINE_VERSION, "resolution_m": int(C.RESOLUTION_M),
                         "window_size_km": C.WINDOW_SIZE_CELLS * C.RESOLUTION_M / 1000,
                         "valid_fraction": float(self.valid_fraction[i]), "status": "valid", "is_demo": False,
                         "reasons": [], "input_product": self.manifest["input_product"]},
            "metrics": {"slope_histogram": [float(x) for x in self.hist[i]],
                        "relief_p95_p05_m": float(self.relief[i]), "local_variation_m": float(self.variation[i])},
            "known_analog": known,
        }

    @staticmethod
    def source_ids(lat: float, lon: float) -> list[str]:
        """SRTMGL30 tile (40x50 deg, named by upper-left corner) containing the point."""
        ulx = -180 + 40 * math.floor((lon + 180) / 40)
        bands = [(90, 40), (40, -10), (-10, -60)]
        uly = next(t for t, b in bands if b <= lat < t) if lat < 90 else 90
        ew = "e" if ulx >= 0 else "w"
        ns = "n" if uly >= 0 else "s"
        return [f"earth-srtmgl30-{ew}{abs(ulx):03d}{ns}{abs(uly):02d}"]

    # ----------------------------------------------------------------- search
    def search(self, reference: dict, profile: str = "terrain_general", slope_weight=None, top_k: int = 5,
               min_center_distance_km: float = DEFAULT_MIN_KM, exclude_known: bool = False) -> dict:
        w = resolve_weight(profile, slope_weight)
        if isinstance(top_k, bool) or not isinstance(top_k, int) or not 1 <= top_k <= MAX_TOP_K:
            raise InvalidInputError(f"top_k must be an integer in 1..{MAX_TOP_K}")
        if not (math.isfinite(min_center_distance_km) and 20.0 <= min_center_distance_km <= 2000.0):
            raise InvalidInputError("min_center_distance_km must be in [20, 2000]")
        q = feature_vector(reference.get("metrics"))
        if q is None or reference["analysis"]["status"] != "valid":
            raise InvalidInputError(f"reference {reference.get('id')} has no valid metrics")
        ds, dr, dv = vector_distances(self.hist, self.relief, self.variation, q)
        wt = weights_for(w)
        D = wt["slope"] * ds + wt["relief"] * dr + wt["variation"] * dv
        order = np.lexsort((self.parent_index * 100 + self.row.astype(np.int64) * 10 + self.col, D))
        picked, skipped_known = [], 0
        sel_lat, sel_lon = np.empty(0), np.empty(0)
        for i in order[: 200000]:
            if len(picked) >= top_k:
                break
            lat, lon = float(self.lat[i]), float(self.lon[i])
            if exclude_known and nearest_known_analog(lat, lon):
                skipped_known += 1
                continue
            if sel_lat.size and np.min(haversine_km(sel_lat, sel_lon, lat, lon)) < min_center_distance_km:
                continue
            picked.append(int(i))
            sel_lat, sel_lon = np.append(sel_lat, lat), np.append(sel_lon, lon)
        items = []
        for rank, i in enumerate(picked, 1):
            dist = {"slope": float(ds[i]), "relief": float(dr[i]), "variation": float(dv[i])}
            contrib = {k: wt[k] * dist[k] for k in dist}
            known = nearest_known_analog(float(self.lat[i]), float(self.lon[i]))
            items.append({
                "candidate_id": self.window_id(i), "parent_id": f"earth-global-p{int(self.parent_index[i]):05d}",
                "score": max(0.0, min(100.0, 100.0 * (1.0 - float(D[i])))), "distances": dist,
                "source_ids": self.source_ids(float(self.lat[i]), float(self.lon[i])),
                "reason_codes": [f"closest_metric:{min(contrib, key=contrib.get)}",
                                 f"largest_gap_metric:{max(contrib, key=contrib.get)}"],
                "limitations": ["Global screening on SRTMGL30 (~1 km); not field-validated."],
                "rank": rank, "total_distance": float(D[i]), "contributions": contrib,
                "center": {"lat": float(self.lat[i]), "lon": float(self.lon[i])}, "known_analog": known,
                "is_demo": False,
            })
        warnings = []
        if len(picked) < top_k:
            warnings.append(f"only {len(picked)} result(s) satisfy the {min_center_distance_km:g} km separation rule")
        return {
            "schema_version": "2.0", "reference_id": reference["id"], "profile": profile,
            "score_version": SCORE_VERSION, "corpus_version": self.corpus_version, "weights": wt,
            "mode": "global",
            "scope": {"planned_windows": self.n, "valid_windows": self.n, "returned_windows": len(picked),
                      "min_center_distance_km": min_center_distance_km,
                      "coverage": "Earth land 56S-60N (SRTMGL30, ~1 km)", "known_analogs_skipped": skipped_known},
            "items": items, "excluded": [], "warnings": warnings,
        }
