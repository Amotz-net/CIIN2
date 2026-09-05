-- =====================================================================
-- CIIN — Stage 2 (0007): seed representative Hotel operational data
-- All rows are labelled source='representative' so the UI shows them honestly.
-- Replace the org lookup below with your hotel org. This seeds ONE hotel org.
--
-- HOW TO RUN: set the hotel org name on the next line, then run the whole file.
-- =====================================================================

do $$
declare
  hotel_org uuid;
  seg_main  uuid;
  seg_cove  uuid;
  m1        uuid;
begin
  -- >>> EDIT THIS: the exact name of your hotel organization <<<
  select id into hotel_org from organizations
    where role = 'hotel' order by created_at limit 1;

  if hotel_org is null then
    raise notice 'No hotel org found — create one first (AdminOrgs). Seed skipped.';
    return;
  end if;

  -- beach segments
  insert into beach_segments (org_id, name, lat, lng, length_m)
    values (hotel_org, 'Long Bay — main frontage', 18.322, -78.353, 400)
    returning id into seg_main;
  insert into beach_segments (org_id, name, lat, lng, length_m)
    values (hotel_org, 'North cove', 18.328, -78.351, 180)
    returning id into seg_cove;

  -- sargassum arrivals (representative)
  insert into sargassum_arrivals (org_id, segment_id, tonnes, eta_at, severity, source) values
    (hotel_org, seg_main, 100.0, now() + interval '34 hours', 'high',   'representative'),
    (hotel_org, seg_cove,  35.0, now() + interval '41 hours', 'medium', 'representative');

  -- a mission against the property + its hub pool (representative)
  insert into missions (org_id, segment_id, title, tonnes, status, eta_at, access_state, source)
    values (hotel_org, seg_main, 'Long Bay main — inbound clearance', 100.0,
            'authority_approved', now() + interval '34 hours', 'pending', 'representative')
    returning id into m1;
  insert into mission_hubs (org_id, mission_id, hub_name, share_tonnes, distance_km, accepted) values
    (hotel_org, m1, 'Bloody Bay Collection Point', 60.0, 1.5, false),
    (hotel_org, m1, 'NEG01 Recovery Hub',          40.0, 4.3, false);

  -- a prior completed load with grade + closure + avoided cost (representative)
  insert into load_summaries (org_id, mission_id, grade, closure_pct, closure_state, recovered_t, avoided_cost, source)
    values (hotel_org, null, 'B', 9.0, 'conforming', 210.0, 142000.00, 'representative');

  raise notice 'Seeded representative hotel data for org %', hotel_org;
end $$;
