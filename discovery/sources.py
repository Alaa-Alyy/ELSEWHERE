"""Global elevation sources as Person 1 RasterSource crops (physical metres, validity mask).

* Earth : NASA SRTMGL30 v002 (30 arc-second, ~926 m), 27 tiles mosaicked virtually (memmap).
* Moon  : NASA LRO LOLA LDEM_64 (64 px/deg, ~474 m) global PDS product; south of -80 deg the
          LOLA south-pole LDEM_80S_80MPP_ADJ (80 m, Barker et al. 2023) via GDAL range reads.
* Mars  : NASA/USGS MOLA 463 m global DEM via GDAL range reads (no full download).

Crops use a geographic CRS with +lon_wrap=<centre>, so windows across the 180/360 meridian work.
"""
from __future__ import annotations

import math
import os
import re
import zipfile
from functools import lru_cache
from pathlib import Path

import numpy as np
from pyproj import CRS

from analysis import preprocess as P

ROOT = Path(__file__).resolve().parents[1]
EARTH_DIR = ROOT / "data" / "raw" / "earth" / "global"
MOON_DIR = ROOT / "data" / "raw" / "moon" / "global"
MOLA_URL = "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"
LOLA_SP_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"
RADIUS = {"earth": 6371008.8, "moon": 1737400.0, "mars": 3396190.0}
FIGURE = {"earth": "+datum=WGS84", "moon": "+R=1737400", "mars": "+R=3396190"}


class SourceUnavailable(RuntimeError):
    pass


def wrap_crs(body: str, lon_center: float) -> CRS:
    return CRS.from_proj4(f"+proj=longlat {FIGURE[body]} +lon_wrap={lon_center:.6f} +no_defs")


def half_extent_deg(body: str, lat: float, half_m: float) -> tuple[float, float]:
    """Half-size in degrees (lat, lon) of a square of half side half_m around lat (with margin)."""
    r = RADIUS[body]
    dlat = math.degrees(half_m / r) * 1.15
    coslat = max(math.cos(math.radians(min(abs(lat) + dlat, 89.9))), 1e-6)
    dlon = min(180.0, math.degrees(half_m / (r * coslat)) * 1.15)
    return dlat, dlon


# ----------------------------------------------------------------------------- Earth SRTMGL30
TILE_RE = re.compile(r"([ew])(\d{3})([ns])(\d{2})", re.I)


def _parse_tile(name: str) -> tuple[float, float]:
    m = TILE_RE.search(name)
    lon = int(m.group(2)) * (-1 if m.group(1).lower() == "w" else 1)
    lat = int(m.group(4)) * (-1 if m.group(3).lower() == "s" else 1)
    return lon, lat  # upper-left corner


def extract_srtmgl30(src_dir: Path = EARTH_DIR) -> Path:
    """Unzip .dem/.hdr once into <src_dir>/dem/ (memory-mapped later)."""
    out = src_dir / "dem"
    out.mkdir(parents=True, exist_ok=True)
    for z in sorted(src_dir.glob("*.zip")):
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if n.lower().endswith((".dem", ".hdr")) and not (out / Path(n).name).exists() \
                        and zf.getinfo(n).file_size > 0:
                    with zf.open(n) as fi, open(out / Path(n).name, "wb") as fo:
                        fo.write(fi.read())
    return out


def _read_hdr(path: Path) -> dict:
    d = {}
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) >= 2:
            d[parts[0].upper()] = parts[1]
    return d


