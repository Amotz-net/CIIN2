-- =====================================================================
-- Per-beach alert baselines.
--
-- CIIN graded inundation risk against two fixed AFAI thresholds that were
-- published for one product (the 7-day field). This replaces them with a
-- five-level scale cut from EACH BEACH'S OWN HISTORY: the 75th, 90th, 95th and
-- 99th percentiles of biomass density in its approach zone (20 to 40 km offshore), the method
-- SATsum (CONABIO) uses per zone.
--
-- Consequence, stated on every screen that shows a level: levels are relative
-- to that beach's own record and are NOT comparable between beaches. "High" at
-- a beach that rarely sees sargassum is less biomass than "High" at one that
-- often does.
-- =====================================================================
create table segment_baselines (
  segment_id   uuid not null references beach_segments (id) on delete cascade,
  afai_window  text not null check (afai_window in ('1D', '3D', '7D')),
  p75          numeric not null,      -- t/km2 in the approach zone
  p90          numeric not null,
  p95          numeric not null,
  p99          numeric not null,
  sample_n     int not null,          -- slices with a clear read
  gap_n        int not null,          -- slices with no clear read (cloud, glint)
  history_from timestamptz not null,
  history_to   timestamptz not null,
  computed_at  timestamptz not null default now(),
  primary key (segment_id, afai_window)
);

alter table segment_baselines enable row level security;

-- A baseline is visible to whoever may see the segment it describes. Written
-- only by the baseline function (service role).
create policy baseline_select on segment_baselines for select
  using (exists (select 1 from beach_segments s where s.id = segment_baselines.segment_id));
