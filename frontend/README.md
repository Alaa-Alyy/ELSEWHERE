# MissionMatch frontend (Person 3)

React + Vite + CesiumJS. Story-led journey: Intro -> Mission -> Candidates -> Tradeoffs -> Decision.

## Run

```bash
cd frontend
npm ci
npm run dev            # http://127.0.0.1:5173  (demo fixtures by default, see .env.development)
npm test               # tests in ../tests/frontend
npm run build          # real-API production build (no fixtures)
npm run check:bundle   # fails if fixtures or secrets ended up in dist/
npm run preview        # http://127.0.0.1:4173
npm run build:demo     # production build that uses the labeled demo fixtures
```

Deep link `#explore` opens the map directly (same as "Skip intro").

## Fixtures vs real backend

One switch, no code changes:

| Variable | Meaning |
|---|---|
| `VITE_USE_FIXTURES` | `true` = labeled demo fixtures (`src/api/mockClient.js`, DEMO banner); `false` = real API |
| `VITE_API_BASE_URL` | Backend URL (default `http://localhost:8000`) |
| `VITE_API_TIMEOUT_MS` | Request timeout (default 15000) |

To use Person 2's backend locally create `frontend/.env.development.local` with `VITE_USE_FIXTURES=false`.
Backend CORS must allow `http://127.0.0.1:5173`, `http://localhost:5173` and the preview origin `http://127.0.0.1:4173`.

Only `VITE_` variables reach the browser. `OPENAI_API_KEY` never belongs here.

## Rules this UI follows

- No client-side scoring: rankings, distances, scores and decisions come from the API.
  The UI only multiplies server weight x server distance to *display* contributions.
- Sends IDs/settings only (`/api/decision`, `/api/chat`).
- Stale responses are ignored (`requestSequence`); changing reference/profile/weight
  clears the decision and chat; a vanished selection is cleared with a notice.
- Globe: one Cesium Viewer, entity id = `candidate_id`, Earth windows only, NASA GIBS imagery (no token).
- Moon/Mars references are 2D only and never drawn on Earth.

## Files

```
src/App.jsx                 state wiring + API calls
src/state.js                reducer (invalidation, stale-response guard)
src/api/client.js           single adapter (base URL, timeout, abort, error envelope)
src/api/mockClient.js       DEMO mock server (fixture mode only)
src/api/fixtures.js         DEMO data shaped like the v2 contract (is_demo=true)
src/components/*.jsx        Intro, MissionControls, EarthGlobe, CandidateList,
                            EvidencePanel, TradeoffPanel, DecisionBrief, ChatPanel
```
