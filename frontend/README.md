# MissionMatch frontend (Person 3)

React + Vite + CesiumJS + three.js. Cinematic, story-led journey:

| Scene | What happens | Real data behind it |
|---|---|---|
| 1 Space hub | cartoon astronaut floats; Earth and Mars orbit him, the Moon orbits Earth (NASA textures, not to scale) | none (decorative) |
| 1b Destination | click the Moon or Mars (or the cards); the astronaut jumps onto it | sets `body` (same action as the radio) |
| 2a Experiment question | "What experiment will you run?" - rover, landing, base camp, geology | chooses the existing profile only (`slope_focus` / `terrain_general`) |
| 2 Mission | 3D Moon/Mars globe (Trek imagery); pin anywhere; "scanning" HUD; the astronaut drops on the pin | `POST /api/pins`, fingerprint shown before any search |
| Travel | warp back to Earth (skippable, ~3.6 s) while the search runs | `GET /api/discover` or `/api/rankings` |
| 3 Candidates | the astronaut falls onto #1 on the Cesium Earth globe and hops to any other card you pick; cards show index ring, per-metric closeness, closest metric / biggest gap, known-analog label | API distances and reason codes |
| Site dossier | click a card (or "Open site dossier"): wide tabbed view over the globe - Overview (real image pair + 3D terrain blocks + summary), Similar / Different, Research, Measurements & sources; Esc or "View on globe" closes | same data as the cards + `/api/climate`, `/api/terrain-grid`, NASA GIBS / Trek imagery |
| 4 Tradeoffs / 5 Decision | unchanged logic; "Plan another mission" returns to the hub | `/api/decision`, `/api/chat` |

Sound is **off by default** (toggle + volume in the top bar, remembered locally). Reduced-motion users get no
cut-scenes. Everything works without WebGL audio or animation.

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
Planet textures: `python scripts/fetch_textures.py` (already committed in `public/textures/`).

## Fixtures vs real backend

| Variable | Meaning |
|---|---|
| `VITE_USE_FIXTURES` | `true` = labeled demo fixtures (`src/api/mockClient.js`, DEMO banner); `false` = real API |
| `VITE_API_BASE_URL` | Backend URL (default `http://localhost:8000`) |
| `VITE_API_TIMEOUT_MS` | Request timeout (default 15000) |

To use Person 2's backend locally create `frontend/.env.development.local` with `VITE_USE_FIXTURES=false`.
Backend CORS must allow `http://127.0.0.1:5173`, `http://localhost:5173` and the preview origin `http://127.0.0.1:4173`.
Only `VITE_` variables reach the browser. No API key ever belongs here.

## Rules this UI follows

- No client-side scoring: rankings, distances, scores and decisions come from the API. The UI only shows
  `100 x (1 - server distance)` per metric and `server weight x server distance` contributions.
- The experiment question, cut-scenes, astronaut and sounds are presentation only; they never change what is
  sent to the API beyond the existing profile choice. `#1` is pre-selected once per search (any card can be chosen).
- Sends IDs/settings only (`/api/decision`, `/api/chat`). Stale responses are ignored (sequence numbers);
  "New mission" resets state and ignores in-flight responses.
- Earth globe: entity id = `candidate_id`, Earth windows only. Moon/Mars are drawn on their own spheres, never on Earth.

## Files

```
src/App.jsx                    state wiring + API calls + scene orchestration
src/state.js                   reducer (invalidation, stale-response guard, NEW_MISSION)
src/sound.js                   sound manager (off by default) + UI sound hook
src/scene/astronaut.js         cartoon astronaut from three.js primitives (+ sprite for Cesium)
src/components/Hub.jsx         scenes 1-1b (title, destination choice)
src/components/SpaceScene.jsx  three.js orbit scene + jump animation
src/components/ExperimentPicker.jsx, TravelOverlay.jsx, SoundToggle.jsx
src/components/PlanetGlobe.jsx, EarthGlobe.jsx (Cesium), MissionControls, CandidateList,
                               EvidencePanel, TradeoffPanel, DecisionBrief, ChatPanel
public/audio/                  CC0 sounds (CREDITS.md)   public/textures/  NASA planet textures
```
