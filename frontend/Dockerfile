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
# relative imports resolve during the build. Glob (not an explicit list) so newly
# added root docs (ABOUT.md etc.) never break the build.
COPY *.md /app/
RUN npm run build

# MapLibre v6 loads its render worker from /assets/maplibre-gl-worker.mjs at
# runtime, choosing the filename dynamically, so rollup never emits it into dist —
# and the worker in turn imports ./maplibre-gl-shared.mjs (one more runtime chunk).
# Missing either file = the worker dies silently = blank map. Ship the full set
# (worker + shared, prod and dev variants) next to the hashed assets.
RUN cp node_modules/maplibre-gl/dist/maplibre-gl-worker*.mjs \
       node_modules/maplibre-gl/dist/maplibre-gl-shared*.mjs \
       dist/assets/

FROM caddy:2-alpine
COPY --from=build /app/frontend/dist /srv
COPY frontend/Caddyfile /etc/caddy/Caddyfile
