"""End-to-end Earth path on synthetic HGT tiles in the data-setup layout:
earth_sources.json (parent_id, filename, sha256) -> sha check -> regrid -> 81 windows."""
import json
import zipfile

import numpy as np
import pytest

from analysis import config as C
from analysis import preprocess as P
from analysis.build_candidates import build_parent, sha256_file


@pytest.fixture()
def fake_srtm(tmp_path, monkeypatch):
    monkeypatch.setattr(C, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(C, "EARTH_SOURCES_JSON", tmp_path / "data" / "sources" / "earth_sources.json")
    parent = {"id": "earth-khaybar", "name": "Harrat Khaybar", "center": {"lat": 25.7, "lon": 39.9}}
    bbox = P.required_geographic_bbox("earth", 25.7, 39.9, P.GridSpec(size_cells=C.PARENT_SIZE_CELLS))
    n = C.SRTM["tile_size"]
    d = tmp_path / "data" / "raw" / "earth" / parent["id"]
    d.mkdir(parents=True)
    sources = []
    for t in P.srtm_tiles_for_bbox(bbox):
        lat0, lon0 = P.parse_hgt_tile(t)
        lon = lon0 + np.arange(n) / (n - 1)
        arr = np.tile((300 + 1000 * (lon - 39.0)).astype(">i2"), (n, 1))   # ~1 m per 100 m eastward
        if t == "N26E040":
            arr[:] = -32768                                               # whole tile void
        f = d / f"{t}.SRTMGL1.hgt.zip"
        with zipfile.ZipFile(f, "w") as zf:
            zf.writestr(f"{t}.hgt", arr.tobytes())
        sources.append({"id": f"earth-srtmgl1-{t.lower()}", "parent_id": parent["id"], "sha256": sha256_file(f),
                        "filename": f"data/raw/earth/{parent['id']}/{f.name}"})
    C.EARTH_SOURCES_JSON.parent.mkdir(parents=True)
    C.EARTH_SOURCES_JSON.write_text(json.dumps({"schema_version": "2.0", "items": sources}))
    return parent


def test_real_earth_path(fake_srtm):
    pr, cands, man = build_parent(fake_srtm)
    assert len(cands) == 81 and pr["windows"]["planned"] == 81
    valid = [c for c in cands if c["analysis"]["status"] == "valid"]
    invalid = [c for c in cands if c["analysis"]["status"] == "invalid"]
    assert valid and invalid                         # void NE tile rejects its windows, with reasons
    assert all(c["analysis"]["reasons"] for c in invalid)
    assert all(c["metrics"]["relief_p95_p05_m"] is None for c in invalid)
    # gentle eastward ramp: every valid slope lands in the [0,1) bin, never a false cliff at the void edge
    for c in valid:
        assert c["metrics"]["slope_histogram"][0] == 1.0
    ne = next(c for c in cands if c["id"] == "earth-khaybar-r00-c08")
    assert ne["analysis"]["status"] == "invalid"
    assert "earth-srtmgl1-n26e040" in ne["source_ids"]
    assert man["inputs"] and all(i["sha256"] for i in man["inputs"])


def test_sha_mismatch_is_refused(fake_srtm):
    js = json.loads(C.EARTH_SOURCES_JSON.read_text())
    js["items"][0]["sha256"] = "0" * 64
    C.EARTH_SOURCES_JSON.write_text(json.dumps(js))
    with pytest.raises(P.PreprocessError, match="sha256"):
        build_parent(fake_srtm)


def test_missing_required_tile_record_is_refused(fake_srtm):
    js = json.loads(C.EARTH_SOURCES_JSON.read_text())
    js["items"] = js["items"][1:]
    C.EARTH_SOURCES_JSON.write_text(json.dumps(js))
    with pytest.raises(P.PreprocessError, match="no SourceRecord"):
        build_parent(fake_srtm)
