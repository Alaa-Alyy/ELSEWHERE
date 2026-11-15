# Deploy ELSEWHERE (one container: website + API)

The root `Dockerfile` builds everything; the service listens on `$PORT`. Keys never go in Git or the
Dockerfile - only in the host's variables. Our service uses ~300 MB of memory (~350 MB at a search peak).

## Railway (free trial, no card) - what we use

Railway's free trial: $5 credit for 30 days, **no credit card**, up to 1 GB memory per service.
After 30 days (or when the credit is spent) the free plan is much smaller and the service will likely stop.
Unverified trial accounts have restricted outbound network: **verify the account with GitHub**, otherwise
the server cannot read NASA data (Mars pins, climate).

1. Go to https://railway.com → **Login with GitHub**. Accept the trial; complete the GitHub verification
   if Railway asks (needed for outbound internet).
2. **New Project** → **Deploy from GitHub repo** → choose **Alaa-Alyy/ELSEWHERE** (branch `main`).
   Railway finds `railway.json` + `Dockerfile` by itself (Docker build, health check `/api/health`).
3. Open the service → **Variables** → **New Variable**:
   - `GEMINI_API_KEY` = your Google AI Studio key - optional (chat). Use a fresh key, never a key that was
     ever pasted in a chat.
   - (No Earthdata token: Railway rejects secrets in Docker builds, so online the Earth side of the 3D
     terrain view says "unavailable". Everything else works; the full 3D works locally.)
4. **Settings → Networking → Generate Domain** → you get `https://<something>.up.railway.app`.
5. Wait for the deploy to finish (**Deployments** tab; first build ~10-20 min).
6. Check `https://<domain>/api/health` → `"data_ready": true`, `"discovery_ready": true`,
   `"global_windows": 1143707`; then open `https://<domain>` (space hub, no DEMO banner).

Updates: every push/merge to `main` redeploys automatically.

## Render (needs a card on file) - alternative

New → Web Service → repo `Alaa-Alyy/ELSEWHERE`, branch `main`, Language **Docker**, Dockerfile `./Dockerfile`,
Instance **Free**, Health check `/api/health`, env var `GEMINI_API_KEY`, optional secret file `EARTHDATA_TOKEN`.
Free services sleep after 15 minutes without visitors (~1 minute to wake).

## On judging day

- Open the link a few minutes before the judges.
- Mars pins and the lunar south pole read NASA servers live: pin your demo places (e.g. Jezero) once
  beforehand so they are cached in the running service.
- Test the link from another device or a private window.

## Troubleshooting (deploy logs)

| Symptom | Fix |
|---|---|
| "The Dockerfile failed validation" | Railway runs Docker build checks: no secrets in ARG/ENV or secret mounts (`docker build --check .` locally) |
| Build fails at `moon-global` | NASA PDS was slow: redeploy |
| "Could not measure this pin" / climate unavailable | outbound network blocked (verify the Railway account) or NASA temporarily down |
| Out of memory / restarts | instance too small: needs ≥ 512 MB |
| Chat unavailable | `GEMINI_API_KEY` missing, wrong or out of quota |
