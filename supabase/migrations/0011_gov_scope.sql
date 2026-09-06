-- =====================================================================
-- CIIN — Stage 3 (0011): Government jurisdiction scoping
-- A Government-role org oversees its whole coast, so it may READ operational
-- data across ALL orgs that share its country_code. This is the FIRST cross-org
-- read in the system — every other policy is "your own org only". It is scoped
-- tightly: Government role + same country only, read-only (no cross-org writes).
-- =====================================================================

-- Helper: is the caller a member of a Government-role org, and what country?
-- SECURITY DEFINER so it can read profiles/organizations without recursing
-- through the policies it supports.
create or replace function my_gov_country()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select o.country_code
  from profiles p
  join organizations o on o.id = p.org_id
  where p.id = auth.uid()
    and o.role = 'government'
    and o.approved = true
$$;
-- Returns the caller's country_code IF they are an approved Government member,
-- else NULL. Used by the cross-org read policies below.

-- Add a permissive SELECT policy on each operational table for Government.
-- These are ADDITIVE (Postgres RLS ORs multiple permissive policies together),
-- so they widen read access for Government without touching the existing
-- own-org policies for everyone else.

-- beach_segments
create policy bseg_gov_select on beach_segments for select
  using (
    my_gov_country() is not null
    and exists (select 1 from organizations o where o.id = beach_segments.org_id
                and o.country_code = my_gov_country())
  );

-- sargassum_arrivals
create policy sarr_gov_select on sargassum_arrivals for select
  using (
    my_gov_country() is not null
    and exists (select 1 from organizations o where o.id = sargassum_arrivals.org_id
                and o.country_code = my_gov_country())
  );

-- missions
create policy mission_gov_select on missions for select
  using (
    my_gov_country() is not null
    and exists (select 1 from organizations o where o.id = missions.org_id
                and o.country_code = my_gov_country())
  );

-- load_summaries
create policy load_gov_select on load_summaries for select
  using (
    my_gov_country() is not null
    and exists (select 1 from organizations o where o.id = load_summaries.org_id
                and o.country_code = my_gov_country())
  );

-- Government may also read the org rows in its country (for names/coordinates).
create policy org_gov_select on organizations for select
  using (
    my_gov_country() is not null and country_code = my_gov_country()
  );
