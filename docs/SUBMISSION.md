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

**Discovery mode.** Users can pin any Mars location (NASA/USGS MOLA 463 m) or Moon location (NASA LOLA
LDEM_64, ~474 m; LDEM_80S 80 m near the south pole) on a 3D globe; the 20 km window is measured with the same
pipeline. Earth is then searched over all land between 56°S and 60°N: NASA SRTMGL30 (30 arc-second) is run
through the identical 100 km parent pipeline on a 90 km lattice, giving a global corpus of 20 km windows
(10 km stride): 53,288 parents, 1,143,707 valid windows. Results are at least 100 km apart and labelled when they fall inside a short list of
well-known analog areas. In a Khaybar comparison of the same 81 windows, SRTMGL30 vs SRTMGL1 agreed closely on
slope distribution (median distance 0.012) and relief (ratio 0.996) but gave ~20 % lower local height
variation.

## Limitations (keep in the submission)

- Global discovery uses ~1 km Earth data (SRTMGL30) and covers 56°S-60°N only; local height variation is
  biased low vs 30 m data. Being outside our known-analog list is not evidence of a new discovery.

- Terrain only, at kilometre scale. Soil/regolith, temperature, illumination, ice, biology, gravity,
  radiation, atmosphere, access and permits are not established.
- Curated mode searches only 3 Earth regions. In both modes results are the closest available windows,
  not a "best analog" and not previously unknown discoveries.
- The similarity index is a heuristic, not a probability; overlapping windows are correlated.
- Not a landing-safety, rover-route or field-validated assessment.

## Data citations

- NASA JPL (2013). SRTM Global 1 arc second, SRTMGL1 v003. doi:10.5067/MEaSUREs/SRTM/SRTMGL1.003
- Barker, M.K., et al. (2023), Planet. Sci. J., doi:10.3847/PSJ/acf3e1; dataset doi:10.60903/gsfcpgda-lola-spole
- Smith, D.E., et al. (2001), JGR 106(E10), 23689-23722 (MOLA); USGS Astrogeology MOLA 463 m DEM mosaic
- NASA JPL (2013). SRTM Global 30 arc second, SRTMGL30 v002. doi:10.5067/MEaSUREs/SRTM/SRTMGL30.002
- Smith, D.E., et al. (2010), LOLA, Space Sci. Rev. 150; LRO LOLA GDR LDEM_64, NASA PDS Geosciences Node
- Display imagery: NASA EOSDIS GIBS / Worldview, Blue Marble Shaded Relief and Bathymetry
- Display imagery: NASA Solar System Treks (Mars Trek MOLA colour shaded relief; Moon Trek LRO WAC mosaic)

## AI disclosure

- In the product: one LLM generates optional explanations from server-side measured evidence. The brief's
  default is OpenAI gpt-4.1-mini; the team ran Google Gemini (`LLM_PROVIDER=gemini`,
  `gemini-3.1-flash-lite`, fallback `gemini-3-flash-preview`) through Gemini's OpenAI-compatible API. **State the provider/model actually used in the demo** (shown in
  `/api/health` `chat_model`). The model does not compute features, scores or rankings. The decision brief
  is deterministic and works without it.
- In development: the team used AI coding assistants (including Anthropic Claude) to draft code, tests and
  documentation. All results come from the code and data in this repository; follow the event's AI rules.

## Before you submit

- [ ] `docs/INTEGRATION_QA.md` items 26-27 are real-verified (real corpus, no DEMO banner).
- [ ] Numbers in the method text match the final `/api/rankings` scope (valid windows).
- [ ] Backup video recorded on the real corpus.
- [ ] Every link opens from a logged-out browser.
- [ ] No secrets in the repo (`git log -p | findstr /i "sk- OPENAI_API_KEY=s eyJ0"` returns nothing).
