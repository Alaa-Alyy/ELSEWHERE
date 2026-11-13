"""Moon/Mars reference path: GeoTIFF (no GDAL) -> body-figure checks -> 20 km reference record."""
import json

import numpy as np
import pytest
import tifffile
from pyproj import CRS, Transformer

from analysis import config as C
from analysis import preprocess as P
from analysis.build_candidates import sha256_file
from analysis.extract_features import extract_reference

# the exact native CRS WKTs recorded by data-setup for the real MOLA / LOLA crops
_SRC = C.REPO_ROOT / "data" / "sources"
MARS_WKT = json.loads((_SRC / "mars_sources.json").read_text(encoding="utf-8"))["items"][0]["native_crs_wkt"]
MOON_WKT = json.loads((_SRC / "moon_sources.json").read_text(encoding="utf-8"))["items"][0]["native_crs_wkt"]


def write_geotiff(path, arr, x0, y0, px, nodata=None, pixel_is_point=False, compression=None):
    tags = [(33550, "d", 3, (px, px, 0.0)), (33922, "d", 6, (0.0, 0.0, 0.0, x0, y0, 0.0)),
            (34735, "H", 8, (1, 1, 0, 1, 1025, 0, 1, 2 if pixel_is_point else 1))]
    if nodata is not None:
        tags.append((42113, "s", 0, str(nodata)))
    tifffile.imwrite(path, arr, extratags=tags, compression=compression)


def crop_around(wkt, lat, lon, px, half_m, fn, dtype):
    crs = CRS.from_wkt(wkt)
    geo = CRS.from_proj4(f"+proj=longlat +R={crs.ellipsoid.semi_major_metre} +no_defs")
    cx, cy = Transformer.from_crs(geo, crs, always_xy=True).transform(lon, lat)
    n = int(2 * half_m / px)
    x0, y0 = cx - half_m, cy + half_m
    xs = x0 + (np.arange(n) + 0.5) * px
    ys = y0 - (np.arange(n) + 0.5) * px
    X, Y = np.meshgrid(xs - cx, ys - cy)
    return fn(X, Y).astype(dtype), x0, y0


def _rasterio_ok():
    try:
        import rasterio  # noqa: F401
        return True
    except ImportError:
        return False


READERS = ["tifffile"] + (["rasterio"] if _rasterio_ok() else [])


@pytest.mark.parametrize("reader", READERS)
@pytest.mark.parametrize("pixel_is_point", [False, True])
def test_geotiff_reader_georeferencing_and_nodata(tmp_path, pixel_is_point, reader):
    arr = np.arange(12, dtype="<i2").reshape(3, 4)
    arr[1, 1] = -32768
    f = tmp_path / "m.tif"
    write_geotiff(f, arr, 1000.0, 5000.0, 463.0, nodata=-32768, pixel_is_point=pixel_is_point, compression="zlib")
    src, info = P.read_geotiff(f, MARS_WKT, reader=reader)
    shift = -231.5 if pixel_is_point else 0.0
    assert src.geotransform == pytest.approx((1000.0 + shift, 463.0, 0, 5000.0 - shift, 0, -463.0))
    assert not src.valid[1, 1] and np.isnan(src.elevation_m[1, 1]) and src.elevation_m[2, 3] == 11
    assert info["nodata"] == -32768 and info["scale"] == 1.0


@pytest.mark.parametrize("reader", READERS)
def test_geotiff_nan_nodata(tmp_path, reader):
    arr = np.ones((4, 4), dtype="<f4")
    arr[0, 0] = np.nan
    f = tmp_path / "l.tif"
    write_geotiff(f, arr, 0.0, 0.0, 80.0, nodata="nan")
    src, info = P.read_geotiff(f, MOON_WKT, reader=reader)
    assert not src.valid[0, 0] and src.valid.sum() == 15
    assert info["crs_source"] == "SourceRecord native_crs_wkt"    # synthetic file has no CRS geokeys


