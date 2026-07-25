# Canary web — build the Vite/React static bundle, then serve it with Caddy.
# Caddy also reverse-proxies /api to the FastAPI container (see Caddyfile).
#
# NOTE: build context is the REPO ROOT (see docker-compose.yml), not ./frontend.
# The Docs page imports repo-root markdown (../../RESEARCH.md etc. relative to
# frontend/src), so those files must be reachable one level above the frontend dir
# at build time. Context=root + the COPY below puts them exactly where Vite resolves
# them (/app/frontend/src/../../ -> /app).
FROM node:22-slim AS build

WORKDIR /app/frontend

# VITE_* vars are inlined into the bundle at BUILD time. VITE_MAPTILER_KEY is a
# client-side key (referrer-restricted), so baking it into the JS is expected.
ARG VITE_MAPTILER_KEY
ENV VITE_MAPTILER_KEY=$VITE_MAPTILER_KEY
# No Supabase keys here — the frontend never talks to a database; it calls /api/*.

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# Repo-root docs the Docs page imports via ../../*.md — placed at /app so the
# relative import resolves during the build.
COPY RESEARCH.md BENCHMARK.md VALIDATION.md DATA_SOURCES.md /app/
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/frontend/dist /srv
COPY frontend/Caddyfile /etc/caddy/Caddyfile
