-- =====================================================================
-- CIIN — Stage 1 Row-Level Security
-- Rule of thumb: a user sees only their own organization's data;
-- the platform admin sees everything; nothing is public by default.
-- RLS is DENY-by-default once enabled — every allowed action needs a policy.
-- =====================================================================

alter table organizations enable row level security;
alter table profiles      enable row level security;
alter table invitations   enable row level security;

-- ---------- organizations ----------
-- Read: your own org, or any org if you are the platform admin.
create policy org_select on organizations
  for select using (
    id = current_org_id() or is_platform_admin()
  );

-- Insert: only the platform admin creates organizations.
create policy org_insert on organizations
  for insert with check ( is_platform_admin() );

-- Update: platform admin (any), or an org_admin editing their own org.
create policy org_update on organizations
  for update using (
    is_platform_admin() or (id = current_org_id() and is_org_admin())
  );

-- ---------- profiles ----------
-- Read: your own row, anyone in your org, or platform admin sees all.
create policy profiles_select on profiles
  for select using (
    id = auth.uid() or org_id = current_org_id() or is_platform_admin()
  );

-- Insert: a user may create only their OWN profile row (id must match auth.uid).
-- This is what the sign-up / accept-invite flow uses.
create policy profiles_insert on profiles
  for insert with check ( id = auth.uid() );

-- Update: your own row; org_admins may update members of their org;
-- platform admin any. (Column-level guards for is_platform_admin are handled
-- in app logic + a trigger below.)
create policy profiles_update on profiles
  for update using (
    id = auth.uid()
    or (org_id = current_org_id() and is_org_admin())
    or is_platform_admin()
  );

-- ---------- invitations ----------
-- Read: platform admin sees all; org_admins see their org's invites;
-- an invitee can look up their own invite by matching email.
create policy invites_select on invitations
  for select using (
    is_platform_admin()
    or (org_id = current_org_id() and is_org_admin())
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Insert: platform admin may invite anyone (i.e. new org-admins);
-- an org_admin may invite into their OWN org only.
create policy invites_insert on invitations
  for insert with check (
    is_platform_admin()
    or (org_id = current_org_id() and is_org_admin())
  );

-- Update (revoke / mark accepted): same authority as insert.
create policy invites_update on invitations
  for update using (
    is_platform_admin()
    or (org_id = current_org_id() and is_org_admin())
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- ---------- guard: prevent privilege escalation on profiles ----------
-- A non-platform-admin must not be able to set is_platform_admin = true on any row.
create or replace function guard_profile_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.is_platform_admin is distinct from old.is_platform_admin)
     and not is_platform_admin() then
    raise exception 'not authorized to change platform admin flag';
  end if;
  return new;
end;
$$;

create trigger trg_guard_profile_escalation
  before update on profiles
  for each row execute function guard_profile_escalation();
