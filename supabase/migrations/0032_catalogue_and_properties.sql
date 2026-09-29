-- =====================================================================
-- The catalogue, and owners with several properties.
--
-- Two reference lists, by country:
--   beaches   every listed beach, whether or not anyone in CIIN looks after it
--   hotels    every known hotel, whether or not it has joined CIIN
--
-- And one ownership layer:
--   properties   a hotel owner may hold several, in several places. Each
--                property has its own frontage, and a property manager
--                invited to one property sees that property only.
--
-- Who sees what:
--   platform admin   everything, every country
--   government       every beach, hotel and property in its own country
--   hotel owner      its own properties and their frontage
--   property manager the one property they were invited to
--
-- Safe to run twice.
-- =====================================================================

create table if not exists beaches (
  id           uuid primary key default gen_random_uuid(),
  country_code text not null,
  name         text not null,
  parish       text,
  owner_name   text,
  licensed     boolean,
  lat          double precision,
  lng          double precision,
  -- 'beach'       matched to a mapped beach of the same name
  -- 'approximate' found by place name: a village, road or landmark nearby
  -- 'unlocated'   on the list, position not yet known
  precision    text not null default 'unlocated' check (precision in ('beach', 'approximate', 'unlocated')),
  located_by   text,
  osm_ref      text,
  source       text not null,
  created_at   timestamptz not null default now(),
  unique (country_code, name, parish)
);
create index if not exists beaches_country_idx on beaches (country_code);

create table if not exists hotels (
  id           uuid primary key default gen_random_uuid(),
  country_code text not null,
  name         text not null,
  kind         text,
  lat          double precision not null,
  lng          double precision not null,
  place        text,
  osm_ref      text unique,
  source       text not null,
  created_at   timestamptz not null default now()
);
create index if not exists hotels_country_idx on hotels (country_code);

create table if not exists properties (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations (id) on delete cascade,
  hotel_id     uuid references hotels (id) on delete set null,
  name         text not null,
  country_code text not null,
  lat          double precision,
  lng          double precision,
  created_at   timestamptz not null default now()
);
create index if not exists properties_org_idx on properties (org_id);

alter table beach_segments add column if not exists property_id uuid references properties (id) on delete set null;
alter table beach_segments add column if not exists beach_id uuid references beaches (id) on delete set null;
alter table profiles      add column if not exists property_id uuid references properties (id) on delete set null;
alter table invitations   add column if not exists property_id uuid references properties (id) on delete set null;

comment on column profiles.property_id is
  'Set for a property manager: they see this property only. NULL means the whole organisation.';

-- The property the caller is confined to, if any.
create or replace function my_property() returns uuid
language sql stable security definer set search_path = public
as $$ select property_id from profiles where id = auth.uid() $$;
revoke all on function my_property() from public;
grant execute on function my_property() to authenticated;

-- ---------- catalogue: read ----------
alter table beaches enable row level security;
alter table hotels  enable row level security;

drop policy if exists beaches_select on beaches;
create policy beaches_select on beaches for select
  using (is_platform_admin() or (my_gov_country() is not null and country_code = my_gov_country()));

-- A hotel owner needs the hotel list for its own country to find its property.
drop policy if exists hotels_select on hotels;
create policy hotels_select on hotels for select
  using (
    is_platform_admin()
    or (my_gov_country() is not null and country_code = my_gov_country())
    or (my_org_approved() and exists (
      select 1 from organizations o where o.id = current_org_id() and o.role = 'hotel' and o.country_code = hotels.country_code))
  );
-- The catalogue is loaded by CIIN; nobody writes to it through the app.

-- ---------- properties ----------
alter table properties enable row level security;

drop policy if exists properties_select on properties;
create policy properties_select on properties for select
  using (
    is_platform_admin()
    or (my_gov_country() is not null and country_code = my_gov_country())
    or (org_id = current_org_id() and my_org_approved() and (my_property() is null or id = my_property()))
  );

drop policy if exists properties_write on properties;
create policy properties_write on properties for all
  using (org_id = current_org_id() and my_org_approved() and is_org_admin())
  with check (org_id = current_org_id() and my_org_approved() and is_org_admin());

-- ---------- a property manager sees one property ----------
-- Restrictive: these narrow what the existing policies already allow. For
-- anyone not confined to a property they change nothing.
drop policy if exists bseg_property_scope on beach_segments;
create policy bseg_property_scope on beach_segments as restrictive for select
  using (my_property() is null or property_id = my_property());

create or replace function segment_property(p_segment uuid) returns uuid
language sql stable security definer set search_path = public
as $$ select property_id from beach_segments where id = p_segment $$;
revoke all on function segment_property(uuid) from public;
grant execute on function segment_property(uuid) to authenticated;

drop policy if exists mission_property_scope on missions;
create policy mission_property_scope on missions as restrictive for select
  using (my_property() is null or segment_property(segment_id) = my_property());

-- ---------- an invitation can carry a property ----------
-- invite_by_token() returns it so the accept page can place the new person.
drop function if exists invite_by_token(uuid);
create function invite_by_token(p_token uuid)
returns table (
  id uuid, email text, level member_level, status invite_status, expires_at timestamptz,
  org_id uuid, org_name text, org_role ciin_role, property_id uuid, property_name text
)
language sql stable security definer set search_path = public
as $$
  select i.id, i.email, i.level, i.status, i.expires_at, i.org_id, o.name, o.role, i.property_id, p.name
  from invitations i
  left join organizations o on o.id = i.org_id
  left join properties p on p.id = i.property_id
  where i.token = p_token
  limit 1
$$;
revoke all on function invite_by_token(uuid) from public;
grant execute on function invite_by_token(uuid) to anon, authenticated;

-- ---------- nobody widens their own access ----------
-- The property comes from the invitation, never from the browser.
create or replace function guard_profile_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  caller_email text := coalesce(auth.jwt() ->> 'email', '');
  inv invitations%rowtype;
begin
  if new.is_platform_admin is true and not is_platform_admin() then
    new.is_platform_admin := false;
  end if;
  if new.org_id is not null and not is_platform_admin() then
    select * into inv from invitations i
    where i.org_id = new.org_id and lower(i.email) = lower(caller_email)
      and i.status = 'pending' and i.expires_at > now()
    order by i.created_at desc limit 1;
    if not found then
      raise exception 'org_id % is not an organization you were invited to', new.org_id;
    end if;
    if new.level = 'org_admin' and inv.level <> 'org_admin' then
      new.level := 'member';
    end if;
    new.property_id := inv.property_id;
  end if;
  return new;
end;
$$;

-- A person may edit their own name, but not their level, organisation or
-- property. Those are changed by an organisation admin or by CIIN.
create or replace function guard_profile_escalation()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.is_platform_admin is distinct from old.is_platform_admin) and not is_platform_admin() then
    raise exception 'not authorized to change platform admin flag';
  end if;
  if (new.level is distinct from old.level or new.org_id is distinct from old.org_id
      or new.property_id is distinct from old.property_id)
     and auth.uid() is not null
     and not is_platform_admin()
     and not (is_org_admin() and old.org_id = current_org_id() and new.org_id = old.org_id and old.id <> auth.uid()) then
    raise exception 'not authorized to change level, organisation or property';
  end if;
  return new;
end;
$$;
