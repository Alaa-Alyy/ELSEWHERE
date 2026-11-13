"""Synthetic is_demo corpus builder shared by Person 1 tests."""
import numpy as np

from analysis import config as C
from analysis import preprocess as P
from analysis.build_candidates import build_parent, synthetic_dem, write_corpus
from analysis.extract_features import extract_reference

PARENTS = [
    {"id": "earth-khaybar", "name": "Harrat Khaybar", "center": {"lat": 25.7, "lon": 39.9}},
    {"id": "earth-pinacate", "name": "El Pinacate", "center": {"lat": 31.77, "lon": -113.5}},
]


def make_corpus(out_dir, hole=True, ref_kind="mars"):
    parents, cands, mans = [], [], []
    for i, p in enumerate(PARENTS):
        grid = P.GridSpec(size_cells=C.PARENT_SIZE_CELLS)
        z = synthetic_dem("volcanic" if i == 0 else "basin", grid.n, 100 + i)
        v = np.ones_like(z, bool)
        if hole and i == 1:
            v[2:40, 2:40] = False
        rg = P.RegriddedGrid(np.where(v, z, np.nan), v, np.zeros_like(v), 1000.0, {})
        pr, cs, m = build_parent(p, (rg, grid, P.local_aeqd_crs("earth", **p["center"])), is_demo=True,
                                 source_tiles=["demo-src"])
        parents.append(pr); cands += cs; mans.append(m)
    grid = P.GridSpec(size_cells=C.WINDOW_SIZE_CELLS)
    z = synthetic_dem(ref_kind, grid.n, 7)
    v = np.ones_like(z, bool)
    ref_cfg = {"id": "mars-jezero", "body": "mars", "name": "test", "center": {"lat": 18.4, "lon": 77.5}}
    rec, man = extract_reference(ref_cfg, is_demo=True,
                                 regridded=(P.RegriddedGrid(z, v, np.zeros_like(v), 1000.0, {}), grid,
                                            P.local_aeqd_crs("mars", 18.4, 77.5)))
    pending = {**rec, "id": "moon-south-pole-sector", "body": "moon",
               "analysis": {**rec["analysis"], "status": "pending", "reasons": ["awaiting handoff"]},
               "metrics": {"slope_histogram": None, "relief_p95_p05_m": None, "local_variation_m": None}}
    return write_corpus(out_dir, parents, cands, [rec, pending], mans + [man], is_demo=True)
