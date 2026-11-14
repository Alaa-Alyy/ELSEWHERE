# syntax=docker/dockerfile:1.6
# ELSEWHERE on Hugging Face Spaces (Docker SDK): one container serves the website and the API on port 7860.
# The Space repo only needs this Dockerfile + README.md; the code is cloned from the public GitHub repo.
# Secrets (Space settings -> Variables and secrets):
#   GEMINI_API_KEY   runtime, optional (chat explanations)
#   EARTHDATA_TOKEN  build time, optional (SRTMGL30 tiles for the Earth 3D terrain view)

ARG ELSEWHERE_REPO=https://github.com/Alaa-Alyy/ELSEWHERE.git
ARG ELSEWHERE_REF=main

# ---------- 1) source
FROM alpine/git:latest AS src
ARG ELSEWHERE_REPO
ARG ELSEWHERE_REF
RUN git clone --depth 1 --branch "${ELSEWHERE_REF}" "${ELSEWHERE_REPO}" /src && rm -rf /src/.git

# ---------- 2) website (real API, same origin, no demo fixtures)
FROM node:20-slim AS web
COPY --from=src /src/frontend /src/frontend
COPY --from=src /src/tests /src/tests
WORKDIR /src/frontend
RUN npm ci --no-audit --no-fund \
 && VITE_USE_FIXTURES=false VITE_API_BASE_URL=same-origin npm run build \
 && npm run check:bundle

# ---------- 3) API + data
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* && useradd -m -u 1000 user
WORKDIR /app
COPY --from=src /src /app
RUN rm -rf /app/frontend /app/tests/frontend \
 && pip install --no-cache-dir -r analysis/requirements.txt -r backend/requirements.txt

# NASA elevation data that is not stored in Git.
# Moon LOLA LDEM_64 (531 MB, no login): Moon pins outside the south polar cap.
RUN python scripts/fetch_data.py moon-global
# Earth SRTMGL30 (267 MB, Earthdata token): Earth side of the 3D terrain view. Skipped without the secret.
RUN --mount=type=secret,id=EARTHDATA_TOKEN,mode=0444,required=false \
    if [ -s /run/secrets/EARTHDATA_TOKEN ]; then \
      EARTHDATA_TOKEN="$(cat /run/secrets/EARTHDATA_TOKEN)" python scripts/fetch_data.py earth-global \
      && python -c "from discovery.sources import extract_srtmgl30; extract_srtmgl30()" \
      && rm -f data/raw/earth/global/*.zip; \
    else echo "EARTHDATA_TOKEN not set: Earth 3D terrain view will report 'unavailable'"; fi

COPY --from=web /src/frontend/dist /app/site
RUN chown -R user:user /app
USER user

ENV DEMO_FIXTURES=false \
    FRONTEND_DIST=/app/site \
    LLM_PROVIDER=gemini \
    PYTHONUNBUFFERED=1 \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    GDAL_HTTP_TIMEOUT=60
EXPOSE 7860
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
