-- =====================================================================
-- CIIN — fix (0008): EVERY user (including platform admin) landed on
-- "pending approval" because the profile query returned null.
-- Root cause: the profiles SELECT policy called current_org_id(), which
-- reads the profiles table from INSIDE a profiles policy — a self-reference
-- during policy evaluation that makes the SELECT fail/return empty. With no
-- profile, orgApproved() is false for everyone.
--
-- Fix: split the policy. A user reads their OWN row via a direct column
-- check (no function). Reading colleagues' rows uses a SECURITY DEFINER
-- helper that looks up the caller's org WITHOUT re-triggering RLS.
-- =====================================================================

-- Helper: caller's org_id, read with definer rights (bypasses RLS -> no recursion).
-- (current_org_id already exists and is SECURITY DEFINER, but calling it inside
--  the profiles policy still re-enters profiles under RLS in some planners.
--  We use a dedicated, clearly non-recursive lookup here.)
create or replace function my_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid()
$$;

drop policy if exists profiles_select on profiles;

-- 1) Always allow reading your own row — pure column check, no function, no recursion.
create policy profiles_select_self on profiles
  for select using ( id = auth.uid() );

-- 2) Allow reading other rows in your org, and platform admin sees all.
--    my_org() is SECURITY DEFINER so it does not re-enter RLS.
create policy profiles_select_org on profiles
  for select using (
    is_platform_admin() or org_id = my_org()
  );
