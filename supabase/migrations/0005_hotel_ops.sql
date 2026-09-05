-- =====================================================================
-- CIIN — Stage 2 (0005): Hotel operational data layer
-- Every table carries org_id and is RLS-scoped (operational = all org members).
-- Sargassum arrival/forecast VALUES are seeded-and-labelled (source column),
-- not a live feed. NOAA weather is fetched live client-side, not stored here.
-- =====================================================================

-- Data-source label so the UI can honestly show live vs representative.
create type data_source as enum ('representative', 'live_feed', 'manual', 'engine');

-- ---------- beach segments a hotel manages ----------
create table beach_segments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id) on delete cascade,
  name        text not null,
  lat         double precision,
  lng         double precision,
  length_m    integer,
  created_at  timestamptz not null default now()
);

-- ---------- sargassum arrivals / forecast for a segment ----------
-- eta_at = expected landfall; tonnes = estimated mass; source labels provenance.
create table sargassum_arrivals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations (id) on delete cascade,
  segment_id    uuid references beach_segments (id) on delete set null,
  tonnes        numeric(10,1),
  eta_at        timestamptz,
  severity      text check (severity in ('low','medium','high')),
  source        data_source not null default 'representative',
  created_at    timestamptz not null default now()
);

-- ---------- missions raised against the property ----------
create table missions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations (id) on delete cascade,
  segment_id    uuid references beach_segments (id) on delete set null,
  title         text not null,
  tonnes        numeric(10,1),
  status        text not null default 'proposed'
                check (status in ('proposed','authority_approved','access_granted','in_progress','completed','rejected')),
  eta_at        timestamptz,
  access_state  text default 'pending'
                check (access_state in ('pending','granted','granted_conditions','declined')),
  source        data_source not null default 'representative',
  created_at    timestamptz not null default now()
);

-- ---------- hubs participating in a mission (the pool) ----------
create table mission_hubs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations (id) on delete cascade,
  mission_id   uuid not null references missions (id) on delete cascade,
  hub_name     text not null,
  share_tonnes numeric(10,1),
  distance_km  numeric(6,1),
  accepted     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ---------- grade + closure summary per completed load ----------
create table load_summaries (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations (id) on delete cascade,
  mission_id    uuid references missions (id) on delete set null,
  grade         text check (grade in ('A','B','C','FAIL')),
  closure_pct   numeric(5,1),          -- closure error %
  closure_state text check (closure_state in ('conforming','conditional','non_conforming')),
  recovered_t   numeric(10,1),
  avoided_cost  numeric(12,2),
  source        data_source not null default 'representative',
  created_at    timestamptz not null default now()
);

create index beach_segments_org_idx     on beach_segments (org_id);
create index sargassum_arrivals_org_idx on sargassum_arrivals (org_id);
create index missions_org_idx           on missions (org_id);
create index mission_hubs_org_idx       on mission_hubs (org_id);
create index load_summaries_org_idx     on load_summaries (org_id);
