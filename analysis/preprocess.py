"""Preprocessing: read physical elevation, build local metric grids, area-average regrid.

Design notes
------------
* No GDAL dependency is required. SRTM HGT is read directly with numpy (documented format:
  3601x3601 big-endian int16, pixel-is-point on integer-degree lines, void = -32768 m).
  rasterio is used only if it imports (it is blocked by Windows Application Control on the
  development machine).
* Every region is analysed in a local azimuthal-equidistant projection centred on the region
  centre, on that body's own reference figure (Earth WGS84, Moon/Mars IAU spheres).
* Regridding to 1000 m is area averaging by binning: every valid source pixel whose centre
  falls in a target cell contributes equally to that cell's mean. Source pixels must be much
  finer than 1000 m; coarser inputs are refused (no upsampling).
* Missing data stays missing (NaN + mask). Nothing is zero-filled or interpolated.
"""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from pyproj import CRS, Transformer

from . import config as C


class PreprocessError(RuntimeError):
    pass


# ---------------------------------------------------------------------------- CRS
def local_aeqd_crs(body: str, lat: float, lon: float) -> CRS:
    fig = C.BODY_FIGURES[body]["proj"]
    return CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +x_0=0 +y_0=0 {fig} +units=m +no_defs")


def geographic_crs(body: str) -> CRS:
    if body == "earth":
        return CRS.from_epsg(4326)
    return CRS.from_proj4(f"+proj=longlat {C.BODY_FIGURES[body]['proj']} +no_defs")


# ---------------------------------------------------------------------------- grid
@dataclass(frozen=True)
class GridSpec:
    """Square north-up grid centred on (0,0) of a local metric CRS, including buffer."""
    size_cells: int                      # analysed interior size (100 parent, 20 reference)
    buffer_cells: int = C.BUFFER_CELLS
    cell_m: float = C.RESOLUTION_M

    @property
    def n(self) -> int:
        return self.size_cells + 2 * self.buffer_cells

    @property
    def half_extent_m(self) -> float:
        return self.n * self.cell_m / 2.0

    def cell_center(self, row: float, col: float) -> tuple[float, float]:
        h = self.half_extent_m
        return (-h + (col + 0.5) * self.cell_m, h - (row + 0.5) * self.cell_m)

    def boundary_points(self, densify: int = 50) -> np.ndarray:
        """Densified outer boundary (x, y) of the buffered grid, for bbox computations."""
        h = self.half_extent_m
        t = np.linspace(-h, h, densify + 1)
        xs = np.concatenate([t, np.full_like(t, h), t[::-1], np.full_like(t, -h)])
        ys = np.concatenate([np.full_like(t, h), t[::-1], np.full_like(t, -h), t])
        return np.stack([xs, ys], axis=1)


