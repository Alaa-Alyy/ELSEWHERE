# Deploy ELSEWHERE on Render (free)

One container serves the website **and** the API at `https://<name>.onrender.com`, built from the
`Dockerfile` in the repository root. (Hugging Face Docker Spaces became a paid feature, so we use Render;
the old Space files remain in `deploy/huggingface/`.)

Render free web services: 750 free hours per month, **spin down after 15 minutes without visitors** and
take about a minute to wake up; the filesystem is ephemeral (fine: all data is inside the image).
Our service uses about 300 MB of memory, about 350 MB at the peak of a search.

## 0. Before you start

- Merge the `render-deploy` pull request into `main` (Render builds `main`).
- Never put keys in Git or in the Dockerfile. They go in Render's environment settings only.

## 1. Create the service

1. Go to https://render.com → **Get Started** → sign up **with GitHub**.
2. Dashboard → **New** → **Web Service** → choose the repository **Alaa-Alyy/ELSEWHERE**
   (or paste the public URL https://github.com/Alaa-Alyy/ELSEWHERE).
3. Settings:
   - **Name:** `elsewhere` (the link becomes `https://elsewhere-....onrender.com`)
   - **Branch:** `main`
   - **Language / Runtime:** **Docker** (Dockerfile path `./Dockerfile`)
   - **Region:** Frankfurt (closest to Egypt)
   - **Instance type:** **Free**
4. **Environment variables** → Add:
   - `GEMINI_API_KEY` = your Google AI Studio key (the one in your local `backend/.env`) - optional, chat.
5. **Secret files** (Advanced) → Add secret file:
   - Filename `EARTHDATA_TOKEN`, contents = a fresh token from https://urs.earthdata.nasa.gov →
     *Generate Token* - optional, Earth side of the 3D terrain view. Tokens expire after ~60 days.
6. **Health check path** (Advanced): `/api/health`
7. **Create Web Service**. The first build takes about 10-20 minutes (it downloads 0.5-0.8 GB of NASA data).

## 2. Check it

- `https://<name>.onrender.com` - the space hub with the astronaut, **no DEMO banner**.
- `https://<name>.onrender.com/api/health` - `"data_ready": true`, `"discovery_ready": true`,
  `"global_windows": 1143707`, `"chat_available": true` (if the Gemini key is set).

## 3. Updates

Render redeploys automatically on every push/merge to `main` (Auto-Deploy on by default).

## 4. On judging day

- Open the link 5-10 minutes before the judges (free services sleep after 15 minutes).
- Mars pins and the lunar south pole read NASA servers live; pin your demo places (e.g. Jezero) once
  beforehand so they are cached in the running service.
- Put the link in the submission and test it from another device or a private window.

## Troubleshooting (Logs tab)

| Symptom | Fix |
|---|---|
| Build fails at `earth-global` | Earthdata token expired/wrong: update the secret file, *Manual Deploy → Clear build cache & deploy* |
| Build fails at `moon-global` | NASA PDS was slow: *Manual Deploy* again |
| "Out of memory" / restarts | Free instance too small: tell the team; the paid Starter instance fixes it |
| "Could not measure this pin" | NASA server temporarily unreachable: retry; Moon sites outside the south pole work offline |
| Chat unavailable | `GEMINI_API_KEY` missing or quota reached |
