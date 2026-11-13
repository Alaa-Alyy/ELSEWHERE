# Person 1: Earth search & terrain engine (v2.0)

This package retrieves similar terrain from measured features. It is not a trained model. Each Moon/Mars
20 km reference window is compared with 243 planned Earth windows (20 km, 10 km stride) inside three
100 km parents. All windows are analysed at 1000 m resolution. The pipeline builds on the `data-setup`
layout: region configs in `data/config/`, SourceRecords with SHA-256 in `data/sources/`, and raw files in
`data/raw/` (not committed to Git).

## Setup (Windows PowerShell, from the repository root)

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r analysis\requirements.txt
.venv\Scripts\python -m pytest tests\analysis -q
```

rasterio/GDAL is used when it imports. If Windows Application Control blocks its DLL, GeoTIFFs are read
with tifffile, and the CRS then comes from the SourceRecord WKT. SRTM `.hgt.zip` tiles are always read
with numpy (int16 big-endian, 3601², void −32768).

## Commands

| Step | Command |
|---|---|
| Raw data (Person 3's script) | `python scripts/fetch_data.py mars` and `... moon` need no login. For Earth: `$env:EARTHDATA_TOKEN='...'; python scripts/fetch_data.py earth`. Or copy `data/raw/` from the team Drive. |
| Demo corpus (synthetic, `is_demo=true`) | `.venv\Scripts\python -m analysis.build_candidates --demo` writes `data/processed/demo/` and `example_responses.json` |
| Real references only (early handoff) | `.venv\Scripts\python -m analysis.build_candidates --references-only` |
| Real full corpus | `.venv\Scripts\python -m analysis.build_candidates` |
| Validate | `.venv\Scripts\python -m analysis.validate_outputs` (add `--demo` for the fixture corpus) |
| Search (CLI) | `.venv\Scripts\python -m analysis.search --reference mars-jezero --profile slope_focus [--slope-weight 0.55] [--demo]` |

Every raw file is checked against its SourceRecord SHA-256 before use. A mismatch or a missing file stops
the build with a clear message. Nothing is substituted.

## Backend integration (Person 2)

```python
from analysis.search import SearchEngine, UnknownIdError, InvalidInputError, DataUnavailableError, SearchError
engine = SearchEngine.load()              # real corpus: data/processed/
# engine = SearchEngine.load(demo=True)   # fixtures: data/processed/demo/  -> show the demo banner
engine.search(reference_id, profile, slope_weight=None, top_k=3)   # -> RankingResponse dict
engine.compare(reference_id, selected_id, alternative_id, profile, slope_weight)  # evidence + tradeoffs
engine.sensitivity(reference_id, profile, slope_weight)          # top result at w ± 0.10 (not confidence)
# SearchError subclasses carry .http_status (404/422/503) and .envelope() -> {"error": {code, message, retryable}}
```

Load the engine once at startup. Requests only read processed JSON; they never touch rasters. Until the
Earth corpus exists, `SearchEngine.load()` raises `DataUnavailableError` (503). Example payloads are in
`data/processed/demo/example_responses.json`. Each ranking item has the contract fields plus these
additive fields: `rank`, `total_distance`, `contributions`, `center`, `preview_url`, `is_demo`.

## Method (frozen; changes alter `corpus_version`)

- **Grid.** Local azimuthal-equidistant projection on each body's own figure: WGS84 for Earth, a
  1737.4 km sphere for the Moon, a 3396.19 km sphere for Mars. A Moon/Mars source whose CRS is not its
  body's sphere is refused. Cells are 1000 m with a 2-cell buffer. Row 0 is north and columns increase
  eastward. IDs are `earth-<parent>-rNN-cNN`.
- **Area average.** Each source pixel is split into k×k sub-samples with spacing ≤ 125 m, all carrying the
  pixel's value. k = 1 for SRTM (30 m) and LOLA (80 m); k = 4 for MOLA (463 m). Sub-samples are binned
  into 1000 m cells, which approximates exact area-overlap weighting. A cell is valid when it holds at
  least 0.5 × the nominal sample count. Gaps are not filled. Sources coarser than 1000 m are refused,
  because that would mean upsampling.
- **Physical values.** SRTM is int16 metres on the EGM96 geoid, scale 1, offset 0. MOLA is int16 metres,
  areoid, nodata −32768. LOLA is float32 metres relative to the 1737.4 km sphere, nodata NaN. Scale and
  offset are applied once.
- **Features.** Horn 3×3 slope histogram with edges `[0,1,3,5,10,20,30,45,90]`, relief P95−P5, and local
  variation median `|h − mean3×3|`. A cell counts only when its full 3×3 neighbourhood is valid.
  Derivatives are computed on the buffered grid, then cropped.
- **Quality gate.** A window needs valid fraction ≥ 0.95 and ≥ 100 metric-valid cells. Earth windows with
  more than 5% exactly-0 m cells are rejected as suspected water or fill. Rejections are published with
  reasons and are never scored.
- **Score.** `D = w·d_slope + (1−w)/2·(d_relief + d_variation)` and `score = 100(1−D)`. `terrain_general`
  uses w = 0.40 and `slope_focus` uses w = 0.70. No scaler is applied. Results are sorted by unrounded D,
  then candidate_id, and selected greedily so every pair of centres is ≥ 20 km apart (geodesic WGS84).

## Limitations

- The score is a heuristic similarity within this 3-parent corpus. It is not a probability, it is not
  calibrated, and there is no threshold for a "strong" match.
- The analysis is kilometre-scale. Local variation is not rock or grain roughness. Nothing here assesses
  rover routes or landing safety.
- Overlapping windows are correlated. The 243 windows are not independent samples, and nothing in this
  package is training data.
- Terrain data do not establish soil, temperature, biology, gravity, radiation, access or permits. Field
  suitability is unknown, and producing this corpus is not field validation.
