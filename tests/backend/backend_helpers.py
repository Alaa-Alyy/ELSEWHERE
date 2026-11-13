import json
import shutil
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.config import Settings  # noqa: E402
from backend.main import create_app  # noqa: E402

PROCESSED = ROOT / "data" / "processed"
SOURCES = ROOT / "data" / "sources"


class FakeChatClient:
    """Stands in for the OpenAI client: records calls and returns a canned JSON answer."""

    def __init__(self, content=None, exc=None):
        self.calls = []
        self.content = content
        self.exc = exc
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append(kw)
        if self.exc:
            raise self.exc
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))])


def demo_settings(**kw):
    return Settings(demo_fixtures=True, data_dir=PROCESSED, sources_dir=SOURCES, **kw)


@pytest.fixture
def demo_client():
    return TestClient(create_app(demo_settings()))


@pytest.fixture
def ranking(demo_client):
    r = demo_client.get("/api/rankings", params={"reference_id": "mars-jezero", "profile": "terrain_general"})
    assert r.status_code == 200
    return r.json()


@pytest.fixture
def fake_real_dir(tmp_path):
    """A 'real' data dir whose corpus is actually the demo corpus (must be refused)."""
    d = tmp_path / "processed"
    shutil.copytree(PROCESSED / "demo", d)
    return d


def write(path: Path, obj):
    path.write_text(json.dumps(obj), encoding="utf-8")
