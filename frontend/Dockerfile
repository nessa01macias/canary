# Canary web — build the Vite/React static bundle, then serve it with Caddy.
# Caddy also reverse-proxies /api to the FastAPI container (see Caddyfile).
FROM node:22-slim AS build

WORKDIR /app

# VITE_* vars are inlined into the bundle at BUILD time. VITE_MAPTILER_KEY is a
# client-side key (referrer-restricted), so baking it into the JS is expected.
ARG VITE_MAPTILER_KEY
ENV VITE_MAPTILER_KEY=$VITE_MAPTILER_KEY
# Note: no Supabase keys here. The frontend never talks to a database — it calls
# our backend /api/*, which is the only thing holding DB credentials.

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
