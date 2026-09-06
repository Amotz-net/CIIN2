-- =====================================================================
-- CIIN — Stage 3 (0012): seed a Government organization for Jamaica
-- So there is a Government-role org to sign into and exercise the jurisdiction
-- view. It reads all JM orgs' operational data via the 0011 cross-org policy.
-- Approve it so it isn't gated. Invite its admin from the platform-admin console
-- (AdminOrgs) OR promote an existing user in SQL (see 0003_seed pattern).
-- =====================================================================

insert into organizations (name, role, country_code, approved)
values ('Jamaica Coastal Authority', 'government', 'JM', true)
on conflict do nothing;

-- To sign in as this Government org, either:
--   (a) In the app as platform admin, create an invite for this org, OR
--   (b) Promote an existing auth user to it in SQL:
--
-- update profiles
--   set org_id = (select id from organizations where name = 'Jamaica Coastal Authority' limit 1),
--       level = 'org_admin'
--   where id = (select id from auth.users where email = 'YOUR-GOV-TEST-EMAIL');