@dataclass
class Accumulator:
    grid: GridSpec
    sums: np.ndarray = field(init=False)
    valid_counts: np.ndarray = field(init=False)
    total_counts: np.ndarray = field(init=False)
    exact_zero_counts: np.ndarray = field(init=False)
    source_values_min: float = np.inf
    source_values_max: float = -np.inf
    source_samples_total: int = 0
    source_samples_invalid: int = 0
    subsamples_per_pixel: int = 1
    source_pixel_ground_m: list = field(default_factory=list)

    def __post_init__(self):
        n = self.grid.n * self.grid.n
        self.sums = np.zeros(n, dtype=np.float64)
        self.valid_counts = np.zeros(n, dtype=np.int64)
        self.total_counts = np.zeros(n, dtype=np.int64)
        self.exact_zero_counts = np.zeros(n, dtype=np.int64)

    def add(self, x: np.ndarray, y: np.ndarray, values: np.ndarray, valid: np.ndarray) -> None:
        g = self.grid
        h = g.half_extent_m
        col = np.floor((x - (-h)) / g.cell_m)
        row = np.floor((h - y) / g.cell_m)
        inside = (col >= 0) & (col < g.n) & (row >= 0) & (row < g.n) & np.isfinite(x) & np.isfinite(y)
        if not inside.any():
            return
        idx = (row[inside] * g.n + col[inside]).astype(np.int64)
        v = values[inside]
        ok = valid[inside]
        n = g.n * g.n
        self.total_counts += np.bincount(idx, minlength=n)
        self.source_samples_total += int(idx.size)
        self.source_samples_invalid += int((~ok).sum())
        if ok.any():
            self.valid_counts += np.bincount(idx[ok], minlength=n)
            self.sums += np.bincount(idx[ok], weights=v[ok].astype(np.float64), minlength=n)
            self.exact_zero_counts += np.bincount(idx[ok & (v == 0)], minlength=n)
            self.source_values_min = min(self.source_values_min, float(v[ok].min()))
            self.source_values_max = max(self.source_values_max, float(v[ok].max()))

    def finalize(self) -> "RegriddedGrid":
        g = self.grid
        covered = self.total_counts > 0
        if not covered.any():
            raise PreprocessError("no source samples fell inside the analysis grid")
        nominal = float(np.median(self.total_counts[covered]))
        if nominal < C.MIN_NOMINAL_SAMPLES_PER_CELL:
            raise PreprocessError(
                f"source is not finer than the {g.cell_m:.0f} m analysis grid "
                f"(median {nominal:.2f} samples/cell); refusing to upsample")
        valid = self.valid_counts >= C.MIN_CELL_SAMPLE_FRACTION * nominal
        elev = np.full(g.n * g.n, np.nan)
        elev[valid] = self.sums[valid] / self.valid_counts[valid]
        # a cell is "all zero" when every valid contributing sample was exactly 0 m
        all_zero = valid & (self.exact_zero_counts == self.valid_counts)
        shape = (g.n, g.n)
        return RegriddedGrid(
            elevation=elev.reshape(shape), valid=valid.reshape(shape), all_zero=all_zero.reshape(shape),
            nominal_samples_per_cell=nominal,
            stats={
                "source_samples_in_grid": self.source_samples_total,
                "source_samples_invalid": self.source_samples_invalid,
                "source_valid_elevation_min_m": None if not np.isfinite(self.source_values_min) else self.source_values_min,
                "source_valid_elevation_max_m": None if not np.isfinite(self.source_values_max) else self.source_values_max,
                "cells_total": int(g.n * g.n),
                "cells_without_samples": int((~covered).sum()),
                "cells_valid": int(valid.sum()),
                "cells_all_exact_zero": int(all_zero.sum()),
                "nominal_samples_per_cell": nominal,
                "subsamples_per_source_pixel": self.subsamples_per_pixel,
                "source_pixel_ground_m": [round(x, 2) for x in self.source_pixel_ground_m],
            })


@dataclass
class RegriddedGrid:
    elevation: np.ndarray      # metres, NaN where invalid
    valid: np.ndarray          # bool
    all_zero: np.ndarray       # bool, cells whose valid samples are all exactly 0 m
    nominal_samples_per_cell: float
    stats: dict


# ---------------------------------------------------------------------------- raster sources
@dataclass
class RasterSource:
    """A source raster with physical elevation in metres and a pixel->native-CRS affine.

    geotransform follows GDAL: (x0, dx, rx, y0, ry, dy) with (x0, y0) the outer corner of
    pixel (0, 0). Rotation terms must be 0.
    """
    name: str
    elevation_m: np.ndarray       # float, physical metres (scale/offset/units already applied)
    valid: np.ndarray             # bool
    geotransform: tuple
    native_crs: CRS
    usable_rows: int | None = None
    usable_cols: int | None = None

    def __post_init__(self):
        if self.geotransform[2] != 0 or self.geotransform[4] != 0:
            raise PreprocessError(f"{self.name}: rotated geotransforms are not supported")


HGT_RE = re.compile(r"([NS])(\d{2})([EW])(\d{3})", re.I)


def parse_hgt_tile(name: str) -> tuple[int, int]:
    m = HGT_RE.search(name)
    if not m:
        raise PreprocessError(f"cannot parse SRTM tile name: {name}")
    lat = int(m.group(2)) * (1 if m.group(1).upper() == "N" else -1)
    lon = int(m.group(4)) * (1 if m.group(3).upper() == "E" else -1)
    return lat, lon


