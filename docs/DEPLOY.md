# Deploy ELSEWHERE on Hugging Face Spaces (free)

One container serves the website **and** the API at `https://<your-username>-elsewhere.hf.space`.
The Space holds only two files (`deploy/huggingface/Dockerfile` and `deploy/huggingface/README.md`);
at build time it clones this GitHub repo (**branch `main`**), builds the site and downloads NASA data.

## 0. Before you start

- Merge the `deploy-hf` pull request into `main` (the Space builds from `main`).
- The GitHub repo must stay **public**.
- Never put keys in Git or in the Dockerfile. They go in the Space's **secrets** only.

## 1. Account and Space

1. Create a free account at https://huggingface.co/join and confirm your e-mail.
2. Open https://huggingface.co/new-space
   - **Space name:** `elsewhere`
   - **SDK:** Docker → **Blank**
   - **Hardware:** CPU basic (free)
   - **Visibility:** Public
   - Click **Create Space**.

## 2. Secrets (Space → Settings → Variables and secrets → New secret)

| Name | Value | Needed for |
|---|---|---|
| `GEMINI_API_KEY` | your Google AI Studio key (the one in your local `backend/.env`) | chat explanations (optional) |
| `EARTHDATA_TOKEN` | a fresh token from https://urs.earthdata.nasa.gov → *Generate Token* (tokens expire after ~60 days) | Earth side of the 3D terrain view (optional) |

Without them the site still works: chat shows "unavailable" and the Earth 3D view says "unavailable".
Anyone using the public site spends your Gemini quota; that is normal for a demo.

## 3. Upload the two files (no git needed)

Space page → **Files** → **Add file → Upload files** → drag in
`deploy/huggingface/Dockerfile` and `deploy/huggingface/README.md` (replace the default README) →
**Commit changes to main**.

## 4. Wait for the build (~15 min the first time)

The Space shows **Building** (see the *Logs* tab), then **Running**. Then check:

- `https://<username>-elsewhere.hf.space` - the space hub with the astronaut opens, **no DEMO banner**.
- `https://<username>-elsewhere.hf.space/api/health` - `"data_ready": true`, `"discovery_ready": true`,
  `"global_windows": 1143707` (and `"chat_available": true` if you set the Gemini key).

## 5. Updating after new changes

Merge to `main` on GitHub, then in the Space: **Settings → Factory rebuild** (it clones `main` again).

## 6. On judging day

- Free Spaces **sleep** after a period without visitors; the first visit then takes about a minute.
  Open the link 5-10 minutes before the judges do.
- Mars pins and the lunar south pole read NASA servers live. Pin your demo places (e.g. Jezero) once
  before the demo so they are cached in the running Space.
- Put the link in the submission form and test it from another device / a private window.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails at `earth-global` | `EARTHDATA_TOKEN` expired or wrong: generate a new one, update the secret, Factory rebuild |
| Build fails at `moon-global` | NASA PDS was slow: Factory rebuild |
| "Could not measure this pin" | NASA server temporarily unreachable: retry; Moon sites outside the south pole work offline |
| Chat unavailable | `GEMINI_API_KEY` missing or quota reached |
