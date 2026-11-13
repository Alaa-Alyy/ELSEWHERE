# Integration QA checklist (v2.0)

Status legend: **real-verified** = checked on the real corpus · **demo-verified** = checked on the labeled
demo corpus (plumbing only) · **pending** = not yet checked. Update the column when you re-check; write the
date. Do not tick real-verified on demo data.

Last update: 2026-11-14. Real corpus `sha256:f9efd7c592ad8e73bbcab88cb2a2c67cf3ecbfa604e00c7b18f68dea0f22ac7e`
(243 planned / 232 valid / 11 rejected; regions frozen 2026-11-13T22:02:43Z after coverage review).

## Automated gates

| Command | Result |
|---|---|
| `python scripts/contract_check.py` (real, full) | PASS |
| `python scripts/contract_check.py --demo` | PASS |
| `python -m analysis.validate_outputs` (real) | OK |
| `python -m analysis.validate_outputs --demo` | OK |
| `pytest tests/analysis tests/backend tests/integration` | 74 passed |
| `cd frontend && npm test` | 19 passed |
| `npm run build && npm run check:bundle` | PASS (no fixtures, no secrets in real bundle) |
| Rebuild with identical inputs/config | identical `corpus_version` (reproducible) |

## End-to-end checks

| # | Check | How | Status |
|---|---|---|---|
| 1 | Mars request uses `mars-jezero`, Moon uses `moon-south-pole-sector` | browser journey (production preview) + API rankings for both | real-verified |
| 2 | Both profiles return their default weights (0.40 / 0.70) | `/api/rankings` both profiles, both references | real-verified |
| 3 | `slope_weight=0` and `=1` work (0 not treated as default) | backend tests (engine equality at 0, 0.55, 1); keyboard slider run 0.40 -> 0.50 | real-verified (slider), tests on demo |
| 4 | ≤3 results, centers ≥20 km apart; fewer results shown honestly with warning | P1 tests; real rankings return 3 distinct windows | real-verified |
| 5 | No fake rank change: UI states "changed" or "stayed" from real responses | real run: "top distinct result stayed earth-death-valley-r03-c07" at 0.50 | real-verified |
| 6 | Marker, card and footprint use the same `candidate_id` | frontend test + real screenshot (footprint on Death Valley) | real-verified |
| 7 | Old HTTP responses cannot overwrite newer settings | reducer stale-response tests | demo-verified (unit) |
| 8 | Switching Mars -> Moon clears selection, decision and chat | reducer test | demo-verified (unit) |
| 9 | Why-not values = weight x distance from server | backend decision test; UI renders server values only | real-verified |
| 10 | DecisionRecord has current IDs, weights, corpus_version, sources, limitations; stable `decision_id` | browser decision on real API; backend tests | real-verified |
| 11 | Tampered client score rejected | backend 422 tests (`score` field) | verified (tests) |
| 12 | Chat returns only known candidate/source IDs; admits unsupported dimensions | backend chat test with fake upstream | verified with fake upstream |
| 13 | **Live** gpt-4.1-mini answer grounded, in user's language | one manual call after `OPENAI_API_KEY` is set | **pending (needs key)** |
| 14 | Chat unavailable -> readable state; evidence/search/decision still work | no key: 503 + disabled button; decision 200 | real-verified |
| 15 | Map imagery unavailable -> readable error, cards still work | headless Edge with GIBS blocked | verified (preview build) |
| 16 | Backend down -> readable error in UI | real build, no API | verified (preview build) |
| 17 | Invalid input -> 422 envelope; unknown ID -> 404 | backend `test_error_codes` | verified (tests) |
| 18 | No NaN/Infinity/null scores in production JSON | `contract_check.py` strict parse, real mode | real-verified |
| 19 | No fixture leakage in real mode (API + bundle) | real health `demo_mode=false`, no DEMO banner, `check:bundle` | real-verified |
| 20 | Raw files traceable (SHA-256 in `data/sources/*`) and re-checked before use | P1 pipeline hashes inputs on every build | real-verified |
| 21 | `npm run build` + `npm run preview` load Cesium workers/assets | production preview against real API | real-verified |
| 22 | CORS works from 5173 and 4173, rejects others | backend test; browser preview on 4173 | real-verified |
| 23 | 360 px layout stacks globe above panel | headless screenshot at 360 px | demo-verified |
| 24 | Keyboard-only journey, visible focus | headless Edge: Tab/Enter/arrows from intro to decision; focus moves to the record | real-verified |
| 25 | Reduced motion: question visible immediately, no fly animation | `prefers-reduced-motion: reduce` emulation | real-verified |
| 26 | Real corpus: 243 planned, valid count reported, Pinacate sea windows rejected | 11 SW-corner windows rejected by water guard; manifests list reasons | real-verified |
| 27 | Real corpus: `data_ready=true`, `demo_mode=false`, DEMO banner absent | `/api/health` + UI | real-verified |

## Open items

- #13 live chat check (needs `OPENAI_API_KEY` in `backend/.env`).
- Person 1 to confirm the freeze note in `data/config/regions.json` (frozen at team request in Person 3's
  session after coverage review only; no centre moved).
- Death Valley tile N36W117 minimum -130 m: noted as possible SRTM artifact, not adjusted.

## Honesty review before demo/submission

- [x] No wording says "match probability", "% of Mars", "global best", "first discovery", "NASA approved", "safe route".
- [x] Scope sentence visible: 3 parents, valid/planned windows, 1000 m grid, limited corpus.
- [x] Missing dimensions visible in the Decision Brief.
- [x] DEMO banner appears whenever demo data is on screen (absent on real corpus).
- [ ] Final check of the submission text against `docs/SUBMISSION.md` before sending.