def read_hgt_bytes(path: Path) -> bytes:
    path = Path(path)
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".hgt")]
            if len(names) != 1:
                raise PreprocessError(f"{path.name}: expected exactly one .hgt member, got {names}")
            return zf.read(names[0])
    return path.read_bytes()


def read_srtm_hgt(path: Path) -> RasterSource:
    """Read an SRTMGL1 v003 HGT (or its .zip) as physical metres with a void mask."""
    raw = read_hgt_bytes(path)
    n = C.SRTM["tile_size"]
    if len(raw) != n * n * 2:
        raise PreprocessError(f"{Path(path).name}: {len(raw)} bytes, expected {n*n*2} for {n}x{n} int16")
    arr = np.frombuffer(raw, dtype=C.SRTM["dtype"]).reshape(n, n)
    valid = arr != C.SRTM["void_value"]
    elev = arr.astype(np.float64) * C.SRTM["scale"] + C.SRTM["offset"]   # applied exactly once
    elev[~valid] = np.nan
    lat0, lon0 = parse_hgt_tile(Path(path).name)
    px = 1.0 / (n - 1)
    gt = (lon0 - px / 2, px, 0.0, lat0 + 1 + px / 2, 0.0, -px)
    # drop the last row/column: they duplicate the neighbouring tiles' first row/column
    return RasterSource(name=Path(path).name, elevation_m=elev, valid=valid, geotransform=gt,
                        native_crs=CRS.from_epsg(4326), usable_rows=n - 1, usable_cols=n - 1)


def _gdal_metadata_scale_offset(xml: str | None) -> tuple[float, float]:
    """SCALE/OFFSET items of the GDAL_METADATA TIFF tag (band 0), default (1, 0)."""
    if not xml:
        return 1.0, 0.0
    import xml.etree.ElementTree as ET
    scale, offset = 1.0, 0.0
    for item in ET.fromstring(xml).iter("Item"):
        name, role = item.get("name", "").upper(), (item.get("role") or "").lower()
        if (name == "SCALE" or role == "scale") and item.text:
            scale = float(item.text)
        if (name == "OFFSET" or role == "offset") and item.text:
            offset = float(item.text)
    return scale, offset


def _has_figure(crs) -> bool:
    return crs is not None and (crs.ellipsoid is not None or
                                (crs.geodetic_crs is not None and crs.geodetic_crs.ellipsoid is not None))


def _figure(crs):
    e = crs.ellipsoid if crs.ellipsoid is not None else crs.geodetic_crs.ellipsoid
    return round(e.semi_major_metre, 3), round(e.semi_minor_metre, 3)


