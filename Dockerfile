# ELSEWHERE - one container: the website + the API, on $PORT (set by Railway / Render; 10000 if unset).
# Build context = this repository. Secrets are never baked in:
#   GEMINI_API_KEY   runtime environment variable (optional, chat)
#   EARTHDATA_TOKEN  runtime environment variable (optional, Earth side of the 3D view; tiles fetched on demand)

# ---------- 1) website (real API on the same origin, no demo fixtures)
FROM node:24-slim AS web
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend frontend
COPY tests/frontend tests/frontend
RUN cd frontend && VITE_USE_FIXTURES=false VITE_API_BASE_URL=same-origin npm run build && npm run check:bundle

# ---------- 2) API + NASA data
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* && useradd -m -u 1000 user
WORKDIR /app
COPY analysis/requirements.txt analysis/requirements.txt
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r analysis/requirements.txt -r backend/requirements.txt
COPY analysis analysis
COPY backend backend
COPY discovery discovery
COPY scripts scripts
COPY contracts contracts
COPY data/processed data/processed
COPY data/sources data/sources
COPY data/config data/config

# Moon LOLA LDEM_64 (531 MB, no login): Moon pins outside the south polar cap.
RUN python scripts/fetch_data.py moon-global
# Earth SRTMGL30 tiles need an Earthdata login token, which must never go into a Docker build (Railway
# rejects ARG/secret mounts: rule SecretsUsedInArgOrEnv). Instead the RUNNING server downloads only the
# tile a 3D view needs, once, using the EARTHDATA_TOKEN runtime variable (discovery/sources.py).
RUN mkdir -p data/raw/earth/global/dem

COPY --from=web /src/frontend/dist /app/site
RUN chown -R user:user /app
USER user
ENV DEMO_FIXTURES=false \
    FRONTEND_DIST=/app/site \
    LLM_PROVIDER=gemini \
    PYTHONUNBUFFERED=1 \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    GDAL_HTTP_TIMEOUT=60
EXPOSE 10000
CMD ["sh", "-c", "exec python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
