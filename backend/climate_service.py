"""Earth climate context for a candidate window, from the NASA POWER Climatology API (no key needed).

Context only: it is never part of the terrain similarity score. Values are modelled/reanalysis
climatology (MERRA-2 meteorology ~0.5 x 0.625 deg, CERES SYN1deg solar ~1 deg), not station data.
"""
from __future__ import annotations

import json
import threading
import urllib.parse
import urllib.request
from collections import OrderedDict
from typing import Callable

POWER_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"
PARAMETERS = ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "WS10M", "ALLSKY_SFC_SW_DWN"]
FILL = -999.0

# Annual precipitation classes (simple, documented thresholds; not a full aridity index, which needs
# evapotranspiration). < 250 mm/yr is the common "desert" threshold.
ARID_MM, SEMI_ARID_MM = 250.0, 500.0


class ClimateUnavailable(Exception):
    """NASA POWER could not be reached or returned unusable data (retryable)."""


def _http_get(url: str, timeout: float) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "MissionMatch/2.0 (NASA Space Apps)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (fixed https host)
        return json.loads(r.read().decode("utf-8"))


def _ann(params: dict, key: str) -> float | None:
    v = (params.get(key) or {}).get("ANN")
    if v is None:
        return None
    v = float(v)
    return None if v <= FILL + 1e-6 else v


def aridity_class(precip_mm_per_year: float | None) -> dict:
    if precip_mm_per_year is None:
        return {"key": "unknown", "label": "Unknown (no precipitation value)"}
    if precip_mm_per_year < ARID_MM:
        return {"key": "arid", "label": "Arid (< 250 mm/yr)"}
    if precip_mm_per_year < SEMI_ARID_MM:
        return {"key": "semi_arid", "label": "Semi-arid (250-500 mm/yr)"}
    return {"key": "wet", "label": "Wet (>= 500 mm/yr): likely vegetated"}


def summarize(raw: dict, lat: float, lon: float) -> dict:
    params = (raw.get("properties") or {}).get("parameter") or {}
    header = raw.get("header") or {}
    if not params:
        raise ClimateUnavailable("NASA POWER returned no parameters")
    precip_day = _ann(params, "PRECTOTCORR")
    precip_year = None if precip_day is None else round(precip_day * 365.25, 0)
    return {
        "lat": lat,
        "lon": lon,
        "temperature_mean_c": _ann(params, "T2M"),
        "temperature_max_c": _ann(params, "T2M_MAX"),
        "temperature_min_c": _ann(params, "T2M_MIN"),
        "precipitation_mm_per_year": precip_year,
        "wind_speed_10m_m_s": _ann(params, "WS10M"),
        "solar_kwh_m2_day": _ann(params, "ALLSKY_SFC_SW_DWN"),
        "aridity": aridity_class(precip_year),
        "source": {
            "name": "NASA POWER Climatology API",
            "api_version": (header.get("api") or {}).get("version"),
            "datasets": header.get("sources") or ["MERRA2", "SYN1DEG"],
            "period": header.get("range"),
            "resolution": "MERRA-2 meteorology ~0.5° x 0.625°; CERES SYN1deg solar ~1° (about 50-100 km)",
            "kind": "modelled reanalysis / satellite-derived climatology, not station measurements",
            "url": "https://power.larc.nasa.gov/",
            "notes": "temperature_max_c / temperature_min_c are the extreme annual values of the climatology "
                     "(POWER T2M_MAX / T2M_MIN, ANN).",
        },
    }


class ClimateService:
    """Small LRU cache in front of NASA POWER; fetcher is injectable for offline tests."""

    def __init__(self, fetch: Callable[[str, float], dict] | None = None, timeout: float = 20.0, max_items: int = 512):
        self._fetch = fetch or _http_get
        self._timeout = timeout
        self._cache: OrderedDict[tuple[float, float], dict] = OrderedDict()
        self._max = max_items
        self._lock = threading.Lock()

    def get(self, lat: float, lon: float) -> dict:
        key = (round(lat, 2), round(lon, 2))
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        query = urllib.parse.urlencode({
            "parameters": ",".join(PARAMETERS), "community": "RE",
            "latitude": key[0], "longitude": key[1], "format": "JSON",
        })
        try:
            raw = self._fetch(f"{POWER_URL}?{query}", self._timeout)
        except Exception as exc:  # network, timeout, HTTP error, bad JSON
            raise ClimateUnavailable(f"NASA POWER unavailable: {type(exc).__name__}") from exc
        item = summarize(raw, key[0], key[1])
        with self._lock:
            self._cache[key] = item
            while len(self._cache) > self._max:
                self._cache.popitem(last=False)
        return item
