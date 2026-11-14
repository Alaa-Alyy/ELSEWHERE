# Prompt: write the ELSEWHERE project report

Copy everything below the line into your AI assistant (or use it yourself as the full brief).
All facts here were checked against the code and real runs on 2026-11-14. Do not change numbers;
if something is missing, ask the team instead of guessing.

---

## Your role and task

You are a scientific technical writer. Write the **project report** for **ELSEWHERE**, our NASA Space Apps
Challenge 2026 (Cairo) project, for the **NASA Space Apps judges** (scientists and engineers who read many
entries quickly). It must be clear in 60 seconds (summary first), then detailed, honest and verifiable.

- **Name:** ELSEWHERE
- **Slogan (verbatim):** "Exploring other worlds starts with understanding our own."
- **Challenge:** *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars.*
- **Repository:** https://github.com/Alaa-Alyy/ELSEWHERE (code, data provenance, tests, docs)
- **Language:** English. **Length:** about 6-10 pages (or what the team asks), with headings, tables and figure captions.

### Ask the team before writing (do not invent)
1. Team member names and roles (we know: Person 1 = terrain analysis, Person 2 = backend/API/AI,
   Person 3 = frontend/visualisation and integration; GitHub owner: Alaa-Alyy).
2. Required report format or word limit from the event, if any.
3. Whether a live URL exists (none is deployed yet) and the demo video link.
4. The screenshots listed in "Figures to capture" below.

---

## 1. The problem (why it matters)

Moon and Mars missions test rovers, instruments and crew procedures on Earth first. Classic analog sites
(Atacama, Death Valley, Iceland, Hawaii, Antarctica) are well known, but the challenge asks us to search
**globally and systematically**, look **beyond famous sites**, explain **what is similar, how similar and what
is different**, and remember **Earth's limits** (gravity, vacuum/thin atmosphere, radiation).

## 2. What ELSEWHERE does (one paragraph)

A user picks **any place on the Moon or Mars** on a 3D globe. ELSEWHERE measures that 20 x 20 km window's
terrain from NASA elevation data, then compares it with **1,143,707 Earth land windows (56°S-60°N)** using one
fixed, explainable distance, and returns the closest windows at least 100 km apart. For each result it shows
real orbital images of both places, a 3D view of both terrains built from the real elevation, a
"similar / different" scorecard (terrain measured; climate from NASA POWER; planet-wide physical facts),
potential research applications, and a reproducible decision brief. It is a **screening tool**: results are
leads to investigate, not validated analog sites.

## 3. Data (all NASA unless stated; raw rasters are not in Git, retrieval scripts are)

| Use | Dataset | Resolution | Notes |
|---|---|---|---|
| Earth, global search | NASA SRTMGL30 v002 (27 tiles) | 30 arc-second (~1 km) | doi:10.5067/MEaSUREs/SRTM/SRTMGL30.002; covers 56°S-60°N only |
| Earth, curated mode | NASA SRTMGL1 v003 | 1 arc-second (30 m) | doi:10.5067/MEaSUREs/SRTM/SRTMGL1.003; 3 regions |
| Mars | NASA/USGS MOLA MGS DEM | 463 m | Smith et al. 2001, JGR 106(E10); read remotely per window |
| Moon, global | LRO LOLA LDEM_64 (PDS) | 64 px/deg (~474 m) | Smith et al. 2010, Space Sci. Rev. 150 |
| Moon, south of 80.5°S | LOLA LDEM_80S_80MPP_ADJ | 80 m | Barker et al. 2023, PSJ, doi:10.3847/PSJ/acf3e1 |
| Earth climate (context only) | NASA POWER Climatology API v2.10.1 (MERRA-2, CERES SYN1deg) | ~0.5° x 0.625° (~50 km) | 2001-2025 means: temperature, precipitation, wind, sunlight |
| Planet facts (context only) | NASA GSFC Planetary Fact Sheets | body-wide | gravity, pressure, day length, mean temperature, sunlight |
| Display imagery | NASA GIBS (Blue Marble; Landsat WELD annual composite 2000), NASA Solar System Treks (Mars Viking MDIM 2.1 colour; Moon LRO WAC) | - | looking only, never used in the match |

Every source file has a SHA-256 record in `data/sources/`. Processing manifests are in `data/processed/`.

## 4. Method (exact; this is the scientific core)

**Windows.** Every place is a 20 x 20 km window on a **1000 m grid** (20 x 20 cells), projected to a local
azimuthal equidistant grid on **each body's own figure** (Moon sphere 1737.4 km, Mars sphere 3396.19 km, Earth
WGS84), with area-average binning. Earth "parents" are 100 km squares on a 90 km lattice (53,288 parents);
each parent yields 81 windows (10 km stride). A window is valid if >= 95% of cells are valid and it has >= 100
valid cells; windows with > 5% exactly-0 m cells are rejected as likely water.

**Ten-number terrain fingerprint per window.**
1. **Slope distribution**: 3 x 3 Horn (1981) slope in degrees, shares in 8 classes:
   0-1, 1-3, 3-5, 5-10, 10-20, 20-30, 30-45, 45-90°.
