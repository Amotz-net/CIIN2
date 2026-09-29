-- =====================================================================
-- Clean-up visits: the dates a hub will be on a beach.
--
-- The hub proposes when it will arrive and when removal will be finished. The
-- property sees it, and either confirms or asks for another time. Both sides
-- then work from the same dates for arrival, access and removal.
--
--   proposed          sent by the hub, waiting on the property
--   confirmed         the property has agreed
--   change_requested  the property has asked for another time (see reply)
--   completed         the hub has finished
--   cancelled         the hub has withdrawn it
--
-- Safe to run twice.
-- =====================================================================

create table if not exists cleanup_visits (
  id           uuid primary key default gen_random_uuid(),
  mission_id   uuid not null references missions (id) on delete cascade,
  org_id       uuid not null references organizations (id) on delete cascade,   -- the hub
  arrives_at   timestamptz not null,
  finishes_at  timestamptz not null,
  crew         int,
  trucks       int,
  note         text,
  status       text not null default 'proposed'
               check (status in ('proposed', 'confirmed', 'change_requested', 'completed', 'cancelled')),
  reply        text,                       -- what the property said
  replied_by   uuid references profiles (id) on delete set null,
  replied_at   timestamptz,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (finishes_at > arrives_at)
);
create index if not exists cleanup_visits_mission_idx on cleanup_visits (mission_id);
create index if not exists cleanup_visits_org_idx on cleanup_visits (org_id, arrives_at);

create or replace function mission_property(p_mission uuid) returns uuid
language sql stable security definer set search_path = public
as $$ select s.property_id from missions m join beach_segments s on s.id = m.segment_id where m.id = p_mission $$;
revoke all on function mission_property(uuid) from public;
grant execute on function mission_property(uuid) to authenticated;

-- May this hub schedule work on this mission? It owns it, or has accepted it.
create or replace function hub_on_mission(p_mission uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from missions m where m.id = p_mission and m.org_id = current_org_id())
      or exists (select 1 from mission_hubs mh where mh.mission_id = p_mission and mh.org_id = current_org_id() and mh.accepted)
$$;
revoke all on function hub_on_mission(uuid) from public;
grant execute on function hub_on_mission(uuid) to authenticated;

alter table cleanup_visits enable row level security;

drop policy if exists visits_select on cleanup_visits;
create policy visits_select on cleanup_visits for select
  using (
    is_platform_admin()
    or (my_org_approved() and org_id = current_org_id())
    or (my_org_approved() and mission_owner(mission_id) = current_org_id()
        and (my_property() is null or mission_property(mission_id) = my_property()))
    or (my_gov_country() is not null and mission_country(mission_id) = my_gov_country())
  );

drop policy if exists visits_insert on cleanup_visits;
create policy visits_insert on cleanup_visits for insert
  with check (my_org_approved() and org_id = current_org_id() and hub_on_mission(mission_id));

drop policy if exists visits_update on cleanup_visits;
create policy visits_update on cleanup_visits for update
  using (my_org_approved() and org_id = current_org_id())
  with check (my_org_approved() and org_id = current_org_id());

-- A change of dates by the hub puts the visit back in front of the property.
create or replace function visit_touch() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (new.arrives_at is distinct from old.arrives_at or new.finishes_at is distinct from old.finishes_at)
     and new.status in ('confirmed', 'change_requested') then
    new.status := 'proposed'; new.reply := null; new.replied_by := null; new.replied_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_visit_touch on cleanup_visits;
create trigger trg_visit_touch before update on cleanup_visits for each row execute function visit_touch();

-- The property's answer. The visit belongs to the hub, so the property
-- replies through this one door and can change nothing else.
create or replace function visit_respond(p_visit uuid, p_status text, p_reply text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v cleanup_visits%rowtype;
begin
  if auth.uid() is null or not my_org_approved() then raise exception 'Not authorised.'; end if;
  if p_status not in ('confirmed', 'change_requested') then raise exception 'Answer must be confirmed or change_requested.'; end if;
  select * into v from cleanup_visits where id = p_visit;
  if not found then raise exception 'No such visit.'; end if;
  if mission_owner(v.mission_id) <> current_org_id()
     or (my_property() is not null and mission_property(v.mission_id) is distinct from my_property()) then
    raise exception 'This visit is not on your property.';
  end if;
  if v.status in ('completed', 'cancelled') then raise exception 'This visit is already %.', v.status; end if;
  -- bypass the touch trigger's reset: dates are unchanged here
  update cleanup_visits set status = p_status, reply = nullif(trim(coalesce(p_reply, '')), ''),
         replied_by = auth.uid(), replied_at = now() where id = p_visit;
end;
$$;
revoke all on function visit_respond(uuid, text, text) from public;
grant execute on function visit_respond(uuid, text, text) to authenticated;
