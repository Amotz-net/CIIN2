-- =====================================================================
-- CIIN — Lab / Buyer / Finance orgs + batches dedupe/constraint
-- Seeds one org per remaining role with its own batches so each dashboard has
-- real own-org data. ALSO fixes the recurring duplicate-seed problem: dedupe
-- existing batches, then add a unique constraint so re-runs can't duplicate.
-- =====================================================================

-- 1) Dedupe any existing duplicate batches (keep earliest per org+ref).
delete from batches a using batches b
  where a.ctid > b.ctid and a.org_id = b.org_id and a.batch_ref = b.batch_ref;

-- 2) Add the unique constraint so on-conflict works from now on.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'batches_org_ref_unique') then
    alter table batches add constraint batches_org_ref_unique unique (org_id, batch_ref);
  end if;
end $$;

-- 3) Seed the three remaining role orgs + their batches.
do $$
declare lab_org uuid; buy_org uuid; fin_org uuid;
begin
  insert into organizations (name, role, country_code, approved) values
    ('CIIN Accredited Lab', 'university_lab', 'JM', true),
    ('Caribbean Alginate Co.', 'buyer', 'JM', true),
    ('Blue Economy DFI', 'finance', 'JM', true)
  on conflict do nothing;

  select id into lab_org from organizations where name = 'CIIN Accredited Lab' limit 1;
  select id into buy_org from organizations where name = 'Caribbean Alginate Co.' limit 1;
  select id into fin_org from organizations where name = 'Blue Economy DFI' limit 1;

  -- Lab: samples in the queue (screened, awaiting result) + one already confirmed.
  if lab_org is not null then
    insert into batches (org_id, batch_ref, arsenic_total, arsenic_inorganic, foreign_matter, age_hours, measurement_conf, wet_mass_t)
    values
      (lab_org, 'CP-JAM-LAB-0041', 78, null, 2.0, 16, 'screened', 50),
      (lab_org, 'CP-JAM-LAB-0042', 60, null, 1.5, 22, 'screened', 35),
      (lab_org, 'CP-JAM-LAB-0043', 30, 1.4, 1.0, 12, 'confirmed', 40)
    on conflict do nothing;
  end if;

  -- Buyer: a mix so the marketplace shows verified (A/B) vs not-offered.
  if buy_org is not null then
    insert into batches (org_id, batch_ref, arsenic_total, arsenic_inorganic, foreign_matter, age_hours, measurement_conf, wet_mass_t)
    values
      (buy_org, 'CP-JAM-BUY-0051', 28, 1.2, 0.8, 10, 'confirmed', 80),   -- A verified
      (buy_org, 'CP-JAM-BUY-0052', 84, 11.8, 3.0, 18, 'confirmed', 60),  -- B verified
      (buy_org, 'CP-JAM-BUY-0053', 95, null, 4.0, 60, 'screened', 25)    -- unverified (not offered)
    on conflict do nothing;
  end if;

  -- Finance: verified batches = underwritable performance.
  if fin_org is not null then
    insert into batches (org_id, batch_ref, arsenic_total, arsenic_inorganic, foreign_matter, age_hours, measurement_conf, wet_mass_t)
    values
      (fin_org, 'CP-JAM-FIN-0061', 30, 1.5, 1.0, 14, 'confirmed', 120),  -- A verified
      (fin_org, 'CP-JAM-FIN-0062', 82, 9.5, 2.5, 20, 'confirmed', 90)    -- B verified
    on conflict do nothing;
  end if;
end $$;
