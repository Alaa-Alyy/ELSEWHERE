# Submission package checklist (NASA Space Apps 2026)

Challenge: *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars.*

| Item | Where | Status |
|---|---|---|
| Repository (public, all branches merged to `main`) | https://github.com/Alaa-Alyy/ELSEWHERE | in progress |
| Reproducible README (setup, run, demo vs real) | `README.md`, `backend/README.md`, `frontend/README.md`, `analysis/README.md` | done |
| Lightweight processed evidence | `data/processed/` (parents, candidates, references, search_manifest, manifests, previews) | references done; Earth corpus pending |
| Raw data retrieval path (raw rasters not in Git) | `scripts/fetch_data.py` + `data/README.md` | done |
| Source registry with SHA-256 | `data/sources/*_sources.json` | done |
| Processing manifests | `data/processed/manifests/*.json` | references done; Earth pending |
| Contract + examples | `contracts/schema-v2.json`, `contracts/examples/` | done |
| Working public URL | only if deployed **and** checked from another device | not deployed |
| Backup video (1 min, real corpus) | follow `docs/DEMO_SCRIPT.md` | todo |
| Method + limitations summary | section below (copy to submission form) | done (update numbers after real run) |
| AI disclosure | section below | done |
| Ownership notes | `docs/PARALLEL_PLAN.md` | done |

## Method (short)

MissionMatch compares one 20 km Moon reference (NASA LOLA south-pole DEM, `LDEM_80S_80MPP_ADJ`) and one
20 km Mars reference (NASA/USGS MOLA 463 m DEM, Jezero) with 243 planned 20 km Earth windows (10 km stride)
inside three 100 km regions (Harrat Khaybar, El Pinacate, Death Valley; NASA SRTMGL1 v003). All elevations
are reprojected on each body's own figure to a local metric grid and analysed at 1000 m. Features: 8-bin
slope distribution (3x3 Horn), relief (P95-P5) and median local height variation. A fixed, declared distance
(`D = w*d_slope + (1-w)/2*(d_relief + d_variation)`, index = `100*(1-D)`) ranks windows with scikit-learn
NearestNeighbors (brute force, no training). Up to three results at least 20 km apart are returned. Users
can change slope priority, compare a selected window with an alternative per metric, and confirm a
reproducible Mission Decision Brief.

## Limitations (keep in the submission)

- Terrain only, at kilometre scale. Soil/regolith, temperature, illumination, ice, biology, gravity,
  radiation, atmosphere, access and permits are not established.
- Limited corpus of 3 Earth regions: results are the closest available windows, not a global best analog
  and not previously unknown discoveries.
- The similarity index is a heuristic, not a probability; overlapping windows are correlated.
- Not a landing-safety, rover-route or field-validated assessment.

## Data citations

- NASA JPL (2013). SRTM Global 1 arc second, SRTMGL1 v003. doi:10.5067/MEaSUREs/SRTM/SRTMGL1.003
- Barker, M.K., et al. (2023), Planet. Sci. J., doi:10.3847/PSJ/acf3e1; dataset doi:10.60903/gsfcpgda-lola-spole
- Smith, D.E., et al. (2001), JGR 106(E10), 23689-23722 (MOLA); USGS Astrogeology MOLA 463 m DEM mosaic
- Display imagery: NASA EOSDIS GIBS / Worldview, Blue Marble Shaded Relief and Bathymetry

## AI disclosure

- In the product: OpenAI gpt-4.1-mini generates optional explanations from server-side measured evidence.
  It does not compute features, scores or rankings. The decision brief is deterministic and works without it.
- In development: the team used AI coding assistants (including Anthropic Claude) to draft code, tests and
  documentation. All results come from the code and data in this repository; follow the event's AI rules.

## Before you submit

- [ ] `docs/INTEGRATION_QA.md` items 26-27 are real-verified (real corpus, no DEMO banner).
- [ ] Numbers in the method text match the final `/api/rankings` scope (valid windows).
- [ ] Backup video recorded on the real corpus.
- [ ] Every link opens from a logged-out browser.
- [ ] No secrets in the repo (`git log -p | findstr /i "sk- OPENAI_API_KEY=s eyJ0"` returns nothing).