2. **Relief**: P95 - P5 of elevation (m).
3. **Local height variation ("roughness")**: median |h - mean of its 3 x 3 neighbourhood| (m) - kilometre-scale
   variability, NOT rock or grain roughness.

**Distance and index (fixed, declared before any run).**
- d_slope = 0.5 x sum |p_i - q_i| (0 = identical, 1 = disjoint)
- d_relief = |r_e - r_t| / max(|r_e|, |r_t|, 1 m); d_variation likewise
- **D = w x d_slope + (1 - w)/2 x (d_relief + d_variation)**, each part in [0, 1]
- **Terrain similarity index = 100 x (1 - D)** - a heuristic, **not a probability or a percentage match**.
- Profiles: `terrain_general` w = 0.40 (relief 0.30, variation 0.30); `slope_focus` w = 0.70 (0.15 / 0.15).
  The user can set the slope weight from 0 to 1.
- Ranking: scikit-learn NearestNeighbors, brute force, callable distance; results >= 100 km apart (global, top 5)
  or >= 20 km apart (curated, top 3).

**Why no machine-learning model:** there is no labelled set of "this Earth place is an analog of that Mars
place" to train on. A trained model would only learn our own assumptions. A fixed nearest-neighbour distance is
transparent: every result can be explained metric by metric, and the user can change the weights and see the
ranking change.

**Context layers (never part of the index).**
- Climate per Earth window from NASA POWER; dryness classes by annual precipitation: arid < 250 mm/yr,
  semi-arid 250-500, wet >= 500 ("likely vegetated"; precipitation is only a proxy).
- Mountain caveat: if window relief > 1000 m and precipitation is 250-1500 mm/yr, dryness is shown as
  "uncertain", because a ~50 km grid mixes dry plateaus with wet slopes (see 6.4).
- Scorecard bands for each terrain distance: <= 0.05 very similar, <= 0.15 similar, <= 0.30 partly similar,
  above that different (a reading convention, not a statistical test).
- Planet facts: Mars 0.38 g, ~6.4 mbar CO2, no global magnetic field, 24.7 h sol, about -65 °C mean, sunlight
  586 W/m² (43% of Earth); Moon 0.17 g, near vacuum, no magnetic field, 708.7 h solar day, -173 °C night to
  127 °C day at the equator, sunlight 1361 W/m² unfiltered; Earth 1 g, 1014 mbar, 24.0 h.

## 5. The product (user journey; for the "solution" and "UI" sections)

1. **Space hub:** a cartoon astronaut; Earth and Mars orbit him, the Moon orbits Earth (NASA textures, not to
   scale). The user clicks the Moon or Mars; the astronaut jumps onto it.
2. **Experiment question:** "What experiment will you run?" (rover test drive, landing/moonwalk rehearsal,
   base-camp survey, field geology). It only selects one of the two existing profiles.
3. **Pin anywhere** on a 3D Moon/Mars globe (or named places: Jezero, Gale, Olympus Mons, Hellas, Apollo 11 and
   15, Tycho, south pole...). A scanning view measures the window; its fingerprint is shown **before** any search.
4. **Search all Earth land:** a short warp cut-scene while the real search runs (0.1-0.4 s over 1.14 M windows).
5. **Results:** the astronaut lands on #1 on a 3D Earth globe and hops to any other result. Cards show the
   index (2 decimals), per-metric closeness bars, closest metric / biggest gap, climate chip, known-analog label,
   and a "Why are scores so high?" explanation.
6. **Site dossier** (tabs): Overview (real image pair at the same 60 km scale + 3D blocks from real elevation,
   same vertical exaggeration for both) - Similar / Different - Research applications (each cites the number it
   rests on; four suitability levels: terrain similarity, environmental suitability, operational accessibility,
   scientific validation) - Measurements & sources.
7. **Tradeoffs:** compare the selection with an alternative, metric by metric; move the slope slider and see
   whether the ranking changes.
8. **Decision brief:** deterministic record (ID = SHA-256 of its canonical JSON) with evidence, versions,
   sources, limitations and a proposed (not executed) test.
9. **Grounded chat (optional):** Google Gemini (gemini-3.1-flash-lite, fallback gemini-3-flash-preview) through
   the OpenAI-compatible API, answering only from server-provided evidence; it never computes scores.
- Optional CC0 sound effects (off by default); reduced-motion support; works on phones.

**Tech:** React 18, Vite 5, CesiumJS, three.js; FastAPI + Pydantic v2 (Python 3.12); analysis with NumPy,
SciPy, scikit-learn, pyproj and rasterio (GDAL); 94 Python tests + 37 frontend tests, all passing.

## 6. Verification and results (real runs; quote exactly)

**6.1 Pipeline consistency.** A pin on Jezero reproduces the stored Jezero reference exactly (relief 723.0 m,
local variation 4.59 m); a Moon south-pole pin reproduces the stored lunar reference (2296.1 m / 23.15 m).

