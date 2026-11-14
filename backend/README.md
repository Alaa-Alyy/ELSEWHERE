# ELSEWHERE backend (Person 2) - FastAPI v2.0

Serves the shared v2.0 contract over Person 1's `analysis.search` engine. The backend has **no score
formula of its own**: rankings, distances, evidence and tradeoffs all come from `SearchEngine`.

## Setup (Windows PowerShell, repository root)

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r analysis\requirements.txt -r backend\requirements.txt
copy backend\.env.example backend\.env      # then edit; .env is gitignored
```
macOS/Linux: `python3.12 -m venv .venv && source .venv/bin/activate && pip install -r analysis/requirements.txt -r backend/requirements.txt`

## Run

```powershell
# demo corpus from Person 1 (data/processed/demo, is_demo=true -> DEMO banner in the UI)
$env:DEMO_FIXTURES='true'; .venv\Scripts\python -m uvicorn backend.main:app --reload --port 8000

# real corpus (data/processed); never falls back to fixtures
$env:DEMO_FIXTURES='false'; .venv\Scripts\python -m uvicorn backend.main:app --reload --port 8000
```

Smoke test: http://127.0.0.1:8000/api/health, `/api/references`,
`/api/rankings?reference_id=mars-jezero&profile=terrain_general`.

Frontend against this API: create `frontend/.env.development.local` containing `VITE_USE_FIXTURES=false`
and run `npm run dev` in `frontend/`.

## Modes and readiness

| | `DEMO_FIXTURES=true` | `DEMO_FIXTURES=false` |
|---|---|---|
| corpus | `data/processed/demo/` | `data/processed/` |
| `data_ready` | always `false` | `true` only when 3 parents + candidates + valid references load with no problems |
| is_demo records | served, labeled | refused (dropped and reported in `/api/health` `problems`) |
| missing corpus | - | rankings/decision/chat -> 503 `data_unavailable`; references/sources still served |

## Environment

`OPENAI_API_KEY` (server only), `OPENAI_MODEL` (default `gpt-4.1-mini`), `DATA_DIR`, `SOURCES_DIR`,
`ALLOWED_ORIGINS`, `CHAT_TIMEOUT_SECONDS` (25), `CHAT_RATE_LIMIT_PER_MINUTE` (20), `DEMO_FIXTURES`.
Without a key, `chat_available=false` and `/api/chat` returns a readable 503; search and decision keep working.

## Endpoints

`GET /api/health`, `/api/references`, `/api/parents`, `/api/sources`, `/api/candidates/{id}`,
`/api/rankings?reference_id&profile&slope_weight&top_k`, `POST /api/decision`, `POST /api/chat`,
static `/assets/previews/*.png` (approved folder only).
Errors always use `{"error":{"code","message","retryable"}}`: 404 unknown ID, 422 invalid input
(including unknown fields such as client scores), 429 chat rate limit, 503 data/chat unavailable.

Examples generated from the running API: `contracts/examples/`. JSON Schema: `contracts/schema-v2.json`.

## Decision snapshot

`decision_id = sha256(canonical JSON of the record without generated_at_utc)`. The server recomputes the
current distinct results and only accepts a selection/alternative that is among them (rank 2 or 3 is fine).
`proposed_test` is a reviewed template per profile and is always marked as proposed, not executed.

## Tests

```powershell
.venv\Scripts\python -m pytest tests\analysis tests\backend -q
```
Chat tests use a fake upstream client; no network or key needed.
