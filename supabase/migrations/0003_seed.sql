-- =====================================================================
-- CIIN — Stage 1 seed
-- IMPORTANT: you cannot create an auth user from SQL alone. The flow is:
--   1) Sign up ONE user through the app (or Supabase Auth dashboard) using
--      the email you want as the CIIN platform admin.
--   2) Find that user's id in Authentication -> Users (copy the UUID).
--   3) Run the statements below with that UUID pasted in.
-- This bootstraps the super-user who can then approve orgs and invite others.
-- =====================================================================

-- (A) Create the CIIN operating organization (optional but tidy).
insert into organizations (name, role, country_code, approved)
values ('CIIN Platform', 'government', 'JM', true)
on conflict do nothing;

-- (B) Promote your signed-up user to platform admin.
-- Replace 'PASTE-USER-UUID-HERE' with the UUID from Authentication -> Users.
--
-- update profiles
--   set is_platform_admin = true,
--       level = 'org_admin',
--       full_name = 'CIIN Administrator'
--   where id = 'PASTE-USER-UUID-HERE';
--
-- After this runs, that account is the super-user. Everyone else joins by invite.
