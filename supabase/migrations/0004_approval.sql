-- =====================================================================
-- CIIN — Stage 1 corrections (per Master Spec v1.3 §11.3)
-- Approval gates the ORG (via its admin). Members auto-approve via invite
-- and inherit the org's status. Revocation cascades: access is evaluated
-- LIVE against the org's current approved flag, not a cached per-member flag.
-- =====================================================================

-- ---------- approval is auditable ----------
alter table organizations
  add column if not exists approved_by uuid references profiles (id),
  add column if not exists approved_at timestamptz;

-- ---------- live "is my org approved?" check (for RLS on operational data) ----------
-- SECURITY DEFINER so it can read organizations without recursing through
-- the very policies it supports. Returns true only if the caller's org exists
-- and is currently approved. Platform admin is always considered approved.
create or replace function my_org_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    is_platform_admin()
    or exists (
      select 1
      from organizations o
      join profiles p on p.org_id = o.id
      where p.id = auth.uid() and o.approved = true
    ),
    false
  )
$$;

-- Keep approved_by / approved_at in step with the approved flag automatically.
create or replace function stamp_org_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approved is distinct from old.approved then
    if new.approved then
      new.approved_by := auth.uid();
      new.approved_at := now();
    else
      -- revocation: clear the stamp so the record reflects current state
      new.approved_by := null;
      new.approved_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_org_approval on organizations;
create trigger trg_stamp_org_approval
  before update on organizations
  for each row execute function stamp_org_approval();
