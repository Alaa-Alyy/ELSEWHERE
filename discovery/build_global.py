"""Run Person 1's frozen parent pipeline over all Earth land (SRTMGL30) -> compact global window corpus.

    python -m discovery.build_global                 # full build, all CPU cores
    python -m discovery.build_global --limit 40      # quick smoke test on 40 land parents

Lattice: 100 km parents (local azimuthal-equidistant, WGS84) centred every 90 km, so their 81 windows
(20 km, 10 km stride) tile the land continuously. Same functions/constants as analysis.build_candidates:
GridSpec(100) + 2-cell buffer, Accumulator area averaging to 1000 m, TerrainSurface, window_metrics
(with the water guard). Coverage limited to SRTM latitudes 56S-60N.
Output: data/processed/global/earth_windows.npz + earth_windows_manifest.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "processed" / "global"
LAT_MIN, LAT_MAX = -56.0, 60.0
SPACING_KM = 90.0
PARENT_HALF_KM = 50.0
MIN_CROP_VALID = 0.02


def lattice() -> list[tuple[int, float, float]]:
    """Deterministic parent centres (index, lat, lon) covering 56S-60N."""
    out, idx = [], 0
    dlat = SPACING_KM / 111.195
    lat = LAT_MIN + PARENT_HALF_KM / 111.195
    while lat <= LAT_MAX - PARENT_HALF_KM / 111.195 + 1e-9:
        n = max(1, int(math.floor(360.0 / (SPACING_KM / (111.32 * math.cos(math.radians(lat)))))))
        step = 360.0 / n
        for k in range(n):
            out.append((idx, round(lat, 6), round(-180.0 + (k + 0.5) * step, 6)))
            idx += 1
        lat += dlat
    return out


def _work(chunk):
    """Worker: returns arrays for the parents in `chunk` (skips ocean parents quickly)."""
    from pyproj import Transformer

    from analysis import config as C
    from analysis import preprocess as P
    from analysis.extract_features import TerrainSurface
    from discovery.sources import earth_mosaic

    mos = earth_mosaic()
    b, W, S, N = C.BUFFER_CELLS, C.WINDOW_SIZE_CELLS, C.STRIDE_CELLS, C.WINDOWS_PER_AXIS
    rows = []
    for (pi, lat, lon) in chunk:
        grid = P.GridSpec(size_cells=C.PARENT_SIZE_CELLS)
        src = mos.crop(lat, lon, grid.half_extent_m + 3000.0)
        if src.valid.mean() < MIN_CROP_VALID:
            continue
        crs = P.local_aeqd_crs("earth", lat, lon)
        acc = P.Accumulator(grid)
        try:
            P.accumulate_source(src, crs, acc)
            rg = acc.finalize()
        except P.PreprocessError:
            continue
        surf = TerrainSurface(rg.elevation, rg.valid, rg.all_zero)
        to_ll = Transformer.from_crs(crs, P.geographic_crs("earth"), always_xy=True)
        half = C.PARENT_SIZE_CELLS * C.RESOLUTION_M / 2
        for wr in range(N):
            for wc in range(N):
                wm = surf.window_metrics(b + wr * S, b + wc * S, W, check_water=True)
                if wm["status"] != "valid":
                    continue
                cx = -half + (wc * S + W / 2) * C.RESOLUTION_M
                cy = half - (wr * S + W / 2) * C.RESOLUTION_M
                clon, clat = to_ll.transform(cx, cy)
                m = wm["metrics"]
                rows.append((pi, wr, wc, clat, clon, *m["slope_histogram"], m["relief_p95_p05_m"],
                             m["local_variation_m"], wm["valid_fraction"]))
    return rows


def build(limit: int | None = None, workers: int | None = None) -> dict:
    from discovery.sources import EARTH_DIR, extract_srtmgl30

    extract_srtmgl30()
    parents = lattice()
    if limit:  # smoke test: parents near the 3 curated regions + a spread
        rng = np.random.default_rng(0)
        parents = [parents[i] for i in sorted(rng.choice(len(parents), size=min(limit * 8, len(parents)), replace=False))]
    workers = workers or max(1, (os.cpu_count() or 2) - 1)
    chunks = [parents[i::workers * 8] for i in range(workers * 8)]
    t0 = time.time()
    rows = []
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for k, part in enumerate(ex.map(_work, chunks)):
            rows.extend(part)
            if k % max(1, len(chunks) // 20) == 0:
                print(f"  {k + 1}/{len(chunks)} chunks, {len(rows):,} valid windows, {time.time() - t0:.0f}s", flush=True)
    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    a = np.asarray(rows, dtype=np.float64)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "earth_windows.npz"
    np.savez_compressed(
        out,
        parent_index=a[:, 0].astype(np.int32), row=a[:, 1].astype(np.uint8), col=a[:, 2].astype(np.uint8),
        lat=a[:, 3], lon=a[:, 4], hist=a[:, 5:13].astype(np.float32),
        relief=a[:, 13].astype(np.float32), variation=a[:, 14].astype(np.float32),
        valid_fraction=a[:, 15].astype(np.float32),
    )
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    src_file = ROOT / "data" / "sources" / "earth_global_sources.json"
    if src_file.exists():
        inputs = [{"source_id": s["id"], "sha256": s["sha256"]}
                  for s in json.loads(src_file.read_text(encoding="utf-8-sig"))["items"]]
    else:  # build ran before the fetch script wrote the registry: hash the files actually used
        inputs = [{"source_id": f"earth-srtmgl30-{z.name.split('.')[0].lower()}",
                   "sha256": hashlib.sha256(z.read_bytes()).hexdigest()} for z in sorted(EARTH_DIR.glob("*.zip"))]
    from analysis import config as C
    manifest = {
        "schema_version": "2.0", "pipeline_version": C.PIPELINE_VERSION, "kind": "global_earth_windows",
        "built_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "corpus_version": "sha256:" + digest,
        "input_product": "NASA SRTMGL30 v002 (30 arc-second)",
        "inputs": inputs,
        "coverage": {"lat_min": LAT_MIN, "lat_max": LAT_MAX, "note": "SRTM-measured latitudes only"},
        "lattice": {"parent_size_km": 100, "spacing_km": SPACING_KM, "parents_total": len(lattice()),
                    "parents_processed": len(parents), "limit": limit},
        "valid_windows": int(a.shape[0]),
        "settings": C.frozen_settings(),
        "method": "Person 1 v2.0 pipeline per parent: local AEQD (WGS84), area average to 1000 m, "
                  "Horn slope, 8-bin histogram, P95-P5 relief, median local deviation, water guard; "
                  "only valid windows stored.",
        "limitations": [
            "SRTMGL30 is a ~1 km product; the 3 curated parents use SRTMGL1 (30 m) - values can differ slightly.",
            "Land between 56S and 60N only (SRTM coverage); polar and high-latitude terrain not searched.",
            "Overlapping windows are correlated samples.",
        ],
        "elapsed_s": round(time.time() - t0, 1),
        "raw_dir": str(EARTH_DIR.relative_to(ROOT)),
    }
    (OUT_DIR / "earth_windows_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ("corpus_version", "valid_windows", "lattice", "elapsed_s")}, indent=2))
    return manifest


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=None)
    a = ap.parse_args()
    build(a.limit, a.workers)