class EarthMosaic:
    """Virtual global 30 arc-second grid: 43200 cols (lon -180..180) x 21600 rows (lat 90..-90)."""
    PX = 1.0 / 120.0
    NCOLS, NROWS = 43200, 21600

    # SRTMGL30 v002 zips hold only the .DEM (no .HDR); layout is the documented GTOPO30 tiling:
    # 40 x 50 degree tiles = 4800 x 6000 int16 big-endian, nodata -9999, name = upper-left corner.
    TILE_ROWS, TILE_COLS, NODATA = 6000, 4800, -9999.0

    def __init__(self, dem_dir: Path | None = None):
        dem_dir = dem_dir or (EARTH_DIR / "dem")
        self.tiles = []
        for dem in sorted(p for p in dem_dir.iterdir() if p.suffix.lower() == ".dem"):
            hdr = next((p for p in dem_dir.iterdir() if p.stem.lower() == dem.stem.lower()
                        and p.suffix.lower() == ".hdr"), None)
            h = _read_hdr(hdr) if hdr else {}
            rows, cols = int(h.get("NROWS", self.TILE_ROWS)), int(h.get("NCOLS", self.TILE_COLS))
            if dem.stat().st_size != rows * cols * 2:
                raise SourceUnavailable(f"{dem.name}: size {dem.stat().st_size} != {rows}x{cols} int16")
            dtype = ">i2" if h.get("BYTEORDER", "M").upper() == "M" else "<i2"
            ulx, uly = _parse_tile(dem.name)
            r0 = int(round((90.0 - uly) / self.PX))
            c0 = int(round((ulx + 180.0) / self.PX))
            arr = np.memmap(dem, dtype=dtype, mode="r", shape=(rows, cols))
            self.tiles.append((r0, c0, rows, cols, arr, float(h.get("NODATA", self.NODATA))))
        if not self.tiles:
            raise SourceUnavailable(f"no SRTMGL30 tiles in {dem_dir} (run scripts/fetch_data.py earth-global)")

    def crop(self, lat: float, lon: float, half_m: float) -> P.RasterSource:
        dlat, dlon = half_extent_deg("earth", lat, half_m)
        r_lo = max(0, int(math.floor((90.0 - (lat + dlat)) / self.PX)))
        r_hi = min(self.NROWS, int(math.ceil((90.0 - (lat - dlat)) / self.PX)))
        c_lo = int(math.floor((lon - dlon + 180.0) / self.PX))
        c_hi = int(math.ceil((lon + dlon + 180.0) / self.PX))
        z = np.full((r_hi - r_lo, c_hi - c_lo), np.nan)
        cols = np.arange(c_lo, c_hi) % self.NCOLS
        for (r0, c0, rows, ncol, arr, nodata) in self.tiles:
            rr = slice(max(r_lo, r0), min(r_hi, r0 + rows))
            if rr.start >= rr.stop:
                continue
            sel = np.nonzero((cols >= c0) & (cols < c0 + ncol))[0]
            if sel.size == 0:
                continue
            block = np.asarray(arr[rr.start - r0:rr.stop - r0, cols[sel] - c0], dtype=np.float64)
            block[block == nodata] = np.nan
            z[rr.start - r_lo:rr.stop - r_lo, sel] = block
        valid = np.isfinite(z)
        gt = (c_lo * self.PX - 180.0, self.PX, 0.0, 90.0 - r_lo * self.PX, 0.0, -self.PX)
        return P.RasterSource(name=f"SRTMGL30 crop {lat:.3f},{lon:.3f}", elevation_m=z, valid=valid,
                              geotransform=gt, native_crs=wrap_crs("earth", lon))


# ----------------------------------------------------------------------------- Moon LDEM_64
def _pds_label(path: Path) -> dict:
    out = {}
    for line in path.read_text(errors="ignore").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            out.setdefault(k.strip().upper(), v.strip().split()[0].strip('"'))
    return out


class LolaGlobal:
    """LDEM_64.IMG: int16 LSB, DN*SCALING_FACTOR = height (m) above 1737.4 km; lon 0..360 east."""

    def __init__(self, img: Path | None = None):
        img = img or (MOON_DIR / "ldem_64.img")
        lbl = img.with_suffix(".lbl")
        if not img.exists() or not lbl.exists():
            raise SourceUnavailable("LDEM_64 not downloaded (run scripts/fetch_data.py moon-global)")
        L = _pds_label(lbl)
        self.rows, self.cols = int(L["LINES"]), int(L["LINE_SAMPLES"])
        self.scale = float(L.get("SCALING_FACTOR", 0.5))
        self.offset = float(L.get("OFFSET", 1737400.0))
        if self.offset > 1000:            # OFFSET is the reference radius, not a height offset
            self.offset = 0.0
        self.ppd = float(L["MAP_RESOLUTION"])
        self.lat_max = float(L["MAXIMUM_LATITUDE"])
        self.lon_west = float(L["WESTERNMOST_LONGITUDE"])
        dtype = "<i2" if "LSB" in L.get("SAMPLE_TYPE", "LSB_INTEGER") else ">i2"
        self.arr = np.memmap(img, dtype=dtype, mode="r", shape=(self.rows, self.cols))
        if os.path.getsize(img) != self.rows * self.cols * 2:
            raise SourceUnavailable("LDEM_64 file size does not match its label")

    def crop(self, lat: float, lon: float, half_m: float) -> P.RasterSource:
        px = 1.0 / self.ppd
        dlat, dlon = half_extent_deg("moon", lat, half_m)
        r_lo = max(0, int(math.floor((self.lat_max - (lat + dlat)) / px)))
        r_hi = min(self.rows, int(math.ceil((self.lat_max - (lat - dlat)) / px)))
        lon_e = lon % 360.0
        c_lo = int(math.floor((lon_e - dlon - self.lon_west) / px))
        c_hi = int(math.ceil((lon_e + dlon - self.lon_west) / px))
        cols = np.arange(c_lo, c_hi) % self.cols
        z = np.asarray(self.arr[r_lo:r_hi][:, cols], dtype=np.float64) * self.scale + self.offset
        x0 = self.lon_west + c_lo * px
        x0 = x0 - 360.0 * round((x0 + (c_hi - c_lo) * px / 2 - lon) / 360.0)   # continuous around lon
        gt = (x0, px, 0.0, self.lat_max - r_lo * px, 0.0, -px)
        return P.RasterSource(name=f"LOLA LDEM_64 crop {lat:.3f},{lon:.3f}", elevation_m=z,
                              valid=np.isfinite(z), geotransform=gt, native_crs=wrap_crs("moon", lon))


