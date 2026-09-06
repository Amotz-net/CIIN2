-- =====================================================================
-- CIIN — Recovery Hub: line-step tracking + hub org seed
-- Adds a recovery-line step to missions (0..9) and seeds a Recovery Hub org
-- with its own mission and batches so the Hub dashboard has real own-org data.
-- =====================================================================

-- 9-step recovery line position (0 = not started, 9 = shipment done).
alter table missions add column if not exists line_step int not null default 0;

-- Seed a Recovery Hub org + its own mission + batches (own-org scoping).
do $$
declare hub_org uuid; m uuid;
begin
  insert into organizations (name, role, country_code, approved)
  values ('NEG01 Recovery Hub', 'recovery_hub', 'JM', true)
  on conflict do nothing;

  select id into hub_org from organizations where name = 'NEG01 Recovery Hub' limit 1;
  if hub_org is null then return; end if;

  -- a mission dispatched to this hub (authority approved + hotel access granted)
  insert into missions (org_id, title, tonnes, status, access_state, line_step, eta_at, source)
  values (hub_org, 'Long Bay clearance — NEG01', 100, 'access_granted', 'granted', 3,
          now() + interval '30 hours', 'representative')
  returning id into m;

  -- batches this hub is processing (real measurements -> engine computes grades)
  insert into batches (org_id, mission_id, batch_ref, arsenic_total, arsenic_inorganic,
                       foreign_matter, age_hours, measurement_conf, wet_mass_t)
  values
    (hub_org, m, 'CP-JAM-NEG01-0021', 82, 9.5, 2.5, 14, 'confirmed', 60),
    (hub_org, m, 'CP-JAM-NEG01-0022', 90, null, 4.0, 55, 'screened', 40)
  on conflict do nothing;
end $$;
