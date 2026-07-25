-- ============================================================================
-- Canary — Supabase schema  (THE MAILBOX / the moat)
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run.
-- Idempotent (create if not exists / or replace) — safe to re-run.
--
-- Architecture note: the READ side (permits, crime, trajectories) is served by
-- FastAPI + canary.duckdb — it does NOT live here. Supabase's only job is user
-- data: the give-to-get contributions that build the resident layer no one else
-- can license. Raw individual contributions NEVER leave Supabase; only
-- k-anonymised aggregates (views below) are served back out.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- contributions — a resident's review of a neighborhood they know (leaving or
-- living there — asked in the form, not assumed). Low-friction: no login
-- required, identity captured when present.
-- ---------------------------------------------------------------------------
create table if not exists contributions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid references auth.users (id) on delete set null,  -- null = anonymous
  session_id    text,                    -- client-generated; dedupes anon submissions

  -- WHERE it's about — H3 spine (attached server-side from the area picker).
  h3_9          text,
  lat           double precision,
  lon           double precision,
  place_label   text,                    -- the picked area name, e.g. "Hayes Valley"

  -- WHAT they said — structured stays queryable, free text optional.
  moving_out    boolean,                 -- true = reviewing the place they're leaving
  ratings       jsonb not null default '{}'::jsonb,  -- {safety:4, noise:2, trajectory:5}
  answers       jsonb,                   -- give-to-get gate answers (exit interview,
                                         -- block knowledge, directional calibration)
  comment       text,

  -- provenance discipline mirrors the pipeline (two-date rule).
  source_as_of  date not null default current_date
);
create index if not exists contributions_h3 on contributions (h3_9);
create index if not exists contributions_user on contributions (user_id);

-- Optional richer profile beyond auth.users (for when accounts land).
create table if not exists profiles (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  display_name  text,
  home_h3_9     text                     -- the area they can speak to
);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY — the privacy guarantee is enforced here, not in app code.
-- ---------------------------------------------------------------------------
alter table contributions enable row level security;
alter table profiles      enable row level security;

-- Anyone may INSERT a contribution (give-to-get is deliberately low-friction)…
drop policy if exists "contributions insert any" on contributions;
create policy "contributions insert any" on contributions
  for insert with check (true);
-- …but NO select policy ⇒ neither anon nor logged-in users can read raw
-- contributions back. Only the k-anonymised views below are readable.

-- Profiles: a signed-in user manages only their own row.
drop policy if exists "profiles self read" on profiles;
create policy "profiles self read" on profiles
  for select using (auth.uid() = user_id);
drop policy if exists "profiles self upsert" on profiles;
create policy "profiles self upsert" on profiles
  for insert with check (auth.uid() = user_id);
drop policy if exists "profiles self update" on profiles;
create policy "profiles self update" on profiles
  for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- The resident layer — the ONLY readable shape of contributions. k-anonymity
-- (n ≥ 3) so no area's numbers can identify an individual contributor.
-- Served to the frontend via GET /api/resident-layer (backend reads these).
-- ---------------------------------------------------------------------------
-- Per-hex (~350m) — precise, but k ≥ 3 per hex takes real volume to reach.
create or replace view resident_layer_agg as
  select h3_9,
         count(*)                               as n_reviews,
         avg((ratings->>'safety')::numeric)     as avg_safety,
         avg((ratings->>'noise')::numeric)      as avg_noise,
         avg((ratings->>'trajectory')::numeric) as avg_trajectory
  from contributions
  where h3_9 is not null
  group by h3_9
  having count(*) >= 3;

-- Per-area — place_label is the picked name from the map's real 41-area list,
-- so k ≥ 3 is reached far sooner. This is what the resident layer renders from
-- early on; the hex view takes over as volume grows.
create or replace view resident_layer_by_area as
  select place_label,
         count(*)                               as n_reviews,
         avg((ratings->>'safety')::numeric)     as avg_safety,
         avg((ratings->>'noise')::numeric)      as avg_noise,
         avg((ratings->>'trajectory')::numeric) as avg_trajectory
  from contributions
  where place_label is not null
  group by place_label
  having count(*) >= 3;
