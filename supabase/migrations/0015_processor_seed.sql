-- =====================================================================
-- CIIN — Processor: seed a Processor org with its own batches so the
-- certification dashboard (status derived from evidence + passports + usage) has
-- real own-org data. Certification status is COMPUTED from these grades in-app,
-- not stored — matching CIIN's "certification rests on graded evidence" thesis.
-- =====================================================================

do $$
declare proc_org uuid;
begin
  insert into organizations (name, role, country_code, approved)
  values ('Negril Bioprocessing Ltd', 'processor', 'JM', true)
  on conflict do nothing;

  select id into proc_org from organizations where name = 'Negril Bioprocessing Ltd' limit 1;
  if proc_org is null then return; end if;

  -- A mix of batches so the passport/usage story is rich:
  -- one A (confirmed clean), one B, one screened-A (agri gated), one FAIL (broken chain).
  insert into batches (org_id, batch_ref, arsenic_total, arsenic_inorganic,
                       foreign_matter, age_hours, chain_valid, signature_valid,
                       measurement_conf, wet_mass_t)
  values
    (proc_org, 'CP-JAM-NEG01-0031', 30, 1.4, 1.0, 12, true,  true,  'confirmed', 120),  -- A verified
    (proc_org, 'CP-JAM-NEG01-0032', 84, 11.8, 3.0, 18, true, true,  'confirmed', 90),   -- B
    (proc_org, 'CP-JAM-NEG01-0033', 8,  null, 1.5, 20, true, true,  'screened',  40),   -- A screened (agri gated)
    (proc_org, 'CP-JAM-NEG01-0034', 30, 1.4, 1.0, 12, false, true,  'confirmed', 30)    -- FAIL broken chain
  on conflict do nothing;
end $$;
