import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from analysis import config as C  # noqa: E402
from analysis import preprocess as P  # noqa: E402
from analysis.extract_features import TerrainSurface  # noqa: E402
from analysis.search import terrain_distance  # noqa: E402
from discovery.build_global import lattice  # noqa: E402
from discovery.global_search import GlobalIndex, GlobalUnavailable, haversine_km, vector_distances  # noqa: E402
from discovery.known_analogs import nearest_known_analog  # noqa: E402
from discovery.pins import PinError, normalise, pin_id  # noqa: E402
from discovery.sources import wrap_crs  # noqa: E402


def test_vectorised_distance_equals_person1_callable():
    rng = np.random.default_rng(1)
    h = rng.dirichlet(np.ones(8), size=200)
    rel = rng.uniform(0, 2000, 200)
    var = rng.uniform(0, 40, 200)
    rel[:3] = 0.0                       # both-zero / floor cases
    var[:3] = 0.0
    q = np.concatenate([rng.dirichlet(np.ones(8)), [0.0, 0.0]])
    for w in (0.0, 0.4, 0.7, 1.0):
        ds, dr, dv = vector_distances(h, rel, var, q)
        D = w * ds + (1 - w) / 2 * (dr + dv)
        for i in range(200):
            x = np.concatenate([h[i], [rel[i], var[i]]])
            assert D[i] == pytest.approx(terrain_distance(x, q, w), abs=1e-12)


def test_lattice_is_deterministic_and_within_srtm_latitudes():
    a, b = lattice(), lattice()
    assert a == b and len(a) > 40000
    lats = np.array([p[1] for p in a])
    assert lats.min() > -56 and lats.max() < 60
    # neighbouring parents ~90 km apart along a latitude row
    row = [p for p in a if abs(p[1] - a[1000][1]) < 1e-9]
    d = haversine_km(row[0][1], row[0][2], row[1][1], row[1][2])
    assert 88 <= float(d) <= 92


def test_pin_ids_and_validation():
    assert pin_id("mars", 18.44, 77.45) == "pin-mars-18p44n-77p45e"
    assert pin_id("moon", -85.0, -0.5) == "pin-moon-85p00s-0p50w"
    assert normalise("moon", 10, 190) == (10, -170)
    with pytest.raises(PinError):
        normalise("mars", 89.0, 0)
    with pytest.raises(PinError):
        normalise("earth", 0, 0)


def test_lon_wrap_crs_keeps_longitudes_continuous():
    from pyproj import Transformer
    t = Transformer.from_crs(P.local_aeqd_crs("moon", 0.0, 179.9), wrap_crs("moon", 179.9), always_xy=True)
    lon, _ = t.transform(20000.0, 0.0)          # 20 km east crosses the 180 meridian
    assert lon > 180.0


def test_pipeline_on_wrapped_source_matches_unwrapped():
    """A synthetic plane straddling 180E gives the same metrics as the same plane at 0E."""
    def plane_source(lon_c):
        px = 1 / 64
        lons = lon_c - 1 + (np.arange(128) + 0.5) * px
        lats = 1 - (np.arange(128) + 0.5) * px
        z = 3000.0 * np.radians(lats)[:, None] * np.ones((1, 128)) * 50
        gt = (lon_c - 1, px, 0.0, 1.0, 0.0, -px)
        return P.RasterSource("plane", z, np.ones_like(z, bool), gt, wrap_crs("moon", lon_c))
    out = []
    for lon_c in (0.0, 180.0):
        grid = P.GridSpec(size_cells=C.WINDOW_SIZE_CELLS)
        acc = P.Accumulator(grid)
        P.accumulate_source(plane_source(lon_c), P.local_aeqd_crs("moon", 0.0, lon_c), acc)
        rg = acc.finalize()
        out.append(TerrainSurface(rg.elevation, rg.valid).window_metrics(2, 2, 20)["metrics"])
    assert out[0]["relief_p95_p05_m"] == pytest.approx(out[1]["relief_p95_p05_m"], rel=1e-6)
    assert out[0]["slope_histogram"] == pytest.approx(out[1]["slope_histogram"], abs=1e-9)


def test_known_analog_labels():
    assert nearest_known_analog(36.25, -116.8)["name"].startswith("Death Valley")
    assert nearest_known_analog(-24.5, -69.2)["name"].startswith("Atacama")
    assert nearest_known_analog(0.0, -30.0) is None


def test_global_search_contract_and_diversity():
    try:
        idx = GlobalIndex()
    except GlobalUnavailable:
        pytest.skip("global corpus not built")
    i0 = 0
    ref = {"id": "test", "analysis": {"status": "valid"},
           "metrics": {"slope_histogram": [float(x) for x in idx.hist[i0]],
                       "relief_p95_p05_m": float(idx.relief[i0]), "local_variation_m": float(idx.variation[i0])}}
    r = idx.search(ref, "terrain_general", None, top_k=5, min_center_distance_km=100)
    assert r["items"][0]["candidate_id"] == idx.window_id(i0)          # identical vector -> score 100
    assert r["items"][0]["score"] == pytest.approx(100.0)
    s = [it["score"] for it in r["items"]]
    assert s == sorted(s, reverse=True) and all(0 <= x <= 100 for x in s)
    c = [(it["center"]["lat"], it["center"]["lon"]) for it in r["items"]]
    for a in range(len(c)):
        for b in range(a + 1, len(c)):
            assert haversine_km(c[a][0], c[a][1], c[b][0], c[b][1]) >= 100
    rec = idx.record(i0)
    assert rec["id"] == idx.window_id(i0) and rec["footprint"]["type"] == "Polygon"
    assert idx.index_of(rec["id"]) == i0
    r0 = idx.search(ref, "terrain_general", 0.0, top_k=3)
    assert r0["weights"] == {"slope": 0.0, "relief": 0.5, "variation": 0.5}
