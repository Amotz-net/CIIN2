-- =====================================================================
-- Regional picture: daily copies of SATsum's published figures.
--
-- CIIN shows the Caribbean-wide picture from SATsum (CONABIO, Mexico),
-- licensed CC BY 4.0. SATsum's files are not a documented service and could
-- move without notice, so each day's copy is stored here: if their site is
-- down or changes, CIIN shows the last copy with its date instead of a blank.
-- One row per (kind, as_of). Written only by the regional function.
-- =====================================================================
create table regional_snapshots (
  kind       text not null,          -- 'eez' | 'series' | 'forecast' | 'thresholds'
  as_of      date not null,          -- the date the figures describe
  payload    jsonb not null,
  source     text not null default 'SATsum / SIMAR, CONABIO (CC BY 4.0)',
  fetched_at timestamptz not null default now(),
  primary key (kind, as_of)
);
alter table regional_snapshots enable row level security;
create policy regional_read on regional_snapshots for select using (auth.uid() is not null);
