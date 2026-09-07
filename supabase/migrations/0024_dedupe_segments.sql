-- =====================================================================
-- Remove the duplicate coast segment, and label the tonnage estimate.
--
-- "North cove" existed as TWO beach_segments rows — same org, same name, same
-- coordinates, different ids. Harmless while it was only inflating a count.
-- Once the watcher went live it stopped being harmless: the idempotency guard
-- checks for an open mission per segment_id, so each row got its own mission
-- and the same physical cove was dispatched twice, committing 27 t of NEG01's
-- capacity to work already in hand (90 -> 30 -> 3 t spare).
--
-- Keeps the earliest row per (org_id, name, lat, lng) and removes the rest,
-- along with the missions and proposals raised against them. Written
-- generically rather than against one id, so it also catches any sibling
-- duplicate and is safe to re-run.
-- =====================================================================

-- Identify duplicates: same org, name and position; keep the earliest.
create temporary table _dup_segments on commit drop as
select id from (
  select id, row_number() over (
    partition by org_id, name, lat, lng order by created_at, id
  ) as rn
  from beach_segments
) d where rn > 1;

-- Order matters. missions.segment_id is ON DELETE SET NULL, so deleting the
-- segment first would orphan its missions rather than remove them, and
-- agent_proposals would be left describing a decision about nothing.
delete from agent_proposals
 where segment_id in (select id from _dup_segments)
    or mission_id in (select id from missions where segment_id in (select id from _dup_segments));

-- mission_hubs cascades from missions, so the hub's committed tonnage is
-- released automatically and hub_spare_capacity() recovers.
delete from missions where segment_id in (select id from _dup_segments);

delete from beach_segments where id in (select id from _dup_segments);

-- Stop it recurring. A coast segment is identified by its owner, its name and
-- where it is; two rows agreeing on all three are the same beach.
create unique index if not exists beach_segments_org_name_pos_key
  on beach_segments (org_id, name, lat, lng);

-- ---------- Tonnage provenance ----------
-- The watcher's tonnage figure is length_m / 10, times 1.5 at high SIR. That is
-- a shape-of-the-problem heuristic, NOT derived from AFAI density or any
-- published mass relationship. Every other number in CIIN carries its tier, and
-- an approver reading "60 t" is entitled to know which kind of number it is.
alter table missions add column if not exists tonnes_basis text;

comment on column missions.tonnes_basis is
  'How the tonnes figure was arrived at: indicative_length_heuristic (frontage '
  'length x SIR factor, not a measurement), operator_stated, or measured.';

update missions set tonnes_basis = 'indicative_length_heuristic'
 where tonnes_basis is null and source = 'live_feed';
update missions set tonnes_basis = 'operator_stated'
 where tonnes_basis is null;
