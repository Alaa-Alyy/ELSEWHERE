# Integration QA checklist (v2.0)

Status legend: **demo-verified** = checked on the labeled demo corpus (proves plumbing, not science) ·
**real-verified** = checked on the real corpus · **pending** = not yet checked. Update the column when you
re-check; write the date and who checked. Do not tick real-verified on demo data.

Last update: 2026-11-13.

## Automated gates

| Command | Result 2026-11-13 |
|---|---|
| `python scripts/contract_check.py --demo` | PASS |
| `python scripts/contract_check.py --allow-partial` (real references only) | PASS |
| `python scripts/contract_check.py` (real, full) | **FAIL - expected: Earth corpus not built yet** |
| `python -m analysis.validate_outputs --demo` | OK |
| `pytest tests/analysis tests/backend tests/integration` | 74 passed |
| `cd frontend && npm test` | 19 passed |
| `npm run build && npm run check:bundle` | PASS (no fixtures, no secrets in real bundle) |

## End-to-end checks

| # | Check | How | Status |
|---|---|---|---|
| 1 | Mars request uses `mars-jezero`, Moon uses `moon-south-pole-sector` | frontend test `Moon requests the lunar reference`; backend refs | demo-verified |
| 2 | Both profiles return their default weights (0.40 / 0.70) | `/api/rankings` without `slope_weight` | demo-verified |
| 3 | `slope_weight=0` and `=1` work (0 not treated as default) | backend `test_slope_weight_zero_is_honored`, `test_rankings_equal_person1_search`; frontend slider test | demo-verified |
| 4 | ≤3 results, centers ≥20 km apart; fewer results shown honestly with warning | P1 tests; UI shows warnings | demo-verified |
| 5 | No fake rank change: UI states "changed" or "stayed" from real responses | reducer test `reports an unchanged winner honestly` | demo-verified |
| 6 | Marker, card and footprint use the same `candidate_id` | frontend journey test (globe probe) + screenshot | demo-verified |
| 7 | Old HTTP responses cannot overwrite newer settings | reducer stale-response tests | demo-verified |
| 8 | Switching Mars -> Moon clears selection, decision and chat | reducer test | demo-verified |
| 9 | Why-not values = weight x distance from server | backend decision test; UI renders server values only | demo-verified |
| 10 | DecisionRecord has current IDs, weights, corpus_version, sources, limitations; stable `decision_id` | backend decision tests; browser run against API | demo-verified |
| 11 | Tampered client score rejected | backend 422 tests (`score` field) | demo-verified |
| 12 | Chat returns only known candidate/source IDs; admits unsupported dimensions | backend chat test with fake upstream | demo-verified (fake upstream) |
| 13 | **Live** gpt-4.1-mini answer grounded, in user's language | one manual call after `OPENAI_API_KEY` is set | pending |
| 14 | Chat unavailable -> readable state; evidence/search/decision still work | no key: 503 + disabled button; decision 200 | demo-verified |
| 15 | Map imagery unavailable -> readable error, cards still work | headless Edge with `gibs.earthdata.nasa.gov` blocked: error shown, 3 cards usable | verified (preview build) |
| 16 | Backend down -> readable error in UI | real build, no API: "Cannot reach the MissionMatch API. Check that the backend is running." | verified (preview build) |
| 17 | Invalid input -> 422 envelope; unknown ID -> 404 | backend `test_error_codes` | demo-verified |
| 18 | No NaN/Infinity/null scores in production JSON | `contract_check.py` strict parse | demo-verified · real pending |
| 19 | No fixture leakage in real mode (API + bundle) | backend `test_real_mode_refuses_demo_corpus`, `check:bundle`, contract_check | verified |
| 20 | Raw files traceable (SHA-256 in `data/sources/*`) and re-checked before use | P1 pipeline hashes inputs | verified for Mars, Moon, Earth tiles |
| 21 | `npm run build` + `npm run preview` load Cesium workers/assets (not only dev) | preview served `cesiumStatic/Workers/*` 200; globe rendered | verified |
| 22 | CORS works from 5173 and 4173, rejects others | backend `test_cors_allowlist`; browser run | verified |
| 23 | 360 px layout stacks globe above panel | headless screenshot at 360 px | demo-verified |
| 24 | Keyboard-only journey (Tab/Enter/arrow keys on radios and slider), visible focus | manual | pending |
| 25 | Reduced motion: intro shows question immediately, fly-to has no animation | OS setting or devtools emulation | pending (code path present) |
| 26 | Real corpus: 243 planned, valid count reported, Pinacate sea windows rejected or parent moved | P1 manifests + previews | **pending (blocking)** |
| 27 | Real corpus: `data_ready=true`, `demo_mode=false`, DEMO banner absent | `/api/health`, UI | **pending (blocking)** |


## Honesty review before demo/submission

- [ ] No wording says "match probability", "% of Mars", "global best", "first discovery", "NASA approved", "safe route".
- [ ] Scope sentence visible: 3 parents, valid/planned windows, 1000 m grid, limited corpus.
- [ ] Missing dimensions visible in the Decision Brief (soil, temperature, ice, gravity, radiation, atmosphere, access).
- [ ] If any demo data is on screen, the DEMO banner is visible.
- [ ] Project delivery is not described as field validation.