**6.2 Resolution check (global vs fine data).** For the same 81 Khaybar windows, SRTMGL30 (~1 km) vs SRTMGL1
(30 m): slope-distribution distance median 0.012; relief ratio 0.996 (correlation 1.0); local variation about
**20% lower** with ~1 km data (correlation 0.99). The UI states this bias.

**6.3 Sanity / positive control (qualitative).** Searching from a Moon south-pole window returned windows
inside **Atacama (#1)** and **Death Valley (#4)** without being told about them - both are well-known analog
areas. This is encouraging but is **not** an accuracy measure (there is no ground truth).

**6.4 Terrain vs environment (the key finding to discuss).** From Jezero crater (Mars):
- #1 by terrain: Montana, USA (47.96°N, 112.59°W), index ~97 - but **wet** (636 mm/yr, 4 °C mean).
- #2 by terrain: Algeria (32.94°N, 0.37°W), index ~96 - **arid** (212 mm/yr). With the balanced/geology
  profile Algeria is #1 (96.46).
So two places can match in shape but differ in environment; ELSEWHERE makes that visible. Another example:
from the lunar south pole, top terrain matches include the Amazon (0.75°N, 65.98°W, 2560 mm/yr) - a terrain
analog only. Data caveat found and handled: a window in the Argentine Puna reads 749 mm/yr on the ~50 km POWER
grid while the true Atacama core reads 7 mm/yr; hence the mountain "uncertain" flag.

**6.5 Why indices are in the 90s.** With 1.14 M candidates and a 10-number fingerprint, close matches almost
always exist; flat sites match most easily (flat plains are common). Nothing is rounded or capped in the
calculation; the UI shows two decimals.

(Exact top results depend on the chosen site and profile; describe them as examples from the current corpus.)

## 7. Limitations (must appear in the report)

- Terrain shape only, at kilometre scale (1 km grid). Rocks, soil/regolith, mineralogy, ice/permafrost, dust
  processes, biology, caves/lava tubes, illumination at the poles and land use/access are **not assessed**.
- Global Earth data cover 56°S-60°N only (no polar regions); local variation is biased low (~20%).
- Climate is a ~50 km modelled climatology, context only; mountain precipitation can be wrong.
- Mars/Moon environment rows are planet-wide values, not site measurements.
- The index is a heuristic, not a probability; overlapping windows are correlated; there is no ground-truth
  validation; results need field checks (site visit, drone survey) before any test is planned.
- Earth cannot reproduce reduced gravity, vacuum / thin CO2 atmosphere or the radiation environment.
- "Not in our list of well-known analog sites" is **never** a first-discovery claim.

## 8. Impact and future work (keep realistic)

Impact: fast, transparent first screening of Earth test sites for rover mobility, autonomous navigation,
EVA rehearsal, landing-site training and remote-sensing validation; open, reproducible, NASA data only.
Future work: add geology/mineralogy layers (e.g. geologic maps, ASTER), vegetation (MODIS NDVI) as a filter,
polar Earth coverage (e.g. Copernicus/ArcticDEM), finer Earth DEMs for shortlisted sites, Mars/Moon thermal and
illumination data, and field validation with analog-site experts.

## 9. AI disclosure (required)

- In the product: one LLM (Google Gemini via OpenAI-compatible API) writes optional explanations from
  server-provided evidence only; it does not compute features, scores or rankings; the decision brief is
  deterministic and works without it.
- In development: the team used AI coding assistants (including Anthropic Claude) to draft code, tests and
  documentation; all results come from the code and data in the repository.

## 10. Writing rules (honesty)

- Never write: "match probability", "% match", "% of Mars", "best analog in the world", "first discovery",
  "NASA approved", "safe landing/route", "validated site".
- Always separate **measured** (terrain metrics), **computed** (index, distances), **context** (climate, planet
  facts, imagery) and **AI-generated** (chat) information.
- Quote numbers exactly as given here; cite datasets with their DOIs/links.

## 11. Suggested structure

1. Title, team, slogan, one-paragraph summary (what, how, key finding, honesty statement)
2. Challenge and motivation
3. Data sources (table)
4. Method (windows, fingerprint, distance, why no ML, context layers) with the formula
5. The ELSEWHERE application (journey + 3-4 screenshots)
6. Verification and results (6.1-6.5)
7. Limitations
8. Impact and future work
9. AI disclosure
10. References and data citations; link to the repository

## 12. Figures to capture (ask the team for screenshots)

1. Space hub with the astronaut and orbiting planets.
2. 3D Mars globe with a Jezero pin and its terrain fingerprint.
3. Results: Earth globe with the astronaut on #1 and the result cards.
4. Site dossier - Overview (image pair + 3D blocks).
5. Site dossier - Similar / Different table (Jezero vs Montana and vs Algeria).
6. Decision brief.
Caption each figure with what is real data and what is illustration (planet sizes in the hub, cartoon colours
and astronaut in the 3D view are illustrative; terrain shapes and imagery are real).
