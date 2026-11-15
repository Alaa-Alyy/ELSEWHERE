# syntax=docker/dockerfile:1.6
# ELSEWHERE - one container: the website + the API, on $PORT (Render: 10000 by default).
# Build context = this repository. Secrets are never baked in:
#   GEMINI_API_KEY   runtime environment variable (optional, chat)
#   EARTHDATA_TOKEN  build-time SECRET FILE named EARTHDATA_TOKEN (optional, Earth side of the 3D view)

# ---------- 1) website (real API on the same origin, no demo fixtures)
FROM node:20-slim AS web
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
# Earth SRTMGL30 (267 MB, Earthdata token as a build secret file): Earth side of the 3D terrain view.
RUN --mount=type=secret,id=EARTHDATA_TOKEN,mode=0444,required=false \
    if [ -s /run/secrets/EARTHDATA_TOKEN ]; then \
      EARTHDATA_TOKEN="$(cat /run/secrets/EARTHDATA_TOKEN)" python scripts/fetch_data.py earth-global \
      && python -c "from discovery.sources import extract_srtmgl30; extract_srtmgl30()" \
      && rm -f data/raw/earth/global/*.zip; \
    else echo "No EARTHDATA_TOKEN secret: the Earth 3D terrain view will say 'unavailable'"; fi

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
