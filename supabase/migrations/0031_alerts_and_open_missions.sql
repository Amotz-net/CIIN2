-- =====================================================================
-- Alerts, and missions that do not wait for government.
--
-- The chain changes. A mission raised from the satellite reading goes straight
-- to the property and to the country's recovery hubs. Government decides only
-- when public health is at risk, which CIIN reads as an offshore level of
-- severe or extreme on the beach's own ten-year scale.
--
--   status 'raised'    no government decision needed; waiting on the owner
--   status 'proposed'  public health at risk; waiting on government
--
-- Everything here is safe to run twice.
-- =====================================================================

alter table missions drop constraint if exists missions_status_check;
alter table missions add constraint missions_status_check
  check (status in ('raised', 'proposed', 'authority_approved', 'access_granted', 'in_progress', 'completed', 'rejected'));

alter table missions add column if not exists authority_required boolean not null default false;
alter table missions add column if not exists alert_level text;

comment on column missions.authority_required is
  'True when the offshore level was severe or extreme when the mission was raised. Only then does government decide.';
comment on column missions.alert_level is
  'Offshore alert level on the beach''s own scale at the moment the mission was raised.';

-- ---------- The alert log ----------
-- One row per person alerted. It records what was sent and whether it went, so
-- "nobody told us" can be answered from the record.
create table if not exists alerts (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid references missions (id) on delete cascade,
  org_id      uuid references organizations (id) on delete cascade,
  profile_id  uuid references profiles (id) on delete set null,
  audience    text not null check (audience in ('owner', 'hub', 'government')),
  channel     text not null default 'email',
  subject     text not null,
  body        text not null,
  status      text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'not_configured')),
  detail      text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists alerts_mission_idx on alerts (mission_id);
create index if not exists alerts_org_idx on alerts (org_id, created_at desc);

alter table alerts enable row level security;
drop policy if exists alerts_select on alerts;
create policy alerts_select on alerts for select
  using (is_platform_admin() or (org_id = current_org_id() and my_org_approved()));
-- Written by the watcher with the service role only; no insert policy.

-- ---------- The owner can see who is responding ----------
-- Pool rows now belong to the hub, so the property could no longer read them.
-- The lookups go through functions that bypass row-level security, because the
-- missions policy already reads mission_hubs: a policy here that read missions
-- directly would send the two in circles.
create or replace function mission_owner(p_mission uuid) returns uuid
language sql stable security definer set search_path = public
as $$ select org_id from missions where id = p_mission $$;

create or replace function mission_country(p_mission uuid) returns text
language sql stable security definer set search_path = public
as $$ select o.country_code from missions m join organizations o on o.id = m.org_id where m.id = p_mission $$;

revoke all on function mission_owner(uuid) from public;
revoke all on function mission_country(uuid) from public;
grant execute on function mission_owner(uuid) to authenticated;
grant execute on function mission_country(uuid) to authenticated;

drop policy if exists mhub_owner_select on mission_hubs;
create policy mhub_owner_select on mission_hubs for select
  using (my_org_approved() and mission_owner(mission_id) = current_org_id());

drop policy if exists mhub_gov_select on mission_hubs;
create policy mhub_gov_select on mission_hubs for select
  using (my_gov_country() is not null and mission_country(mission_id) = my_gov_country());

-- ---------- A hub moves a mission it has accepted ----------
-- The mission belongs to the property, so a hub cannot write to it directly.
-- This is the one door: it checks the hub has accepted the mission (or owns
-- it), that the owner has granted access, and moves the line one step.
create or replace function hub_advance(p_mission uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := current_org_id();
  m      missions%rowtype;
  v_next int;
begin
  if auth.uid() is null or v_org is null or not my_org_approved() then
    raise exception 'Not authorised.';
  end if;
  select * into m from missions where id = p_mission;
  if not found then raise exception 'No such mission.'; end if;
  if not (m.org_id = v_org or exists (
      select 1 from mission_hubs mh where mh.mission_id = p_mission and mh.org_id = v_org and mh.accepted)) then
    raise exception 'This hub has not accepted the mission.';
  end if;
  if m.status in ('proposed', 'rejected', 'completed') then
    raise exception 'The mission cannot be advanced while it is %.', m.status;
  end if;
  if m.access_state not in ('granted', 'granted_conditions') then
    raise exception 'The owner has not granted access.';
  end if;
  v_next := least(9, coalesce(m.line_step, 0) + 1);
  update missions
     set line_step = v_next,
         status = case when v_next >= 9 then 'completed' else 'in_progress' end
   where id = p_mission;
  return v_next;
end;
$$;
revoke all on function hub_advance(uuid) from public;
grant execute on function hub_advance(uuid) to authenticated;

comment on function hub_advance is
  'Moves a mission one step along the recovery line for a hub that has accepted it. '
  'security definer because the mission belongs to the property, not the hub.';