# ----------------------------------------------------------------------------- remote GeoTIFFs
def _remote_crop(url: str, body: str, lat: float, lon: float, half_m: float, name: str) -> P.RasterSource:
    """Range-read the projected window around (lat, lon) and return it in its native CRS."""
    import rasterio
    from pyproj import Transformer
    from rasterio.windows import Window, from_bounds

    os.environ.setdefault("GDAL_HTTP_TIMEOUT", "60")
    os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "3")
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    with rasterio.open("/vsicurl/" + url) as s:
        crs = CRS.from_wkt(s.crs.to_wkt())
        grid = P.GridSpec(size_cells=int(round(2 * half_m / 1000)) - 2 * P.C.BUFFER_CELLS)
        t = Transformer.from_crs(P.local_aeqd_crs(body, lat, lon), crs, always_xy=True)
        bx, by = t.transform(*grid.boundary_points().T)
        if not (np.all(np.isfinite(bx)) and np.all(np.isfinite(by))):
            raise SourceUnavailable("window cannot be mapped into the source projection")
        pad = 2 * abs(s.res[0])
        win = from_bounds(min(bx) - pad, min(by) - pad, max(bx) + pad, max(by) + pad, s.transform)
        win = win.round_offsets().round_lengths()
        full = Window(0, 0, s.width, s.height)
        if not (win.col_off >= 0 and win.row_off >= 0 and win.col_off + win.width <= s.width
                and win.row_off + win.height <= s.height):
            win = win.intersection(full)
        data = s.read(1, window=win, masked=False).astype(np.float64)
        nod = s.nodata
        valid = np.isfinite(data) if nod is None or (isinstance(nod, float) and math.isnan(nod)) else data != nod
        scale, offset = (s.scales[0] or 1.0), (s.offsets[0] or 0.0)
        data = data * scale + offset
        data[~valid] = np.nan
        tr = s.window_transform(win)
    gt = (tr.c, tr.a, 0.0, tr.f, 0.0, tr.e)
    return P.RasterSource(name=name, elevation_m=data, valid=valid, geotransform=gt, native_crs=crs)


@lru_cache(maxsize=1)
def lola_global() -> LolaGlobal:
    return LolaGlobal()


@lru_cache(maxsize=1)
def earth_mosaic() -> EarthMosaic:
    return EarthMosaic()


PIN_LAT_LIMIT = {"mars": 85.0, "moon": 87.0}


def pin_source(body: str, lat: float, lon: float, half_m: float) -> tuple[P.RasterSource, str]:
    """Raster crop for a Moon/Mars pin and the SourceRecord id it comes from."""
    if body == "mars":
        return _remote_crop(MOLA_URL, "mars", lat, lon, half_m, f"MOLA 463 m crop {lat:.3f},{lon:.3f}"), \
            "mars-mola-mgs-dem-463m"
    if body == "moon":
        if lat <= -80.5:
            return _remote_crop(LOLA_SP_URL, "moon", lat, lon, half_m, f"LOLA 80S 80 m crop {lat:.3f},{lon:.3f}"), \
                "moon-lola-ldem-80s-80mpp-adj"
        return lola_global().crop(lat, lon, half_m), "moon-lola-ldem-64"
    raise ValueError(f"pins are Moon/Mars only, got {body!r}")
