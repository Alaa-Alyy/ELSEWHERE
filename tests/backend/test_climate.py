"""/api/climate: NASA POWER climate context (offline - the fetcher is faked)."""
from fastapi.testclient import TestClient

from backend_helpers import demo_settings
from backend.climate_service import ClimateService, ClimateUnavailable, aridity_class, summarize
from backend.main import create_app

# Shape of a real POWER climatology response (values from a probe at 47.96N, -112.59E).
RAW = {
    "header": {"api": {"version": "v2.10.1"}, "sources": ["SYN1DEG", "MERRA2", "POWER"],
               "range": "25-year Meteorological and Solar Monthly & Annual Climatologies (January 2001 - December 2025)"},
    "properties": {"parameter": {
        "T2M": {"ANN": 4.16}, "T2M_MAX": {"ANN": 35.48}, "T2M_MIN": {"ANN": -34.11},
        "PRECTOTCORR": {"ANN": 1.74}, "WS10M": {"ANN": 3.92}, "ALLSKY_SFC_SW_DWN": {"ANN": 3.8803},
    }},
}


def fake_fetch(calls):
    def f(url, timeout):
        calls.append(url)
        return RAW
    return f


def test_summary_values_units_and_class():
    s = summarize(RAW, 47.96, -112.59)
    assert s["temperature_mean_c"] == 4.16
    assert s["temperature_min_c"] == -34.11
    assert s["precipitation_mm_per_year"] == round(1.74 * 365.25)      # mm/day -> mm/yr
    assert s["aridity"]["key"] == "wet"
    assert "MERRA2" in s["source"]["datasets"] and "reanalysis" in s["source"]["kind"]


def test_aridity_thresholds_and_missing():
    assert aridity_class(100)["key"] == "arid"
    assert aridity_class(249.9)["key"] == "arid"
    assert aridity_class(250)["key"] == "semi_arid"
    assert aridity_class(500)["key"] == "wet"
    assert aridity_class(None)["key"] == "unknown"                     # missing is not "arid"


def test_fill_value_is_missing_not_zero():
    raw = {"header": {}, "properties": {"parameter": {"T2M": {"ANN": -999.0}, "PRECTOTCORR": {"ANN": -999.0}}}}
    s = summarize(raw, 0, 0)
    assert s["temperature_mean_c"] is None and s["precipitation_mm_per_year"] is None
    assert s["aridity"]["key"] == "unknown"


def test_endpoint_caches_and_validates():
    calls = []
    client = TestClient(create_app(demo_settings(), climate_fetch=fake_fetch(calls)))
    r = client.get("/api/climate", params={"lat": 47.9614, "lon": -112.5934})
    assert r.status_code == 200
    body = r.json()
    assert body["schema_version"] == "2.0" and body["item"]["aridity"]["key"] == "wet"
    assert "latitude=47.96" in calls[0] and "longitude=-112.59" in calls[0]
    client.get("/api/climate", params={"lat": 47.9611, "lon": -112.5931})  # same 0.01 deg cell -> cached
    assert len(calls) == 1
    bad = client.get("/api/climate", params={"lat": 95, "lon": 0})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_input"


def test_upstream_failure_is_a_retryable_envelope():
    def boom(url, timeout):
        raise TimeoutError("slow")
    client = TestClient(create_app(demo_settings(), climate_fetch=boom))
    r = client.get("/api/climate", params={"lat": 10, "lon": 10})
    assert r.status_code == 502
    assert r.json()["error"] == {"code": "climate_unavailable", "message": "NASA POWER unavailable: TimeoutError", "retryable": True}


def test_service_raises_on_empty_payload():
    svc = ClimateService(fetch=lambda u, t: {"header": {}, "properties": {}})
    try:
        svc.get(1, 1)
    except ClimateUnavailable:
        return
    raise AssertionError("expected ClimateUnavailable")
