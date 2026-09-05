-- =====================================================================
-- CIIN — Stage 2 (0006): RLS for Hotel operational tables
-- Rule (Spec §11.2): operational data is visible to ALL members of the org,
-- scoped to org_id, and gated LIVE on the org being approved (§11.3 cascade).
-- Platform admin sees all. Writes require membership in the owning org.
-- =====================================================================

alter table beach_segments      enable row level security;
alter table sargassum_arrivals  enable row level security;
alter table missions            enable row level security;
alter table mission_hubs        enable row level security;
alter table load_summaries      enable row level security;

-- Reusable predicate: the row belongs to my org AND (my org is approved OR I'm platform admin).
-- Expressed inline per table since Postgres RLS policies can't take shared macros.

-- beach_segments
create policy bseg_select on beach_segments for select
  using ((org_id = current_org_id() and my_org_approved()) or is_platform_admin());
create policy bseg_write on beach_segments for all
  using (org_id = current_org_id() and my_org_approved())
  with check (org_id = current_org_id() and my_org_approved());

-- sargassum_arrivals
create policy sarr_select on sargassum_arrivals for select
  using ((org_id = current_org_id() and my_org_approved()) or is_platform_admin());
create policy sarr_write on sargassum_arrivals for all
  using (org_id = current_org_id() and my_org_approved())
  with check (org_id = current_org_id() and my_org_approved());

-- missions
create policy mission_select on missions for select
  using ((org_id = current_org_id() and my_org_approved()) or is_platform_admin());
create policy mission_write on missions for all
  using (org_id = current_org_id() and my_org_approved())
  with check (org_id = current_org_id() and my_org_approved());

-- mission_hubs
create policy mhub_select on mission_hubs for select
  using ((org_id = current_org_id() and my_org_approved()) or is_platform_admin());
create policy mhub_write on mission_hubs for all
  using (org_id = current_org_id() and my_org_approved())
  with check (org_id = current_org_id() and my_org_approved());

-- load_summaries
create policy load_select on load_summaries for select
  using ((org_id = current_org_id() and my_org_approved()) or is_platform_admin());
create policy load_write on load_summaries for all
  using (org_id = current_org_id() and my_org_approved())
  with check (org_id = current_org_id() and my_org_approved());
