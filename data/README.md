# MissionMatch data (v2.0)

We only need **three official elevation models (DEMs)** — everything else on the
challenge resource page is out of the frozen scope.

| Body | Product | Access | Needs login? | Owner |
|---|---|---|---|---|
| Mars | USGS MOLA 463 m global mosaic | remote crop (GDAL range read) | no | Person 3 |
| Moon | NASA LOLA `LDEM_80S_80MPP_ADJ.TIF` | remote crop (GDAL range read) | no | Person 2 |
| Earth | SRTMGL1 v003 (LP DAAC) | 18 tiles, zip | **yes** – free Earthdata token | Person 1 |

## Layout

```
data/
  config/   regions.json, mars_region.json, moon_region.json   <- in Git (provisional seeds)
  sources/  {mars,moon,earth}_sources.json (SourceRecords + SHA-256)   <- in Git
  raw/      the actual rasters                                  <- NOT in Git (team Drive)
  processed/ parents/candidates/references.json, manifests, previews <- in Git (Person 1)
```

## Get the raw data on your machine

```bash
pip install rasterio pyproj numpy
python scripts/fetch_data.py mars     # ~16 KB crop, no login
python scripts/fetch_data.py moon     # ~1 MB crop, no login
python scripts/fetch_data.py earth --list
# Earth: create a free account at https://urs.earthdata.nasa.gov, Profile -> Generate Token, then
#   PowerShell:  $env:EARTHDATA_TOKEN="..." ; python scripts/fetch_data.py earth
#   bash:        EARTHDATA_TOKEN=... python scripts/fetch_data.py earth
```

Re-running gives the same crop; compare the SHA-256 in `data/sources/*.json`.
If you cannot run the script, copy `data/raw/` from the team Drive folder instead.

## Data flow

1. Each person fetches (or copies from Drive) the raw files.
2. **Person 1** runs the shared `analysis/` pipeline on all of them and commits
   the small outputs in `data/processed/`.
3. Backend (Person 2) and frontend (Person 3) only read `data/processed/` +
   `data/sources/`; nobody else needs GDAL.

## Notes for Person 1

- Mars crop: 40 km box in the native simple-cylindrical Mars grid (sphere R = 3396190 m), int16 m, nodata -32768.
- Moon crop: 40 km box in native south polar stereographic (sphere R = 1737400 m), float32 m, nodata NaN.
- Both are pixel-exact copies of the official files (no resampling). Reproject to the local metric grid
  with the body's own figure; never assign Earth WGS84.
- Centers in `data/config/*.json` are **provisional** planning seeds — verify and freeze.
