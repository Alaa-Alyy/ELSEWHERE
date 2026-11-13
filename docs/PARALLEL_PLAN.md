# MissionMatch - parallel plan (v2.0)

> **The v1 whole-site ranking plan is superseded.** v2 searches 243 planned 20 km Earth windows inside
> 3 parent regions against one 20 km Moon and one 20 km Mars reference. `/api/sites`, `site_id` payloads
> and whole-desert scores must not be reintroduced.

Story anchor (verbatim): **"Exploring other worlds starts with understanding our own."**

## Frozen scope

| In | Out (do not add) |
|---|---|
| 3 Earth parents (Khaybar, Pinacate, Death Valley), 81 windows each = 243 planned | full-Earth scan, new parents |
| 2 references: `moon-south-pole-sector`, `mars-jezero`, 20 km, 1000 m grid | 3D Moon/Mars globe (previews are 2D) |
| NearestNeighbors (brute, callable fixed distance), no scaler | trained/deep model, second AI model |
| ≤3 results, centers ≥20 km apart; slope weight 0..1 | route planner, rover simulator |
| deterministic DecisionRecord; gpt-4.1-mini explanations | match probability, NASA approval, "first discovery", safe-route claims |
| 3D Earth globe + story intro with skip | PDF export is stretch only |

Versions stay `schema_version = pipeline_version = score_version = "2.0"`.

## Ownership

| Path | Owner |
|---|---|
| `analysis/`, `tests/analysis/`, `data/processed/`, `data/raw/earth/`, `data/sources/earth_sources.json`, `data/config/regions.json` | Person 1 |
| `backend/`, `contracts/`, `tests/backend/`, `data/raw/moon/`, `data/sources/moon_sources.json`, `data/config/moon_region.json` | Person 2 |
| `frontend/`, `tests/frontend/`, `data/raw/mars/`, `data/sources/mars_sources.json`, `data/config/mars_region.json` | Person 3 |
| `README.md`, `docs/`, `scripts/contract_check.py`, `tests/integration/` | Person 2 coordinates; edits announced |
| `scripts/fetch_data.py` | shared (written by Person 3; changes announced) |

Nobody edits another owner's implementation to unblock themselves. Raise a contract issue
(`docs/BLOCKER_TEMPLATE.md`) and keep working on fixtures.

## Dependency graph

```
minute 15: v2 contracts + examples acknowledged (contracts/)
P1: Earth SRTM -> extractor -> candidate corpus -> search() ----------+
P2: LOLA crop -> handoff --+   API on demo corpus -> real API --------+--> real search in UI
P3: MOLA crop -> handoff --+   story/globe on fixtures -> real UI ----+
                           |
                 P1 runs the ONE shared pipeline on both references
                           |
       real corpus + references + manifests (data/processed/)
                           |
   search adapter -> tradeoffs -> DecisionRecord -> grounded chat -> end-to-end QA
```

## Fixture strategy

1. Person 1's demo corpus `data/processed/demo/` (`is_demo=true`) is the shared fixture for the backend.
2. Backend `DEMO_FIXTURES=true` serves it; `false` refuses any `is_demo` record and never falls back.
3. Frontend `VITE_USE_FIXTURES=true` uses its own labeled mock (works with no backend);
   `false` talks to the API. A DEMO banner shows whenever any record is `is_demo`.
4. Real-data claims require `/api/health` `data_ready=true` and `python scripts/contract_check.py` = PASS.

## Timeline and status (2026-11-13)

| When | Deliverable | Status |
|---|---|---|
| 0-15 min | scope/IDs acknowledged, branches, ports (API 8000, Vite 5173, preview 4173) | done |
| 15-45 min | P1 synthetic fixtures + metric API; P2 API skeleton; P3 story shell + mock adapter | done |
| Hour 1 | fixture UI <-> fixture API round trip; extractor CLI; one verified file open per source | done (all 3 sources opened, SHA-256 recorded) |
| Hour 3 | first real reference/candidate handoff; all screens on fixtures | references real; **Earth corpus pending** |
| Hour 5 | first real search in the UI, real geometry + sources | blocked on Earth corpus (P1 has the tiles zip) |
| Hour 7 | both references, weights, alternative comparison, decision, grounded chat; **feature freeze** | decision done; chat needs `OPENAI_API_KEY` |
| Hours 7-9 | metrics, build/preview, coordinates, failure states (`docs/INTEGRATION_QA.md`) | partly done on demo corpus |
| Final 2-3 h | rehearsal (`docs/DEMO_SCRIPT.md`), backup video, links, submission (`docs/SUBMISSION.md`) | todo |

### Current critical path

1. **P1**: unzip `earth_raw_for_person1.zip` into `data/raw/earth/`, run
   `python -m analysis.build_candidates`, review Pinacate coast windows, freeze `regions.json`,
   `python -m analysis.validate_outputs`, commit `data/processed/`.
2. **P2**: `DEMO_FIXTURES=false`, confirm `data_ready=true`, publish new `corpus_version`; configure
   `OPENAI_API_KEY` in `backend/.env` and run one live chat check.
3. **P3**: `VITE_USE_FIXTURES=false`, run the full journey on real data, then QA checklist.

## Branches and merges

- One branch per owner: `analysis-work` (P1), `person2-backend` (P2), `person3-frontend` (P3),
  `integration` (docs/checks). Short-lived feature branches are fine.
- Merge small and often, at least at every checkpoint above. Never one end-of-day merge.
- Before every merge, run the checklist in `.github/pull_request_template.md`.
- A change to metric, source, grid or config **invalidates the corpus** (new `corpus_version`),
  not just a UI label: rebuild, re-validate, re-announce.

## Acceptance gates (must all hold before claiming results)

- `python scripts/contract_check.py` PASS (real mode, no `--allow-partial`).
- `python -m analysis.validate_outputs` OK.
- `pytest tests/analysis tests/backend tests/integration` and `npm test` (frontend) green.
- `npm run build && npm run check:bundle` PASS and `npm run preview` loads the globe.
- `/api/health`: `data_ready=true`, `demo_mode=false`.
- Every QA item in `docs/INTEGRATION_QA.md` ticked.
