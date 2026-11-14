"""MissionMatch v2 raw-data fetcher.

Pulls ONLY the small pieces of each official DEM that the project needs and
writes a SourceRecord (with SHA-256) for every file.

    python scripts/fetch_data.py mars     # USGS MOLA 463 m crop (no login)
    python scripts/fetch_data.py moon     # NASA LOLA 80 m crop  (no login)
    python scripts/fetch_data.py earth    # SRTMGL1 v003 tiles   (needs EARTHDATA_TOKEN)
    python scripts/fetch_data.py earth --list   # just print the tiles needed

Raw output goes to data/raw/<body>/ (gitignored). Source records go to
data/sources/<body>_sources.json (committed).

This script only reads/crops/downloads. Feature extraction and scoring are
Person 1's analysis/ pipeline; nothing here computes metrics.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
SOURCES = ROOT / "data" / "sources"
CONFIG = ROOT / "data" / "config"

MARS_URL = "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"
MOON_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"
SRTM_URL = "https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/SRTMGL1.003/{t}.SRTMGL1.hgt/{t}.SRTMGL1.hgt.zip"


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_sources(body: str, records: list[dict], merge: bool = False) -> None:
    """Write data/sources/<body>_sources.json. merge=True keeps existing records with other ids."""
    SOURCES.mkdir(parents=True, exist_ok=True)
    out = SOURCES / f"{body}_sources.json"
    if merge and out.exists():
        old = json.loads(out.read_text(encoding="utf-8-sig")).get("items", [])
        new_ids = {r["id"] for r in records}
        records = [r for r in old if r["id"] not in new_ids] + records
    out.write_text(json.dumps({"schema_version": "2.0", "items": records}, indent=2), encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}")


def load_json(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- #
# Remote crop helper (GDAL /vsicurl/ range reads; no full download)
# --------------------------------------------------------------------------- #
def crop_remote(url: str, bounds_native: tuple[float, float, float, float], out: Path) -> dict:
    import numpy as np
    import rasterio
    from rasterio.windows import from_bounds

    os.environ.setdefault("GDAL_HTTP_TIMEOUT", "60")
    os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "3")
    os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")

    with rasterio.open("/vsicurl/" + url) as src:
        win = from_bounds(*bounds_native, transform=src.transform).round_offsets().round_lengths()
        data = src.read(1, window=win)
        transform = src.window_transform(win)
        profile = src.profile.copy()
        profile.update(driver="GTiff", width=data.shape[1], height=data.shape[0],
                       transform=transform, compress="deflate", tiled=False)
        for k in ("blockxsize", "blockysize", "interleave"):
            profile.pop(k, None)
        meta = {
            "native_crs_wkt": src.crs.to_wkt(),
            "native_resolution": f"{src.res[0]:.4f} m x {src.res[1]:.4f} m",
            "dtype": src.dtypes[0],
            "nodata": None if src.nodata is None or (isinstance(src.nodata, float) and math.isnan(src.nodata)) else src.nodata,
            "nodata_is_nan": isinstance(src.nodata, float) and math.isnan(src.nodata),
            "scale": src.scales[0],
            "offset": src.offsets[0],
            "source_size_px": [src.width, src.height],
        }
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(data, 1)

    valid = data != meta["nodata"] if meta["nodata"] is not None else np.isfinite(data)
    if meta["nodata_is_nan"]:
        valid = np.isfinite(data)
    meta.update({
        "crop_shape_px": list(data.shape),
        "crop_valid_fraction": round(float(valid.mean()), 6),
        "crop_min": float(data[valid].min()) if valid.any() else None,
        "crop_max": float(data[valid].max()) if valid.any() else None,
        "crop_bounds_native": [round(b, 3) for b in bounds_native],
    })
    if not valid.any():
        raise SystemExit(f"Crop {out.name} has no valid pixels - refusing to record it.")
    return meta


# --------------------------------------------------------------------------- #
# Mars
# --------------------------------------------------------------------------- #
def fetch_mars() -> None:
    cfg = load_json(CONFIG / "mars_region.json")
    lat, lon = cfg["center"]["lat"], cfg["center"]["lon"]
    half_m = cfg["crop_size_km"] * 1000 / 2
    R = 3396190.0  # radius declared in the source GeoTIFF CRS
    # Simple-cylindrical grid: y = R*lat, x = R*lon (radians). Widen x by 1/cos(lat)
    # so the crop covers half_m of true ground distance east-west.
    cx, cy = R * math.radians(lon), R * math.radians(lat)
    hx = half_m / math.cos(math.radians(lat))
    bounds = (cx - hx, cy - half_m, cx + hx, cy + half_m)

    out = RAW / "mars" / "mars-jezero_mola463m_crop40km.tif"
    print(f"cropping Mars MOLA around ({lat}, {lon}) ...")
    meta = crop_remote(MARS_URL, bounds, out)
    rec = {
        "id": "mars-mola-mgs-dem-463m",
        "title": "Mars MGS MOLA DEM 463m (global mosaic) - 40 km crop around Jezero",
        "agency": "NASA / USGS Astrogeology",
        "product": "Mars_MGS_MOLA_DEM_mosaic_global_463m",
        "version": "unknown (USGS mosaic; see landing page)",
        "landing_url": "https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m",
        "download_url": MARS_URL,
        "downloaded_at_utc": now_utc(),
        "filename": f"data/raw/mars/{out.name}",
        "sha256": sha256(out),
        "units": "meters (int16, scale 1, offset 0); heights relative to the MOLA areoid per USGS product description - verify on landing page",
        "native_resolution": meta["native_resolution"] + " (~128 px/deg)",
        "native_crs_wkt": meta["native_crs_wkt"],
        "citation": "Smith, D.E., et al. (2001), Mars Orbiter Laser Altimeter: Experiment summary after the first year of global mapping of Mars, J. Geophys. Res., 106(E10), 23689-23722. USGS Astrogeology MOLA 463 m mosaic.",
        "license_or_usage_notes": "NASA/USGS public-domain planetary data; cite MOLA team and USGS Astrogeology.",
        "processing_notes": {
            "method": "GDAL /vsicurl/ windowed read of the official GeoTIFF; pixels copied unchanged (no resampling).",
            "nodata": meta["nodata"],
            **{k: meta[k] for k in ("dtype", "scale", "offset", "source_size_px", "crop_shape_px",
                                    "crop_valid_fraction", "crop_min", "crop_max", "crop_bounds_native")},
            "region_config": "data/config/mars_region.json",
        },
    }
    write_sources("mars", [rec])
    print(json.dumps(rec["processing_notes"], indent=2))


# --------------------------------------------------------------------------- #
# Moon
# --------------------------------------------------------------------------- #
def fetch_moon() -> None:
    import rasterio
    from rasterio.crs import CRS
    from rasterio.warp import transform as warp_transform

    cfg = load_json(CONFIG / "moon_region.json")
    lat, lon = cfg["center"]["lat"], cfg["center"]["lon"]
    half_m = cfg["crop_size_km"] * 1000 / 2
    with rasterio.open("/vsicurl/" + MOON_URL) as src:
        proj = src.crs
    # Moon geographic CRS = the projected CRS's own datum (never Earth WGS84).
    from pyproj import CRS as PCRS
    geog = CRS.from_wkt(PCRS.from_wkt(proj.to_wkt()).geodetic_crs.to_wkt())
    xs, ys = warp_transform(geog, proj, [lon], [lat])
    cx, cy = xs[0], ys[0]
    bounds = (cx - half_m, cy - half_m, cx + half_m, cy + half_m)

    out = RAW / "moon" / "moon-south-pole-sector_lola80m_crop40km.tif"
    print(f"cropping LOLA around ({lat}, {lon}) -> polar stereo ({cx:.1f}, {cy:.1f}) ...")
    meta = crop_remote(MOON_URL, bounds, out)
    rec = {
        "id": "moon-lola-ldem-80s-80mpp-adj",
        "title": "LOLA south pole DEM LDEM_80S_80MPP_ADJ - 40 km crop around (-85, 0)",
        "agency": "NASA GSFC PGDA",
        "product": "LDEM_80S_80MPP_ADJ.TIF",
        "version": "ADJ (Barker et al. 2023 release)",
        "landing_url": "https://pgda.gsfc.nasa.gov/products/90",
        "download_url": MOON_URL,
        "downloaded_at_utc": now_utc(),
        "filename": f"data/raw/moon/{out.name}",
        "sha256": sha256(out),
        "units": "meters (float32); heights relative to 1737.4 km sphere (file history: km x 1000)",
        "native_resolution": meta["native_resolution"],
        "native_crs_wkt": meta["native_crs_wkt"],
        "citation": "Barker, M.K., et al. (2023), Improved LOLA elevation maps for south pole landing sites, Planet. Sci. J., DOI 10.3847/PSJ/acf3e1. Dataset DOI 10.60903/gsfcpgda-lola-spole.",
        "license_or_usage_notes": "NASA public data; cite paper and dataset DOI.",
        "processing_notes": {
            "method": "GDAL /vsicurl/ windowed read of the official GeoTIFF; pixels copied unchanged (no resampling).",
            "nodata": "NaN" if meta["nodata_is_nan"] else meta["nodata"],
            **{k: meta[k] for k in ("dtype", "scale", "offset", "source_size_px", "crop_shape_px",
                                    "crop_valid_fraction", "crop_min", "crop_max", "crop_bounds_native")},
            "region_config": "data/config/moon_region.json",
        },
    }
    write_sources("moon", [rec])
    print(json.dumps(rec["processing_notes"], indent=2))


# --------------------------------------------------------------------------- #
# Earth (SRTMGL1 v003 tiles; requires a free Earthdata Login token)
# --------------------------------------------------------------------------- #
def tile_name(lat: int, lon: int) -> str:
    return f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}{'E' if lon >= 0 else 'W'}{abs(lon):03d}"


def earth_tiles() -> dict[str, list[str]]:
    cfg = load_json(CONFIG / "regions.json")
    half_km = cfg["analysis"]["parent_size_km"] / 2 + cfg["analysis"]["download_buffer_km"]
    out: dict[str, list[str]] = {}
    for p in cfg["parents"]:
        lat, lon = p["center"]["lat"], p["center"]["lon"]
        # Square is projected (local metric); use the corner diagonal to be safe.
        diag = half_km * math.sqrt(2)
        dlat = diag / 110.574
        dlon = diag / (111.320 * math.cos(math.radians(lat + math.copysign(dlat, lat))))
        tiles = [tile_name(a, b)
                 for a in range(math.floor(lat - dlat), math.floor(lat + dlat) + 1)
                 for b in range(math.floor(lon - dlon), math.floor(lon + dlon) + 1)]
        out[p["id"]] = tiles
    return out


def download(url: str, out: Path, token: str, retries: int = 3) -> None:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                ctype = r.headers.get("Content-Type", "")
                if "html" in ctype:
                    raise RuntimeError(f"got HTML ({ctype}) - login/token problem")
                tmp = out.with_suffix(out.suffix + ".part")
                with open(tmp, "wb") as f:
                    while chunk := r.read(1 << 20):
                        f.write(chunk)
            if tmp.stat().st_size == 0:
                raise RuntimeError("zero-byte file")
            with zipfile.ZipFile(tmp) as z:  # rejects HTML / partial files
                if z.testzip() is not None:
                    raise RuntimeError("corrupt zip")
            tmp.replace(out)
            return
        except (urllib.error.URLError, RuntimeError, zipfile.BadZipFile, TimeoutError) as e:
            print(f"  attempt {attempt}/{retries} failed: {e}")
            if attempt == retries:
                raise
            time.sleep(3 * attempt)


def fetch_earth(list_only: bool) -> None:
    plan = earth_tiles()
    for pid, tiles in plan.items():
        print(f"{pid}: {', '.join(tiles)}")
    if list_only:
        return
    token = os.environ.get("EARTHDATA_TOKEN")
    if not token:
        raise SystemExit("Set EARTHDATA_TOKEN (Earthdata Login -> Generate Token) and rerun.")
    records = []
    for pid, tiles in plan.items():
        for t in tiles:
            out = RAW / "earth" / pid / f"{t}.SRTMGL1.hgt.zip"
            out.parent.mkdir(parents=True, exist_ok=True)
            url = SRTM_URL.format(t=t)
            if not out.exists():
                print(f"downloading {t} for {pid} ...")
                download(url, out, token)
            records.append({
                "id": f"earth-srtmgl1-{t.lower()}",
                "title": f"SRTMGL1 v003 tile {t}",
                "agency": "NASA / USGS LP DAAC",
                "product": "SRTMGL1",
                "version": "003",
                "landing_url": "https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003",
                "download_url": url,
                "downloaded_at_utc": now_utc(),
                "filename": f"data/raw/earth/{pid}/{out.name}",
                "sha256": sha256(out),
                "units": "meters (int16, EGM96 geoid heights)",
                "native_resolution": "1 arc-second (~30 m)",
                "native_crs_wkt": "GEOGCS[\"WGS 84\",DATUM[\"WGS_1984\",SPHEROID[\"WGS 84\",6378137,298.257223563]],PRIMEM[\"Greenwich\",0],UNIT[\"degree\",0.0174532925199433],AUTHORITY[\"EPSG\",\"4326\"]]",
                "citation": "NASA JPL (2013). NASA Shuttle Radar Topography Mission Global 1 arc second [Data set]. NASA LP DAAC. https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003",
                "license_or_usage_notes": "NASA public data; no restrictions on reuse; cite the DOI.",
                "parent_id": pid,
            })
    write_sources("earth", records)


# --------------------------------------------------------------------------- #
# Global products for discovery mode (pin anywhere / search all Earth land)
# --------------------------------------------------------------------------- #
LDEM64_URL = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_64"
CMR_GRANULES = "https://cmr.earthdata.nasa.gov/search/granules.json?short_name=SRTMGL30&version=002&page_size=100"
SRTM30_URL = "https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/SRTMGL30.002/{g}/{g}.zip"


def _plain_download(url: str, out: Path, retries: int = 3) -> None:
    for attempt in range(1, retries + 1):
        try:
            tmp = out.with_suffix(out.suffix + ".part")
            with urllib.request.urlopen(url, timeout=300) as r, open(tmp, "wb") as f:
                if "html" in r.headers.get("Content-Type", ""):
                    raise RuntimeError("got HTML instead of data")
                expected = int(r.headers.get("Content-Length") or 0)
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            if tmp.stat().st_size == 0 or (expected and tmp.stat().st_size != expected):
                raise RuntimeError(f"incomplete download {tmp.stat().st_size}/{expected}")
            tmp.replace(out)
            return
        except (urllib.error.URLError, RuntimeError, TimeoutError) as e:
            print(f"  attempt {attempt}/{retries} failed: {e}")
            if attempt == retries:
                raise
            time.sleep(5 * attempt)


def fetch_moon_global() -> None:
    """LOLA LDEM_64 (64 px/deg, ~474 m) global lunar DEM from PDS; one 531 MB download."""
    d = RAW / "moon" / "global"
    d.mkdir(parents=True, exist_ok=True)
    for ext in (".lbl", ".img"):
        out = d / f"ldem_64{ext}"
        if not out.exists():
            print(f"downloading {out.name} ...")
            _plain_download(LDEM64_URL + ext, out)
    img = d / "ldem_64.img"
    rec = {
        "id": "moon-lola-ldem-64",
        "title": "LRO LOLA gridded DEM LDEM_64 (global, 64 pixels/degree)",
        "agency": "NASA / PDS Geosciences Node",
        "product": "LRO-L-LOLA-4-GDR-V1.0 LDEM_64",
        "version": "unknown (see PDS label)",
        "landing_url": "https://pds-geosciences.wustl.edu/missions/lro/lola.htm",
        "download_url": LDEM64_URL + ".img",
        "downloaded_at_utc": now_utc(),
        "filename": f"data/raw/moon/global/{img.name}",
        "sha256": sha256(img),
        "units": "int16 x 0.5 = meters above 1737.4 km sphere (per PDS label SCALING_FACTOR/OFFSET; verify)",
        "native_resolution": "64 pixels/degree (~474 m at equator)",
        "native_crs_wkt": "Simple cylindrical, Moon sphere R=1737400 m, east longitude 0..360 (PDS label)",
        "citation": "Smith, D.E., et al. (2010), LOLA experiment, Space Sci. Rev. 150, 209-241; LRO LOLA GDR, NASA PDS.",
        "license_or_usage_notes": "NASA PDS public data; cite LOLA team.",
    }
    write_sources("moon", [rec], merge=True)


def fetch_earth_global() -> None:
    """SRTMGL30 v002 (30 arc-second, ~1 km) global land tiles; needs EARTHDATA_TOKEN."""
    token = os.environ.get("EARTHDATA_TOKEN")
    if not token:
        raise SystemExit("Set EARTHDATA_TOKEN (Earthdata Login -> Generate Token) and rerun.")
    with urllib.request.urlopen(CMR_GRANULES, timeout=60) as r:
        granules = sorted(e["title"] for e in json.load(r)["feed"]["entry"])
    print(f"{len(granules)} SRTMGL30 granules")
    d = RAW / "earth" / "global"
    d.mkdir(parents=True, exist_ok=True)
    records = []
    for g in granules:
        out = d / f"{g}.zip"
        url = SRTM30_URL.format(g=g)
        if not out.exists():
            print(f"downloading {g} ...")
            download(url, out, token)
        records.append({
            "id": f"earth-srtmgl30-{g.split('.')[0]}",
            "title": f"SRTMGL30 v002 tile {g.split('.')[0]}",
            "agency": "NASA / USGS LP DAAC",
            "product": "SRTMGL30",
            "version": "002",
            "landing_url": "https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL30.002",
            "download_url": url,
            "downloaded_at_utc": now_utc(),
            "filename": f"data/raw/earth/global/{out.name}",
            "sha256": sha256(out),
            "units": "meters (int16, EGM96 geoid heights)",
            "native_resolution": "30 arc-second (~926 m at equator)",
            "native_crs_wkt": "WGS 84 geographic (EPSG:4326)",
            "citation": "NASA JPL (2013). NASA Shuttle Radar Topography Mission Global 30 arc second V002. NASA LP DAAC. https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL30.002",
            "license_or_usage_notes": "NASA public data; no restrictions on reuse; cite the DOI.",
        })
    write_sources("earth_global", records)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("body", choices=["mars", "moon", "earth", "moon-global", "earth-global"])
    ap.add_argument("--list", action="store_true", help="earth: only print required tiles")
    a = ap.parse_args()
    {"mars": fetch_mars, "moon": fetch_moon, "moon-global": fetch_moon_global,
     "earth-global": fetch_earth_global}.get(a.body, lambda: fetch_earth(a.list))()


if __name__ == "__main__":
    sys.exit(main())
