import zipfile

import numpy as np
import pytest
from pyproj import Transformer

from analysis import config as C
from analysis import preprocess as P


def test_hgt_reader_masks_voids_and_applies_no_rescale(tmp_path):
    n = C.SRTM["tile_size"]
    arr = np.full((n, n), 250, dtype=">i2")
    arr[100, 200] = -32768
    arr[0, 0] = -5          # real below-sea-level height must be kept
    p = tmp_path / "N25E039.SRTMGL1.hgt.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("N25E039.hgt", arr.tobytes())
    src = P.read_srtm_hgt(p)
    assert not src.valid[100, 200] and np.isnan(src.elevation_m[100, 200])
    assert src.elevation_m[0, 0] == -5 and src.elevation_m[5, 5] == 250
    x0, dx, _, y0, _, dy = src.geotransform
    assert x0 + 0.5 * dx == pytest.approx(39.0) and y0 + 0.5 * dy == pytest.approx(26.0)
    assert src.usable_rows == n - 1


def test_hgt_reader_rejects_truncated(tmp_path):
    p = tmp_path / "N25E039.hgt"
    p.write_bytes(b"\x00" * 1000)
    with pytest.raises(P.PreprocessError):
        P.read_srtm_hgt(p)


def _fine_source(body, lat, lon, fn, pixel_m=100.0, extent_m=40000.0, hole=None):
    crs = P.local_aeqd_crs(body, lat, lon)
    n = int(2 * extent_m / pixel_m)
    c = (np.arange(n) + 0.5) * pixel_m - extent_m
    X, Y = np.meshgrid(c, -c)
    z = fn(X, Y)
    valid = np.ones_like(z, bool)
    if hole is not None:
        valid[hole] = False
        z = np.where(valid, z, np.nan)
    return P.RasterSource("synthetic", z, valid, (-extent_m, pixel_m, 0, extent_m, 0, -pixel_m), crs)


def test_area_average_regrid_reproduces_plane():
    src = _fine_source("mars", 18.4, 77.5, lambda x, y: 0.05 * x - 0.02 * y + 100)
    grid = P.GridSpec(size_cells=20)
    acc = P.Accumulator(grid)
    P.accumulate_source(src, P.local_aeqd_crs("mars", 18.4, 77.5), acc)
    rg = acc.finalize()
    assert rg.valid.all()
    xc, yc = grid.cell_center(3, 7)
    assert rg.elevation[3, 7] == pytest.approx(0.05 * xc - 0.02 * yc + 100, abs=1e-6)


def test_regrid_keeps_missing_data_missing_and_refuses_upsampling():
    src = _fine_source("moon", -89.5, 0.0, lambda x, y: x * 0 + 10, hole=(slice(0, 400), slice(0, 400)))
    acc = P.Accumulator(P.GridSpec(size_cells=20))
    P.accumulate_source(src, P.local_aeqd_crs("moon", -89.5, 0.0), acc)
    rg = acc.finalize()
    assert (~rg.valid).sum() > 0 and np.isnan(rg.elevation[~rg.valid]).all()
    assert np.allclose(rg.elevation[rg.valid], 10.0)
    coarse = _fine_source("moon", -89.5, 0.0, lambda x, y: x * 0, pixel_m=2000.0)
    acc2 = P.Accumulator(P.GridSpec(size_cells=20))
    with pytest.raises(P.PreprocessError, match="upsample"):
        P.accumulate_source(coarse, P.local_aeqd_crs("moon", -89.5, 0.0), acc2)


def test_coarse_pixels_are_area_weighted():
    """463 m pixels: k x k sub-sampling keeps a plane exact to well under 1 m per 1000 m cell."""
    crs = P.local_aeqd_crs("mars", 18.4, 77.5)
    src = _fine_source("mars", 18.4, 77.5, lambda x, y: 0.05 * x + 100, pixel_m=463.0935, extent_m=15000.0)
    acc = P.Accumulator(P.GridSpec(size_cells=20))
    P.accumulate_source(src, crs, acc)
    rg = acc.finalize()
    assert rg.stats["subsamples_per_source_pixel"] == 16
    g = P.GridSpec(size_cells=20)
    xc = np.array([[g.cell_center(r, c)[0] for c in range(g.n)] for r in range(g.n)])
    err = np.abs(rg.elevation - (0.05 * xc + 100))[rg.valid]
    assert err.max() < 0.05 * 463 / 4


def test_radius_product_requires_documented_conversion(tmp_path):
    arr = np.full((10, 10), 1737.5, dtype="<f4")
    f = tmp_path / "r.img"
    f.write_bytes(arr.tobytes())
    spec = {"path": str(f), "format": "raw", "dtype": "<f4", "rows": 10, "cols": 10,
            "geotransform": [0, 100, 0, 0, 0, -100], "native_crs": "+proj=longlat +R=1737400 +no_defs",
            "value_kind": "radius", "units": "km"}
    with pytest.raises(P.PreprocessError, match="reference_radius_m"):
        P.read_raw_source(spec, tmp_path)
    src = P.read_raw_source({**spec, "reference_radius_m": 1737400}, tmp_path)
    assert np.allclose(src.elevation_m, 100.0, atol=0.1)


def test_body_figures_differ():
    e = P.local_aeqd_crs("earth", 0, 0).ellipsoid.semi_major_metre
    m = P.local_aeqd_crs("moon", 0, 0).ellipsoid.semi_major_metre
    r = P.local_aeqd_crs("mars", 0, 0).ellipsoid.semi_major_metre
    assert (e, m, r) == (6378137.0, 1737400.0, 3396190.0)


def test_tile_selection_covers_all_projected_corners():
    grid = P.GridSpec(size_cells=C.PARENT_SIZE_CELLS)
    bbox = P.required_geographic_bbox("earth", 31.77, -113.5, grid)
    tiles = P.srtm_tiles_for_bbox(bbox)
    t = Transformer.from_crs(P.local_aeqd_crs("earth", 31.77, -113.5), P.geographic_crs("earth"), always_xy=True)
    h = grid.half_extent_m
    for x, y in [(-h, h), (h, h), (h, -h), (-h, -h)]:
        lo, la = t.transform(x, y)
        name = f"N{int(np.floor(la)):02d}W{int(-np.floor(lo)):03d}"
        assert name in tiles