def read_geotiff(path: Path, native_crs_wkt: str | None = None, reader: str = "auto") -> tuple[RasterSource, dict]:
    """Single-band GeoTIFF -> physical metres + mask. Returns (source, info for the manifest).

    reader: "rasterio", "tifffile" or "auto" (rasterio if it imports, else tifffile). The tifffile path
    uses the GeoTIFF tags (ModelPixelScale + ModelTiepoint, PixelIsPoint handled like GDAL).
    CRS: the file's own CRS when it carries a body figure; otherwise the SourceRecord WKT. If both
    exist and their figures differ, the file is refused. Scale/offset applied exactly once;
    nodata (incl. NaN) and non-finite values -> invalid.
    """
    path = Path(path)
    info = {"reader": None}
    file_crs = None
    use_rasterio = reader == "rasterio"
    if reader == "auto":
        try:
            import rasterio  # noqa: F401
            use_rasterio = True
        except ImportError as exc:
            info["rasterio_unavailable"] = str(exc)[:120]
    if use_rasterio:
        import rasterio
        with rasterio.open(path) as ds:
            if ds.count != 1:
                raise PreprocessError(f"{path.name}: expected one band, got {ds.count}")
            arr = ds.read(1).astype(np.float64)
            gt = tuple(ds.transform.to_gdal())
            file_crs = CRS.from_wkt(ds.crs.to_wkt()) if ds.crs else None
            nodata, scale, offset = ds.nodata, ds.scales[0] or 1.0, ds.offsets[0] or 0.0
            info.update(reader=f"rasterio {rasterio.__version__} (GDAL {rasterio.__gdal_version__})",
                        compression=str(ds.compression))
    else:
        import tifffile
        info["reader"] = f"tifffile {tifffile.__version__}"
        with tifffile.TiffFile(path) as tf:
            page = tf.pages[0]
            if page.samplesperpixel != 1:
                raise PreprocessError(f"{path.name}: expected one band, got {page.samplesperpixel}")
            arr = page.asarray().astype(np.float64)
            tags = page.tags
            if "ModelTransformationTag" in tags:
                raise PreprocessError(f"{path.name}: ModelTransformationTag georeferencing not supported")
            if "ModelPixelScaleTag" not in tags or "ModelTiepointTag" not in tags:
                raise PreprocessError(f"{path.name}: missing GeoTIFF pixel scale/tiepoint tags")
            sx, sy = tags["ModelPixelScaleTag"].value[:2]
            ti, tj, _, tx, ty, _ = tags["ModelTiepointTag"].value[:6]
            geokeys = tags["GeoKeyDirectoryTag"].value if "GeoKeyDirectoryTag" in tags else []
            raster_type = 1
            for k in range(4, len(geokeys), 4):
                if geokeys[k] == 1025:          # GTRasterTypeGeoKey: 1 = PixelIsArea, 2 = PixelIsPoint
                    raster_type = geokeys[k + 3]
            x0, y0 = tx - ti * sx, ty + tj * sy
            if raster_type == 2:                 # tiepoint is a pixel centre -> outer corner (GDAL default)
                x0, y0 = x0 - sx / 2, y0 + sy / 2
            gt = (x0, sx, 0.0, y0, 0.0, -sy)
            nd = tags["GDAL_NODATA"].value if "GDAL_NODATA" in tags else None
            nodata = float(str(nd).strip("\x00 ")) if nd not in (None, "") else None
            scale, offset = _gdal_metadata_scale_offset(tags["GDAL_METADATA"].value if "GDAL_METADATA" in tags else None)
            info.update(raster_type="PixelIsPoint" if raster_type == 2 else "PixelIsArea",
                        compression=str(page.compression))
    record_crs = CRS.from_wkt(native_crs_wkt) if native_crs_wkt else None
    if _has_figure(file_crs):
        crs = file_crs
        info["crs_source"] = "file"
        if _has_figure(record_crs) and _figure(record_crs) != _figure(file_crs):
            raise PreprocessError(f"{path.name}: file CRS figure {_figure(file_crs)} != SourceRecord "
                                  f"{_figure(record_crs)}")
    elif _has_figure(record_crs):
        crs = record_crs
        info["crs_source"] = "SourceRecord native_crs_wkt"
    else:
        raise PreprocessError(f"{path.name}: no CRS with a body figure in the file or the SourceRecord")
    valid = np.isfinite(arr)
    if nodata is not None and np.isfinite(nodata):
        valid &= arr != nodata
    vals = arr * float(scale) + float(offset)
    vals[~valid] = np.nan
    info.update(shape=list(arr.shape), geotransform=list(gt), nodata=None if nodata is None or not np.isfinite(nodata)
                else nodata, nodata_is_nan=nodata is not None and not np.isfinite(nodata),
                scale=float(scale), offset=float(offset), native_crs_wkt=crs.to_wkt(),
                valid_fraction=float(valid.mean()),
                valid_range_m=[float(np.nanmin(vals)), float(np.nanmax(vals))] if valid.any() else None)
    return RasterSource(name=path.name, elevation_m=vals, valid=valid, geotransform=gt, native_crs=crs), info


def native_bounds(src: RasterSource) -> tuple[float, float, float, float]:
    x0, dx, _, y0, _, dy = src.geotransform
    rows, cols = src.elevation_m.shape
    xs, ys = (x0, x0 + cols * dx), (y0, y0 + rows * dy)
    return min(xs), min(ys), max(xs), max(ys)


