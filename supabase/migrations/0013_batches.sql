-- =====================================================================
-- CIIN — Stage 3+ (0013): batches with real MEASUREMENTS
-- load_summaries stored a pre-computed grade (seeded). To make grades genuinely
-- COMPUTED by the engine, we need the underlying lab/field measurements. This
-- table holds them; the app runs them through grading.js (config-driven rules).
-- =====================================================================

create table batches (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations (id) on delete cascade,
  mission_id          uuid references missions (id) on delete set null,
  batch_ref           text not null,                 -- e.g. CP-JAM-NEG01-0007
  arsenic_total       numeric,                       -- mg/kg (field screen, total)
  arsenic_inorganic   numeric,                       -- mg/kg (lab confirmed, inorganic)
  foreign_matter      numeric,                       -- %
  age_hours           numeric,                       -- hours since collection
  chain_valid         boolean not null default true,
  signature_valid     boolean not null default true,
  measurement_conf    text default 'screened'
                      check (measurement_conf in ('screened','confirmed')),
  wet_mass_t          numeric,
  created_at          timestamptz not null default now()
);

create index batches_org_idx on batches (org_id);

alter table batches enable row level security;

-- Own-org access (approval-gated), plus Government cross-org read (country).
create policy batch_select on batches for select
  using ((org_id = current_org_id() and my_org_approved()) or is_platform_admin());
create policy batch_write on batches for all
  using (org_id = current_org_id() and my_org_approved())
  with check (org_id = current_org_id() and my_org_approved());
create policy batch_gov_select on batches for select
  using (
    my_gov_country() is not null
    and exists (select 1 from organizations o where o.id = batches.org_id
                and o.country_code = my_gov_country())
  );

-- Seed the demo batch (the screened->verified story used throughout).
-- Confirmed inorganic 11.8 -> engine grades B on the EU-anchored bands.
do $$
declare hotel_org uuid;
begin
  select id into hotel_org from organizations where role = 'hotel' order by created_at limit 1;
  if hotel_org is not null then
    insert into batches (org_id, batch_ref, arsenic_total, arsenic_inorganic,
                         foreign_matter, age_hours, measurement_conf, wet_mass_t)
    values
      (hotel_org, 'CP-JAM-NEG01-0007', 86, 11.8, 3.0, 10, 'confirmed', 210),
      (hotel_org, 'CP-JAM-NEG01-0008', 40, 1.5, 1.2, 20, 'confirmed', 95)
    on conflict do nothing;
  end if;
end $$;
