-- =====================================================================
-- Hub capacity — so "agent-ranked hubs" ranks on something real.
--
-- The agent's Logistics/Routing contribution currently reads its hub capacities
-- from a literal in the client:
--     hubs: [{name:'NEG01', spare_t:90}, {name:'Bloody Bay', spare_t:60}]
-- Those two numbers have never come from the database. Routing a mission to
-- agent-ranked hubs on the strength of a hardcoded array would be worse than
-- not ranking at all, because the ranking would look authoritative.
--
-- capacity_t is the hub's nominal working capacity. SPARE capacity is derived,
-- never stored: nominal minus what is already committed to live missions, so it
-- cannot drift out of step with the mission board.
-- =====================================================================

alter table organizations add column if not exists capacity_t numeric(10,1);

comment on column organizations.capacity_t is
  'Nominal working capacity in tonnes, for recovery hubs and processors. NULL '
  'means unknown — the agent then ranks the hub last rather than assuming a figure.';

-- Committed tonnage = share_tonnes on mission_hubs rows whose mission is still
-- live. A completed or rejected mission frees its share.
create or replace function hub_spare_capacity(p_org uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    coalesce((select capacity_t from organizations where id = p_org), 0)
    - coalesce((
        select sum(mh.share_tonnes)
        from mission_hubs mh
        join missions m on m.id = mh.mission_id
        where mh.org_id = p_org
          and m.status not in ('completed', 'rejected')
      ), 0),
    0)
$$;

comment on function hub_spare_capacity is
  'Nominal capacity minus tonnage committed to live missions. Derived so it '
  'cannot fall out of step with the mission board.';

-- Representative starting figures for the seeded hubs, matching the literals the
-- client has been using so behaviour does not jump when the source changes.
update organizations set capacity_t = 90 where role = 'recovery_hub' and name ilike '%NEG01%' and capacity_t is null;
update organizations set capacity_t = 60 where role = 'recovery_hub' and capacity_t is null;
