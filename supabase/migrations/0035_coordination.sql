-- =====================================================================
-- Coordination on the beach.
--
--   1. landing_reports   the property says sargassum has landed; a 48-hour
--                        clock runs from that moment
--   2. removals          the hub records what it took and where it went; the
--                        property signs it off
--   3. alerts            gain a kind and a reference, so a reminder is sent
--                        once and not every hour
--   4. site access       gate, hours and contact on each property;
--      beach_rules       rules the government sets, which a hub must read
--   5. samples           a sample handed from hub to laboratory and back
--
-- Safe to run twice.
-- =====================================================================

-- ---------- helpers (bypass row-level security; return one fact each) ----------
create or replace function org_country(p_org uuid) returns text
language sql stable security definer set search_path = public
as $$ select country_code from organizations where id = p_org $$;

create or replace function my_country() returns text
language sql stable security definer set search_path = public
as $$ select o.country_code from organizations o where o.id = current_org_id() $$;

create or replace function my_role() returns text
language sql stable security definer set search_path = public
as $$ select o.role::text from organizations o where o.id = current_org_id() $$;

create or replace function segment_owner(p_segment uuid) returns uuid
language sql stable security definer set search_path = public
as $$ select org_id from beach_segments where id = p_segment $$;

revoke all on function org_country(uuid) from public;
revoke all on function my_country() from public;
revoke all on function my_role() from public;
revoke all on function segment_owner(uuid) from public;
grant execute on function org_country(uuid) to authenticated;
grant execute on function my_country() to authenticated;
grant execute on function my_role() to authenticated;
grant execute on function segment_owner(uuid) to authenticated;

-- Names of the approved organisations in the caller's country. Every role
-- needs to know who the hubs, laboratories and processors are; nobody gets
-- more than a name and a role.
create or replace function country_directory()
returns table (id uuid, name text, role text, country_code text, capacity_t numeric)
language sql stable security definer set search_path = public
as $$
  select o.id, o.name, o.role::text, o.country_code, o.capacity_t
  from organizations o
  where o.approved and (is_platform_admin() or o.country_code = my_country())
    and auth.uid() is not null
$$;
revoke all on function country_directory() from public;
grant execute on function country_directory() to authenticated;

-- ---------- 1. landing reports ----------
create table if not exists landing_reports (
  id          uuid primary key default gen_random_uuid(),
  segment_id  uuid not null references beach_segments (id) on delete cascade,
  org_id      uuid not null references organizations (id) on delete cascade,   -- the property's owner
  mission_id  uuid references missions (id) on delete set null,
  landed_at   timestamptz not null,
  extent      text not null check (extent in ('light', 'moderate', 'heavy')),
  note        text,
  photo       text,                         -- path in the evidence store
  reported_by uuid references profiles (id) on delete set null,
  cleared_at  timestamptz,                  -- set when removal is signed off
  created_at  timestamptz not null default now()
);
create index if not exists landing_segment_idx on landing_reports (segment_id, landed_at desc);

alter table landing_reports enable row level security;
drop policy if exists landing_select on landing_reports;
create policy landing_select on landing_reports for select
  using (
    is_platform_admin()
    or (my_org_approved() and org_id = current_org_id()
        and (my_property() is null or segment_property(segment_id) = my_property()))
    or (my_org_approved() and org_country(org_id) = my_country() and my_role() in ('government', 'recovery_hub'))
  );
-- Written only through report_landing().

