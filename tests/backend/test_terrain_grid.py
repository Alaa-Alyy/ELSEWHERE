"""/api/terrain-grid: same 1000 m grid as the measurement, display only."""
import pytest
from fastapi.testclient import TestClient

from backend_helpers import demo_settings
from backend.main import create_app
from discovery import terrain_grid as TG


@pytest.fixture
def client():
    return TestClient(create_app(demo_settings()))


def test_validation_errors_use_the_envelope(client):
    r = client.get("/api/terrain-grid", params={"body": "venus", "lat": 0, "lon": 0})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_input"
    r = client.get("/api/terrain-grid", params={"body": "earth", "lat": 75, "lon": 0})
    assert r.status_code == 422 and "60" in r.json()["error"]["message"]


def test_unavailable_source_is_retryable_503(client, monkeypatch):
    def boom(*a, **k):
        raise TG.SourceUnavailable("earth elevation source unavailable: FileNotFoundError")
    monkeypatch.setattr(TG, "earth_mosaic", lambda: type("M", (), {"crop": boom})())
    TG._CACHE.clear()
    r = client.get("/api/terrain-grid", params={"body": "earth", "lat": 10.123, "lon": 20.456})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "terrain_unavailable" and r.json()["error"]["retryable"] is True


def test_remember_slices_the_measured_window_north_up():
    import numpy as np
    from analysis import config as C
    from analysis import preprocess as P
    grid = P.GridSpec(size_cells=C.WINDOW_SIZE_CELLS)
    n, b = grid.n, grid.buffer_cells
    elev = np.arange(n * n, dtype=float).reshape(n, n)          # row-major, row 0 = north
    valid = np.ones((n, n), dtype=bool)
    valid[b, b] = False                                         # one missing cell -> None, not 0
    rg = type("RG", (), {"elevation": elev, "valid": valid})()
    item = TG.remember("mars", 18.44, 77.45, rg, grid, type("S", (), {"name": "test"})(), "src")
    rows = item["elevation_m"]
    assert len(rows) == C.WINDOW_SIZE_CELLS and len(rows[0]) == C.WINDOW_SIZE_CELLS
    assert rows[0][0] is None
    assert rows[0][1] == float(b * n + b + 1) and rows[1][0] == float((b + 1) * n + b)
    assert item["row_order"] == "north to south" and item["valid_fraction"] < 1
    assert TG._CACHE[("mars", 18.44, 77.45)] is item
