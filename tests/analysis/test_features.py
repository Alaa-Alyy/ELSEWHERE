import math

import numpy as np
import pytest

from analysis import config as C
from analysis.extract_features import (FeatureError, TerrainSurface, horn_slope_deg, local_deviation,
                                       slope_histogram)

N = 24  # 20x20 window + 2-cell buffer


def test_flat_grid_gives_zero_terrain_features():
    z = np.full((N, N), 1234.5)
    s = TerrainSurface(z, np.ones_like(z, bool))
    wm = s.window_metrics(2, 2, 20)
    assert wm["status"] == "valid"
    assert wm["metrics"]["slope_histogram"] == [1.0] + [0.0] * 7
    assert wm["metrics"]["relief_p95_p05_m"] == 0.0
    assert wm["metrics"]["local_variation_m"] == 0.0


@pytest.mark.parametrize("gx,gy", [(0.1, 0.0), (0.0, -0.25), (0.3, 0.4)])
def test_analytical_plane_slope(gx, gy):
    yy, xx = np.mgrid[0:N, 0:N].astype(float) * C.RESOLUTION_M
    z = gx * xx + gy * yy
    slope, ok = horn_slope_deg(z, np.ones_like(z, bool))
    expected = math.degrees(math.atan(math.hypot(gx, gy)))
    assert np.allclose(slope[1:-1, 1:-1], expected, atol=1e-9)
    assert not ok[0].any() and not ok[-1].any() and not ok[:, 0].any() and not ok[:, -1].any()
    dev, _ = local_deviation(z, np.ones_like(z, bool))
    assert np.allclose(dev[1:-1, 1:-1], 0.0, atol=1e-9)   # a plane equals its 3x3 mean


def test_nodata_hole_creates_no_false_cliffs():
    z = np.full((N, N), 500.0)
    valid = np.ones_like(z, bool)
    valid[10:13, 10:13] = False
    z[~valid] = -32768.0            # a void value must never leak into derivatives
    s = TerrainSurface(z, valid)
    finite = s.slope[np.isfinite(s.slope)]
    assert finite.size > 0 and np.all(finite == 0.0)
    assert not s.metric_valid[9:14, 9:14].any()      # hole + 1-cell ring excluded
    wm = s.window_metrics(2, 2, 20)
    assert wm["valid_fraction"] == pytest.approx((400 - 25) / 400)
    assert wm["status"] == "valid" or wm["valid_fraction"] < C.MIN_VALID_FRACTION


def test_large_hole_rejects_window_with_reason():
    z = np.zeros((N, N)) + 10
    valid = np.ones_like(z, bool)
    valid[5:15, 5:15] = False
    wm = TerrainSurface(z, valid).window_metrics(2, 2, 20)
    assert wm["status"] == "invalid"
    assert any("valid_fraction" in r for r in wm["reasons"])
    assert wm["metrics"]["slope_histogram"] is None and wm["metrics"]["relief_p95_p05_m"] is None


def test_suspected_water_rejected():
    z = np.zeros((N, N))
    s = TerrainSurface(z, np.ones_like(z, bool), all_zero=np.ones_like(z, bool))
    wm = s.window_metrics(2, 2, 20, check_water=True)
    assert wm["status"] == "invalid" and any("water" in r for r in wm["reasons"])


def test_histogram_sums_to_one_and_includes_90():
    h = slope_histogram(np.array([0, 0.5, 1, 2.9, 4, 9, 19, 29, 44, 45, 89, 90.0]))
    assert len(h) == 8 and math.isclose(sum(h), 1.0)
    assert h[-1] == pytest.approx(3 / 12)     # 45, 89 and 90 (last right edge included)
    assert h[0] == pytest.approx(2 / 12)      # 1 belongs to [1,3)


def test_histogram_rejects_nonfinite_and_empty():
    with pytest.raises(FeatureError):
        slope_histogram(np.array([1.0, np.nan]))
    with pytest.raises(FeatureError):
        slope_histogram(np.array([]))


def test_relief_percentiles():
    z = np.tile(np.arange(N, dtype=float), (N, 1)) * 0.0
    z[2:22, 2:22] = np.arange(400, dtype=float).reshape(20, 20)
    wm = TerrainSurface(z, np.ones_like(z, bool)).window_metrics(2, 2, 20)
    vals = np.arange(400.0)
    assert wm["metrics"]["relief_p95_p05_m"] == pytest.approx(np.percentile(vals, 95) - np.percentile(vals, 5))