create or replace function report_landing(p_segment uuid, p_landed_at timestamptz, p_extent text, p_note text default null, p_photo text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  seg beach_segments%rowtype;
  v_mission uuid;
  v_report uuid;
  v_new boolean := false;
begin
  if auth.uid() is null or not my_org_approved() then raise exception 'Not authorised.'; end if;
  select * into seg from beach_segments where id = p_segment;
  if not found or seg.org_id <> current_org_id()
     or (my_property() is not null and seg.property_id is distinct from my_property()) then
    raise exception 'This beach is not yours to report on.';
  end if;
  if p_extent not in ('light', 'moderate', 'heavy') then raise exception 'Extent must be light, moderate or heavy.'; end if;
  if p_landed_at > now() + interval '10 minutes' then raise exception 'A landing cannot be reported for the future.'; end if;

  select id into v_mission from missions
   where segment_id = p_segment and status in ('raised', 'proposed', 'authority_approved', 'access_granted', 'in_progress')
   order by created_at desc limit 1;

  -- No mission open: the landing itself raises one, and every approved hub in
  -- the country is told. CIIN does not choose among them.
  if v_mission is null then
    insert into missions (org_id, segment_id, title, status, access_state, eta_at, source, tonnes_basis, authority_required)
    values (seg.org_id, seg.id, seg.name || ' — landed', 'raised', 'pending', p_landed_at, 'manual', null, false)
    returning id into v_mission;
    insert into mission_hubs (org_id, mission_id, hub_name, share_tonnes, accepted)
    select o.id, v_mission, o.name, null, false from organizations o
     where o.role = 'recovery_hub' and o.approved and o.country_code = org_country(seg.org_id);
    v_new := true;
  end if;

  insert into landing_reports (segment_id, org_id, mission_id, landed_at, extent, note, photo, reported_by)
  values (seg.id, seg.org_id, v_mission, p_landed_at, p_extent, nullif(trim(coalesce(p_note, '')), ''), p_photo, auth.uid())
  returning id into v_report;
  return jsonb_build_object('report', v_report, 'mission', v_mission, 'mission_raised', v_new);
end;
$$;
revoke all on function report_landing(uuid, timestamptz, text, text, text) from public;
grant execute on function report_landing(uuid, timestamptz, text, text, text) to authenticated;

-- ---------- 2. removals ----------
create table if not exists removals (
  id               uuid primary key default gen_random_uuid(),
  mission_id       uuid not null references missions (id) on delete cascade,
  visit_id         uuid references cleanup_visits (id) on delete set null,
  org_id           uuid not null references organizations (id) on delete cascade,   -- the hub
  removed_at       timestamptz not null,
  tonnes           numeric(10,1) not null check (tonnes >= 0),
  tonnes_basis     text not null check (tonnes_basis in ('weighed', 'estimated')),
  destination_org  uuid references organizations (id) on delete set null,
  destination_text text,
  photo_before     text,
  photo_after      text,
  note             text,
  status           text not null default 'recorded' check (status in ('recorded', 'signed', 'disputed')),
  sign_note        text,
  signed_by        uuid references profiles (id) on delete set null,
  signed_at        timestamptz,
  created_by       uuid references profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists removals_mission_idx on removals (mission_id);

alter table removals enable row level security;
drop policy if exists removals_select on removals;
create policy removals_select on removals for select
  using (
    is_platform_admin()
    or (my_org_approved() and org_id = current_org_id())
    or (my_org_approved() and mission_owner(mission_id) = current_org_id()
        and (my_property() is null or mission_property(mission_id) = my_property()))
    or (my_org_approved() and destination_org = current_org_id())
    or (my_gov_country() is not null and mission_country(mission_id) = my_gov_country())
  );
drop policy if exists removals_insert on removals;
create policy removals_insert on removals for insert
  with check (my_org_approved() and org_id = current_org_id() and hub_on_mission(mission_id));
-- A record is not edited after the fact. A correction is a new record.

create or replace function removal_sign(p_removal uuid, p_agree boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare r removals%rowtype;
begin
  if auth.uid() is null or not my_org_approved() then raise exception 'Not authorised.'; end if;
  select * into r from removals where id = p_removal;
  if not found then raise exception 'No such record.'; end if;
  if mission_owner(r.mission_id) <> current_org_id()
     or (my_property() is not null and mission_property(r.mission_id) is distinct from my_property()) then
    raise exception 'This removal was not on your property.';
  end if;
  if r.status <> 'recorded' then raise exception 'This record is already %.', r.status; end if;
  if not p_agree and coalesce(trim(p_note), '') = '' then raise exception 'Say what is wrong with the record.'; end if;
  update removals set status = case when p_agree then 'signed' else 'disputed' end,
         sign_note = nullif(trim(coalesce(p_note, '')), ''), signed_by = auth.uid(), signed_at = now()
   where id = p_removal;
  -- A signed removal stops the clock on that beach.
  if p_agree then
    update landing_reports l set cleared_at = r.removed_at
      from missions m
     where m.id = r.mission_id and l.segment_id = m.segment_id and l.cleared_at is null and l.landed_at <= r.removed_at;
  end if;
end;
$$;
revoke all on function removal_sign(uuid, boolean, text) from public;
grant execute on function removal_sign(uuid, boolean, text) to authenticated;

-- ---------- 3. alerts: once, not hourly ----------
alter table alerts add column if not exists kind text;
alter table alerts add column if not exists ref uuid;
alter table alerts drop constraint if exists alerts_audience_check;
alter table alerts add constraint alerts_audience_check
  check (audience in ('owner', 'hub', 'government', 'lab', 'processor', 'admin'));
create index if not exists alerts_kind_ref_idx on alerts (kind, ref);

-- ---------- 4. site access and beach rules ----------
alter table properties add column if not exists access_gate   text;
alter table properties add column if not exists access_hours  text;
alter table properties add column if not exists contact_name  text;
alter table properties add column if not exists contact_phone text;
alter table properties add column if not exists access_notes  text;

-- A property manager may keep their own property's access details up to date.
drop policy if exists properties_manager_update on properties;
create policy properties_manager_update on properties for update
  using (org_id = current_org_id() and my_org_approved() and (my_property() is null or id = my_property()))
  with check (org_id = current_org_id() and my_org_approved() and (my_property() is null or id = my_property()));

-- What a hub needs to get on site. Shown only to a hub that has accepted a
-- mission on that property, because it carries a person's name and phone.
create or replace function site_access(p_mission uuid)
returns table (property_id uuid, property_name text, access_gate text, access_hours text, contact_name text, contact_phone text, access_notes text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.access_gate, p.access_hours, p.contact_name, p.contact_phone, p.access_notes
  from missions m join beach_segments s on s.id = m.segment_id join properties p on p.id = s.property_id
  where m.id = p_mission
    and (is_platform_admin() or m.org_id = current_org_id()
         or exists (select 1 from mission_hubs mh where mh.mission_id = m.id and mh.org_id = current_org_id() and mh.accepted))
$$;
revoke all on function site_access(uuid) from public;
grant execute on function site_access(uuid) to authenticated;

create table if not exists beach_rules (
  id           uuid primary key default gen_random_uuid(),
  country_code text not null,
  segment_id   uuid references beach_segments (id) on delete cascade,   -- NULL: applies to the whole country
  kind         text not null check (kind in ('turtle_nesting', 'machinery', 'hours', 'protected_area', 'other')),
  rule         text not null,
  from_date    date,
  to_date      date,
  active       boolean not null default true,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists beach_rules_country_idx on beach_rules (country_code);

alter table beach_rules enable row level security;
drop policy if exists rules_select on beach_rules;
create policy rules_select on beach_rules for select
  using (is_platform_admin() or (my_org_approved() and country_code = my_country()));
drop policy if exists rules_write on beach_rules;
create policy rules_write on beach_rules for all
  using (my_gov_country() is not null and country_code = my_gov_country())
  with check (my_gov_country() is not null and country_code = my_gov_country());

alter table cleanup_visits add column if not exists rules_read_at timestamptz;

-- ---------- 5. samples ----------
create table if not exists samples (
  id           uuid primary key default gen_random_uuid(),
  sample_ref   text not null,
  batch_id     uuid references batches (id) on delete set null,
  mission_id   uuid references missions (id) on delete set null,
  org_id       uuid not null references organizations (id) on delete cascade,   -- the sender
  lab_org_id   uuid not null references organizations (id) on delete cascade,
  taken_at     timestamptz not null,
  sent_at      timestamptz not null default now(),
  received_at  timestamptz,
  received_by  uuid references profiles (id) on delete set null,
  resulted_at  timestamptz,
  arsenic_inorganic numeric,
  status       text not null default 'sent' check (status in ('sent', 'received', 'resulted')),
  note         text,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists samples_lab_idx on samples (lab_org_id, status);
create index if not exists samples_org_idx on samples (org_id);

alter table samples enable row level security;
drop policy if exists samples_select on samples;
create policy samples_select on samples for select
  using (
    is_platform_admin()
    or (my_org_approved() and (org_id = current_org_id() or lab_org_id = current_org_id()))
    or (my_gov_country() is not null and org_country(org_id) = my_gov_country())
  );
drop policy if exists samples_insert on samples;
create policy samples_insert on samples for insert
  with check (my_org_approved() and org_id = current_org_id());

create or replace function sample_receive(p_sample uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  update samples set status = 'received', received_at = now(), received_by = auth.uid()
   where id = p_sample and lab_org_id = current_org_id() and status = 'sent' and my_org_approved();
  if not found then raise exception 'This sample is not waiting at your laboratory.'; end if;
end;
$$;

-- The laboratory measures; the rules grade. The result goes onto the sender's
-- batch, which the laboratory cannot otherwise touch.
create or replace function sample_result(p_sample uuid, p_inorganic numeric) returns void
language plpgsql security definer set search_path = public
as $$
declare s samples%rowtype;
begin
  if auth.uid() is null or not my_org_approved() then raise exception 'Not authorised.'; end if;
  if p_inorganic is null or p_inorganic < 0 then raise exception 'Enter the measured value in mg/kg.'; end if;
  select * into s from samples where id = p_sample;
  if not found or s.lab_org_id <> current_org_id() then raise exception 'This sample is not at your laboratory.'; end if;
  if s.status = 'resulted' then raise exception 'A result has already been returned.'; end if;
  update samples set status = 'resulted', resulted_at = now(), arsenic_inorganic = p_inorganic,
         received_at = coalesce(received_at, now()), received_by = coalesce(received_by, auth.uid())
   where id = p_sample;
  if s.batch_id is not null then
    update batches set arsenic_inorganic = p_inorganic, measurement_conf = 'confirmed' where id = s.batch_id;
  end if;
end;
$$;
revoke all on function sample_receive(uuid) from public;
revoke all on function sample_result(uuid, numeric) from public;
grant execute on function sample_receive(uuid) to authenticated;
grant execute on function sample_result(uuid, numeric) to authenticated;

-- ---------- evidence photographs ----------
insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false)
on conflict (id) do nothing;

-- A photograph is filed under the organisation that took it. It can be seen
-- by that organisation, by CIIN, and by approved organisations in the same
-- country, which is who needs it to coordinate.
create or replace function can_see_evidence(p_path text) returns boolean
language sql stable security definer set search_path = public
as $$
  select is_platform_admin()
      or (my_org_approved() and split_part(p_path, '/', 1) = current_org_id()::text)
      or (my_org_approved() and exists (
            select 1 from organizations o
            where o.id::text = split_part(p_path, '/', 1) and o.country_code = my_country()))
$$;
revoke all on function can_see_evidence(text) from public;
grant execute on function can_see_evidence(text) to authenticated;

drop policy if exists evidence_read on storage.objects;
create policy evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and can_see_evidence(name));
drop policy if exists evidence_write on storage.objects;
create policy evidence_write on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and my_org_approved() and split_part(name, '/', 1) = current_org_id()::text);
