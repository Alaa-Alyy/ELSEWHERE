"""On-demand SRTMGL30 tiles for deployed servers (token at runtime, never in the image)."""
import io
import zipfile

import pytest

from discovery import sources as S


def test_tile_names_match_the_srtmgl30_tiling():
    assert S.srtmgl30_tile(32.94, -0.37) == "w020n40"        # Algeria
    assert S.srtmgl30_tile(47.96, -112.59) == "w140n90"      # Montana
    assert S.srtmgl30_tile(-26.50, -66.99) == "w100s10"      # Argentine Puna (seen in the app's sources)
    assert S.srtmgl30_tile(0.75, -65.98) == "w100n40"        # Amazon
    assert S.srtmgl30_tile(-61.0, 0.0) is None               # outside 60S
    assert {S.GRANULE_BY_TILE[t] for t in ("w020n40",)} == {"W020N40.SRTMGL30.dem"}  # exact (upper-case) title
    assert len(S.SRTMGL30_GRANULES) == 27


def test_window_on_a_tile_edge_needs_two_tiles():
    assert S.tiles_for(40.0, 10.0, 13000) == {"w020n90", "w020n40"}
    assert S.tiles_for(20.0, 10.0, 13000) == {"w020n40"}


def _fake_zip_bytes(name: str) -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr(name, b"\x00\x01" * 8)
    return b.getvalue()


def test_missing_tile_without_token_is_a_clear_unavailable(tmp_path):
    with pytest.raises(S.SourceUnavailable, match="EARTHDATA_TOKEN"):
        S.ensure_earth_tiles(32.94, -0.37, 13000, src_dir=tmp_path, token="")


def test_missing_tile_is_downloaded_once_with_the_token(tmp_path, monkeypatch):
    calls = []

    def fake_fetch(url, out, token):
        calls.append((url, token))
        out.write_bytes(_fake_zip_bytes("W020N40.DEM"))

    monkeypatch.setattr(S, "_ONDEMAND", [])
    assert S.ensure_earth_tiles(32.94, -0.37, 13000, src_dir=tmp_path, token="T0K", fetch=fake_fetch) is True
    assert calls == [("https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/SRTMGL30.002/"
                      "W020N40.SRTMGL30.dem/W020N40.SRTMGL30.dem.zip", "T0K")]
    assert (tmp_path / "dem" / "W020N40.DEM").exists()
    assert not list(tmp_path.glob("*.zip"))                   # downloaded zip removed
    assert S.ensure_earth_tiles(32.94, -0.37, 13000, src_dir=tmp_path, token="T0K", fetch=fake_fetch) is False
    assert len(calls) == 1                                    # cached


def test_local_zip_is_used_without_any_download(tmp_path):
    (tmp_path / "w140n90.SRTMGL30.dem.zip").write_bytes(_fake_zip_bytes("W140N90.DEM"))
    def no_fetch(*a):
        raise AssertionError("must not download")
    assert S.ensure_earth_tiles(47.96, -112.59, 13000, src_dir=tmp_path, token="", fetch=no_fetch) is True
    assert (tmp_path / "dem" / "W140N90.DEM").exists()
    assert (tmp_path / "w140n90.SRTMGL30.dem.zip").exists()  # an offline-prepared zip is kept


def test_on_demand_cache_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "_ONDEMAND", [])
    monkeypatch.setattr(S, "MAX_ONDEMAND_TILES", 1)
    fetch = lambda url, out, token: out.write_bytes(_fake_zip_bytes(url.rsplit("/", 1)[1].split(".")[0].upper() + ".DEM"))
    S.ensure_earth_tiles(32.94, -0.37, 13000, src_dir=tmp_path, token="T", fetch=fetch)    # w020n40
    S.ensure_earth_tiles(47.96, -112.59, 13000, src_dir=tmp_path, token="T", fetch=fetch)  # w140n90
    names = sorted(p.name for p in (tmp_path / "dem").iterdir())
    assert names == ["W140N90.DEM"]                           # oldest on-demand tile evicted