def read_raw_source(spec: dict, base_dir: Path = C.REPO_ROOT) -> RasterSource:
    """Generic reader for reference handoffs (PDS IMG / raw binary / .npy / rasterio-readable).

    spec keys: path, format ('raw'|'npy'|'raster'), and for raw: dtype, rows, cols, header_bytes.
    Physical conversion: value_kind ('elevation'|'radius'), scale, offset, units ('m'|'km'),
    nodata (list or scalar), reference_radius_m (required for radius products),
    geotransform (GDAL order) and native_crs (proj string or WKT) unless read via rasterio.
    """
    path = (base_dir / spec["path"]).resolve()
    if not path.exists():
        raise PreprocessError(f"reference input not found: {path}")
    fmt = spec.get("format", "raw")
    gt = tuple(spec["geotransform"]) if spec.get("geotransform") else None
    crs = CRS.from_user_input(spec["native_crs"]) if spec.get("native_crs") else None
    nodata = spec.get("nodata")
    if fmt == "raw":
        dt = np.dtype(spec["dtype"])
        rows, cols = int(spec["rows"]), int(spec["cols"])
        expected = rows * cols * dt.itemsize
        data = path.read_bytes()[int(spec.get("header_bytes", 0)):]
        if len(data) < expected:
            raise PreprocessError(f"{path.name}: truncated ({len(data)} < {expected} bytes)")
        arr = np.frombuffer(data[:expected], dtype=dt).reshape(rows, cols)
    elif fmt == "npy":
        arr = np.load(path, allow_pickle=False)
    elif fmt == "raster":
        src, _ = read_geotiff(path, spec.get("native_crs"))
        return src
    else:
        raise PreprocessError(f"unknown reference format {fmt}")
    if gt is None or crs is None:
        raise PreprocessError(f"{path.name}: geotransform and native_crs are required")
    arr = arr.astype(np.float64)
    valid = np.isfinite(arr)
    for nd in (nodata if isinstance(nodata, list) else [nodata] if nodata is not None else []):
        valid &= arr != nd
    for lo_hi in spec.get("invalid_ranges", []):
        valid &= ~((arr >= lo_hi[0]) & (arr <= lo_hi[1]))
    vals = arr * float(spec.get("scale", 1.0)) + float(spec.get("offset", 0.0))
    units = spec.get("units", "m")
    if units == "km":
        vals = vals * 1000.0
    elif units != "m":
        raise PreprocessError(f"unsupported units {units}")
    kind = spec.get("value_kind", "elevation")
    if kind == "radius":
        if spec.get("reference_radius_m") is None:
            raise PreprocessError("radius product needs a documented reference_radius_m conversion")
        vals = vals - float(spec["reference_radius_m"])
    elif kind != "elevation":
        raise PreprocessError(f"unsupported value_kind {kind}")
    vals[~valid] = np.nan
    return RasterSource(name=path.name, elevation_m=vals, valid=valid, geotransform=gt, native_crs=crs)


# ---------------------------------------------------------------------------- regrid
def source_ground_spacing_m(src: RasterSource, grid_crs: CRS, r: int, c: int) -> float:
    """Ground size (m, in the local metric grid) of one source pixel near (r, c): max of its two sides."""
    t = Transformer.from_crs(src.native_crs, grid_crs, always_xy=True)
    x0, dx, _, y0, _, dy = src.geotransform
    px = np.array([x0 + (c + 0.5) * dx, x0 + (c + 1.5) * dx, x0 + (c + 0.5) * dx])
    py = np.array([y0 + (r + 0.5) * dy, y0 + (r + 0.5) * dy, y0 + (r + 1.5) * dy])
    gx, gy = t.transform(px, py)
    return float(max(np.hypot(gx[1] - gx[0], gy[1] - gy[0]), np.hypot(gx[2] - gx[0], gy[2] - gy[0])))


