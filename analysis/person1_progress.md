# Person 1 progress / handoff (v2.0)

_Last update: 2026-11-13. Branch `analysis-work`, based on `origin/data-setup` (ea22edd)._

## Environment (verified on this machine)
- Python 3.12.10 venv `.venv`: numpy 2.5.4, scipy 1.18.1, scikit-learn 1.9.1, pyproj 3.8.0,
  rasterio 1.5.2 (GDAL 3.12.2), tifffile 2026.10.15, pillow, pytest.
- rasterio was blocked by Windows Application Control earlier the same day and now imports. Both readers
  are kept, and they agree exactly on the real Mars and Moon crops (same geotransform, same values).
- `EARTHDATA_TOKEN` is not set on this machine.

## Done
- Pipeline: `analysis/{config,preprocess,extract_features,build_candidates,search,validate_outputs}.py`,
  adapted to data-setup (region configs, `*_sources.json`, SHA-256 checks).
- Tests: `tests/analysis`, 52 passing. They cover every acceptance gate, the GeoTIFF readers, the body-figure
  guard, the crop-coverage guard and end-to-end synthetic HGT.
- Demo corpus `data/processed/demo/` (`is_demo=true`): 243 planned, 232 valid, 11 rejected, plus
  `example_responses.json`. Digest `sha256:a108f5a6…`, reproducible. `validate_outputs --demo` reports OK.
- Mars and Moon crops reproduced here with `scripts/fetch_data.py`. Their SHA-256 is identical to the
  committed SourceRecords, and those records were left unchanged.
- **Real references** in `data/processed/references.json` (measured, not demo):
  - moon-south-pole-sector: valid fraction 1.0, relief 2296.1 m, local variation 23.15 m
  - mars-jezero: valid fraction 1.0, relief 723.0 m, local variation 4.59 m

## Blocked
1. **Earth SRTM tiles are not on this machine.** Step 8 (real candidates) and the regions.json freeze wait on
   this. Either run `$env:EARTHDATA_TOKEN='<token>'; python scripts/fetch_data.py earth` (18 tiles, 177 MB),
   or copy `data/raw/earth/` from Person 3's Drive. The code is tested and ready. Until then
   `SearchEngine.load()` answers 503, and Persons 2 and 3 continue on the demo fixtures.
2. Freeze checklist, to run once the tiles are present:
   - Run `build_candidates`, then `validate_outputs`.
   - Inspect `previews/earth-*.png` and the `manifests/earth-*.json` rejected windows.
   - Pinacate: check SW coast/sea windows (water guard). If needed, shift the centre inland and record it
     in `center_adjustments`.
   - Death Valley N36W117 min −130 m: note only.
   - Set `freeze.frozen=true` before looking at rankings.

## Next
- Once Earth is processed: commit `data/processed/{parents,candidates,references,search_manifest}.json`,
  manifests and previews, then tell Person 2 the new `corpus_version`.
