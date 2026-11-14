"""Single-container deploy: the built website is served at / while every /api route still wins."""
from fastapi.testclient import TestClient

from backend_helpers import demo_settings
from backend.main import create_app


def test_frontend_dist_is_served_and_api_still_wins(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<!doctype html><title>ELSEWHERE</title>", encoding="utf-8")
    monkeypatch.setenv("FRONTEND_DIST", str(tmp_path))
    client = TestClient(create_app(demo_settings()))
    page = client.get("/")
    assert page.status_code == 200 and "ELSEWHERE" in page.text
    health = client.get("/api/health")
    assert health.status_code == 200 and health.json()["schema_version"] == "2.0"
    missing = client.get("/api/does-not-exist")
    assert missing.status_code == 404


def test_no_site_without_env(monkeypatch):
    monkeypatch.delenv("FRONTEND_DIST", raising=False)
    client = TestClient(create_app(demo_settings()))
    assert client.get("/").status_code == 404