def accumulate_source(src: RasterSource, grid_crs: CRS, acc: Accumulator, chunk_rows: int = 300) -> int:
    """Area-average a source into the grid. Returns the number of (sub-)samples binned.

    Each source pixel is split into k x k equal sub-samples carrying the pixel value (piecewise-constant
    source), with k chosen so the sub-sample ground spacing is <= cell/8. Binning sub-sample centres then
    approximates exact area-overlap weighting; k = 1 for sources already much finer than the cell
    (SRTM 30 m, LOLA 80 m). Sources coarser than the cell are refused (no upsampling).
    """
    to_native = Transformer.from_crs(grid_crs, src.native_crs, always_xy=True)
    to_grid = Transformer.from_crs(src.native_crs, grid_crs, always_xy=True)
    bx, by = to_native.transform(*acc.grid.boundary_points().T)
    x0, dx, _, y0, _, dy = src.geotransform
    rows = src.usable_rows or src.elevation_m.shape[0]
    cols = src.usable_cols or src.elevation_m.shape[1]
    # pixel index range covering the (densified) boundary bbox, +2 px margin
    c_lo = int(np.floor((np.nanmin(bx) - x0) / dx)) - 2
    c_hi = int(np.ceil((np.nanmax(bx) - x0) / dx)) + 2
    r_a = (np.nanmin(by) - y0) / dy
    r_b = (np.nanmax(by) - y0) / dy
    r_lo, r_hi = int(np.floor(min(r_a, r_b))) - 2, int(np.ceil(max(r_a, r_b))) + 2
    c_lo, c_hi = max(c_lo, 0), min(c_hi, cols)
    r_lo, r_hi = max(r_lo, 0), min(r_hi, rows)
    if c_lo >= c_hi or r_lo >= r_hi:
        return 0
    spacing = source_ground_spacing_m(src, grid_crs, (r_lo + r_hi) // 2, (c_lo + c_hi) // 2)
    if spacing > acc.grid.cell_m:
        raise PreprocessError(f"{src.name}: source pixel ~{spacing:.0f} m is coarser than the "
                              f"{acc.grid.cell_m:.0f} m analysis cell; refusing to upsample")
    k = max(1, int(np.ceil(spacing / (acc.grid.cell_m / 8.0))))
    acc.source_pixel_ground_m.append(spacing)
    acc.subsamples_per_pixel = max(acc.subsamples_per_pixel, k * k)
    offs = (np.arange(k) + 0.5) / k                     # sub-sample centres inside a pixel, in pixel units
    before = acc.source_samples_total
    cc = np.arange(c_lo, c_hi)
    px = (x0 + (cc[:, None] + offs[None, :]) * dx).ravel()          # cols*k
    step = max(1, chunk_rows // k)
    for r0 in range(r_lo, r_hi, step):
        r1 = min(r0 + step, r_hi)
        rr = np.arange(r0, r1)
        py = (y0 + (rr[:, None] + offs[None, :]) * dy).ravel()      # rows*k
        PX, PY = np.meshgrid(px, py)
        gx, gy = to_grid.transform(PX.ravel(), PY.ravel())
        z = src.elevation_m[r0:r1, c_lo:c_hi]
        v = src.valid[r0:r1, c_lo:c_hi]
        if k > 1:
            z = np.repeat(np.repeat(z, k, axis=0), k, axis=1)
            v = np.repeat(np.repeat(v, k, axis=0), k, axis=1)
        acc.add(np.asarray(gx), np.asarray(gy), z.ravel(), v.ravel())
    return acc.source_samples_total - before


def required_geographic_bbox(body: str, lat: float, lon: float, grid: GridSpec, margin_cells: int = 1) -> dict:
    """Geographic bbox of the buffered square (all corners + densified edges + margin)."""
    g2 = GridSpec(size_cells=grid.size_cells, buffer_cells=grid.buffer_cells + margin_cells, cell_m=grid.cell_m)
    t = Transformer.from_crs(local_aeqd_crs(body, lat, lon), geographic_crs(body), always_xy=True)
    lons, lats = t.transform(*g2.boundary_points().T)
    return {"west": float(np.min(lons)), "east": float(np.max(lons)),
            "south": float(np.min(lats)), "north": float(np.max(lats))}


def srtm_tiles_for_bbox(bbox: dict) -> list[str]:
    tiles = []
    for la in range(int(np.floor(bbox["south"])), int(np.floor(bbox["north"])) + 1):
        for lo in range(int(np.floor(bbox["west"])), int(np.floor(bbox["east"])) + 1):
            tiles.append(f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}")
    return tiles