@pytest.fixture()
def planetary(tmp_path, monkeypatch):
    monkeypatch.setattr(C, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(C, "SOURCES_DIR", tmp_path / "sources")
    C.SOURCES_DIR.mkdir()
    out = {}
    specs = {"mars": ("mars-jezero", 18.44, 77.45, MARS_WKT, 463.0935, "<f4", -32768,
                      lambda x, y: -2000 + 0.017 * x),
             "moon": ("moon-south-pole-sector", -85.0, 0.0, MOON_WKT, 80.0, "<f4", "nan",
                      lambda x, y: 100 + 0.05 * np.hypot(x, y))}
    for body, (rid, lat, lon, wkt, px, dt, nd, fn) in specs.items():
        arr, x0, y0 = crop_around(wkt, lat, lon, px, 20000.0, fn, dt)
        f = tmp_path / f"{rid}.tif"
        write_geotiff(f, arr, x0, y0, px, nodata=nd, compression="zlib")
        sid = f"{rid}-src"
        (C.SOURCES_DIR / f"{body}_sources.json").write_text(json.dumps({"items": [
            {"id": sid, "filename": f.name, "sha256": sha256_file(f), "native_crs_wkt": wkt}]}))
        out[body] = {"id": rid, "body": body, "name": rid, "center": {"lat": lat, "lon": lon},
                     "source_ids": [sid], "limitations": ["config limitation"]}
    return out


def test_mars_reference_plane_slope(planetary):
    rec, man = extract_reference(planetary["mars"])
    assert rec["analysis"]["status"] == "valid" and rec["kind"] == "reference"
    # eqc x = R*dlon but ground E-W = R*cos(lat)*dlon -> true slope atan(0.017/cos(lat)) = 1.03 deg (bin [1,3));
    # wrongly using eqc metres as ground metres would give 0.97 deg (bin [0,1))
    assert np.degrees(np.arctan(0.017 / np.cos(np.radians(18.44)))) > 1.0 > np.degrees(np.arctan(0.017))
    assert rec["metrics"]["slope_histogram"][1] == pytest.approx(1.0)
    assert rec["metrics"]["relief_p95_p05_m"] > 0
    assert "never draw on Earth" in rec["coordinate_convention"]
    assert "config limitation" in rec["limitations"]
    assert man["inputs"][0]["sha256"] and "tifffile" in man["native_read"]["reader"] or "rasterio" in man["native_read"]["reader"]
    assert "+R=3396190" in man["analysis_crs_proj4"]


def test_moon_reference_cone_slope(planetary):
    rec, _ = extract_reference(planetary["moon"])
    assert rec["analysis"]["status"] == "valid"
    # cone with gradient 0.05 -> slope atan(0.05) = 2.86 deg; all cells in the [1,3) bin
    assert rec["metrics"]["slope_histogram"][1] == pytest.approx(1.0)


def test_reference_rejects_wgs84_figure(planetary):
    js = json.loads((C.SOURCES_DIR / "mars_sources.json").read_text())
    js["items"][0]["native_crs_wkt"] = CRS.from_epsg(4326).to_wkt()
    (C.SOURCES_DIR / "mars_sources.json").write_text(json.dumps(js))
    with pytest.raises(P.PreprocessError, match="sphere"):
        extract_reference(planetary["mars"])


def test_reference_window_must_be_inside_crop(planetary):
    cfg = {**planetary["mars"], "center": {"lat": 18.60, "lon": 77.45}}   # ~9.5 km off -> window leaves the crop
    with pytest.raises(P.PreprocessError, match="inside the native crop"):
        extract_reference(cfg)


def test_reference_missing_raw_file_is_reported(planetary):
    (C.REPO_ROOT / "mars-jezero.tif").unlink()
    with pytest.raises(P.PreprocessError, match="raw file missing"):
        extract_reference(planetary["mars"])
