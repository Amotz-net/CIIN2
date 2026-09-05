-- =====================================================================
-- CIIN — security fix (0009): profile INSERT privilege-escalation gap
-- Gap (decision note): profiles_insert only checked id = auth.uid(); a user
-- accepting an invite could POST is_platform_admin=true or an arbitrary org_id.
-- The existing escalation guard fired on UPDATE only, so INSERT was unguarded.
--
-- Fix: a BEFORE INSERT trigger that (1) forces is_platform_admin=false unless
-- the caller is already a platform admin, and (2) only allows an org_id the
-- caller was actually invited to (a pending invite for their email + that org).
-- =====================================================================

create or replace function guard_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := coalesce(auth.jwt() ->> 'email', '');
begin
  -- 1) no self-granted platform admin on insert
  if new.is_platform_admin is true and not is_platform_admin() then
    new.is_platform_admin := false;
  end if;

  -- 2) org_id must match a pending invite for this user's email, UNLESS the
  --    caller is a platform admin (who bootstraps orgs) or org_id is null.
  if new.org_id is not null and not is_platform_admin() then
    if not exists (
      select 1 from invitations i
      where i.org_id = new.org_id
        and lower(i.email) = lower(caller_email)
        and i.status = 'pending'
        and i.expires_at > now()
    ) then
      raise exception 'org_id % is not an organization you were invited to', new.org_id;
    end if;
    -- 3) level must match the invite's level (can't self-promote to org_admin)
    if new.level = 'org_admin' and not exists (
      select 1 from invitations i
      where i.org_id = new.org_id
        and lower(i.email) = lower(caller_email)
        and i.status = 'pending'
        and i.level = 'org_admin'
        and i.expires_at > now()
    ) then
      new.level := 'member';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_profile_insert on profiles;
create trigger trg_guard_profile_insert
  before insert on profiles
  for each row execute function guard_profile_insert();

-- Keep the insert policy as-is (id = auth.uid()); the trigger now enforces the
-- rest. Belt and suspenders: a user still can only insert THEIR OWN row.
