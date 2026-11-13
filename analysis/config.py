"""Frozen v2.0 configuration for the MissionMatch / ELSEWHERE terrain pipeline (Person 1).

Everything here is part of the contract. Changing a value changes the corpus digest
and must be coordinated with Persons 2 and 3.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

SCHEMA_VERSION = "2.0"
PIPELINE_VERSION = "2.0"
SCORE_VERSION = "2.0"

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
CONFIG_DIR = DATA_DIR / "config"
RAW_DIR = DATA_DIR / "raw"
SOURCES_DIR = DATA_DIR / "sources"
PROCESSED_DIR = Path(os.environ.get("MISSIONMATCH_PROCESSED_DIR", DATA_DIR / "processed"))
DEMO_DIR = DATA_DIR / "processed" / "demo"
REGIONS_JSON = CONFIG_DIR / "regions.json"
EARTH_SOURCES_JSON = SOURCES_DIR / "earth_sources.json"
SOURCE_FILES = ("earth_sources.json", "moon_sources.json", "mars_sources.json")

# ---- analysis grid (frozen) -------------------------------------------------
RESOLUTION_M = 1000.0           # analysis cell size, metres
PARENT_SIZE_CELLS = 100         # 100 km parent square
WINDOW_SIZE_CELLS = 20          # 20 km candidate/reference window
STRIDE_CELLS = 10               # 10 km stride -> 9 x 9 = 81 windows per parent
BUFFER_CELLS = 2                # processing buffer around every analysed square
WINDOWS_PER_AXIS = (PARENT_SIZE_CELLS - WINDOW_SIZE_CELLS) // STRIDE_CELLS + 1   # 9
PLANNED_WINDOWS_PER_PARENT = WINDOWS_PER_AXIS ** 2                               # 81

# ---- regridding (area averaging by source-pixel-centre binning) ---------------
# A 1000 m cell is valid when its valid source samples are at least this fraction
# of the nominal sample count (median sample count of covered cells in that region).
MIN_CELL_SAMPLE_FRACTION = 0.5
# Source pixels must be finer than the analysis cell (no upsampling claims).
MIN_NOMINAL_SAMPLES_PER_CELL = 2

# ---- features (frozen) --------------------------------------------------------
SLOPE_BIN_EDGES_DEG = [0.0, 1.0, 3.0, 5.0, 10.0, 20.0, 30.0, 45.0, 90.0]
PERCENTILE_METHOD = "linear"    # numpy default; documented for reproducibility
MIN_VALID_FRACTION = 0.95
MIN_VALID_CELLS = 100
# Heuristic water/ocean guard for Earth windows: SRTM v3 water surfaces are flat
# fill values; a window with more than this fraction of cells whose 1 km mean is
# exactly 0 m is rejected as "suspected_water_or_fill".
MAX_EXACT_ZERO_FRACTION = 0.05

# ---- scoring (frozen) ---------------------------------------------------------
PROFILES = {"terrain_general": 0.40, "slope_focus": 0.70}
STABILIZATION_FLOOR_M = 1.0
MIN_CENTER_DISTANCE_KM = 20.0
MAX_TOP_K = 3

# ---- planetary body figures used for local metric projections ----------------
BODY_FIGURES = {
    "earth": {"proj": "+ellps=WGS84", "description": "WGS84 ellipsoid (EPSG:4326 horizontal)"},
    "moon": {"proj": "+R=1737400", "description": "IAU Moon sphere R=1737.4 km (LOLA reference radius)"},
    "mars": {"proj": "+R=3396190", "description": "IAU Mars sphere R=3396.19 km (MOLA reference sphere)"},
}

SRTM = {
    "short_name": "SRTMGL1",
    "version": "003",
    "collection_concept_id": "C2763266360-LPCLOUD",
    "provider": "LPCLOUD",
    "doi": "https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003",
    "landing_url": "https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003",
    "tile_size": 3601,
    "void_value": -32768,
    "dtype": ">i2",
    "units": "m",
    "scale": 1.0,
    "offset": 0.0,
    "vertical_datum": "EGM96 geoid",
    "native_resolution": "1 arc-second (~30 m)",
    "citation": ("NASA JPL (2013). NASA Shuttle Radar Topography Mission Global 1 arc second "
                 "[Data set]. NASA EOSDIS Land Processes DAAC. "
                 "https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003"),
    "license_or_usage_notes": ("NASA LP DAAC data: no restrictions on reuse, sale or redistribution; "
                               "cite the DOI per LP DAAC citation policy."),
}


def load_regions(path: Path = REGIONS_JSON) -> dict:
    """regions.json with each reference's own config file (data/config/<body>_region.json) merged in."""
    with open(path, encoding="utf-8") as f:
        regions = json.load(f)
    refs = []
    for ref in regions.get("references", []):
        merged = dict(ref)
        if ref.get("config"):
            with open(REPO_ROOT / ref["config"], encoding="utf-8") as f:
                merged = {**json.load(f), **ref}
        refs.append(merged)
    regions["references"] = refs
    return regions


def load_sources() -> dict:
    """All SourceRecords (Earth, Moon, Mars) keyed by id."""
    out = {}
    for name in SOURCE_FILES:
        p = SOURCES_DIR / name
        if p.exists():
            with open(p, encoding="utf-8") as f:
                for s in json.load(f)["items"]:
                    out[s["id"]] = s
    return out


def frozen_settings() -> dict:
    """Settings that participate in the corpus digest."""
    return {
        "schema_version": SCHEMA_VERSION,
        "pipeline_version": PIPELINE_VERSION,
        "score_version": SCORE_VERSION,
        "resolution_m": RESOLUTION_M,
        "parent_size_cells": PARENT_SIZE_CELLS,
        "window_size_cells": WINDOW_SIZE_CELLS,
        "stride_cells": STRIDE_CELLS,
        "buffer_cells": BUFFER_CELLS,
        "min_cell_sample_fraction": MIN_CELL_SAMPLE_FRACTION,
        "slope_bin_edges_deg": SLOPE_BIN_EDGES_DEG,
        "percentile_method": PERCENTILE_METHOD,
        "min_valid_fraction": MIN_VALID_FRACTION,
        "min_valid_cells": MIN_VALID_CELLS,
        "max_exact_zero_fraction": MAX_EXACT_ZERO_FRACTION,
        "profiles": PROFILES,
        "stabilization_floor_m": STABILIZATION_FLOOR_M,
        "min_center_distance_km": MIN_CENTER_DISTANCE_KM,
    }
