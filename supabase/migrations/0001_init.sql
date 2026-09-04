-- =====================================================================
-- CIIN — Stage 1 schema: organizations, members, invitations, roles
-- Multi-tenant foundation. Every later table will carry org_id and RLS.
-- Run order: this file first (0001), then 0002_rls.sql, then 0003_seed.sql
-- =====================================================================

-- ---------- enums ----------
-- The eight CIIN roles (Public needs no login, so it is not an org type).
create type ciin_role as enum (
  'government',
  'hotel',
  'recovery_hub',
  'processor',
  'university_lab',
  'buyer',
  'finance'
);

-- Membership level within an organization.
create type member_level as enum (
  'org_admin',   -- the primary user; can invite others in their org
  'member'       -- ordinary member
);

-- Invitation lifecycle.
create type invite_status as enum (
  'pending',
  'accepted',
  'revoked',
  'expired'
);

-- ---------- organizations ----------
-- One row per real-world body: a hotel, a hub, a processor, a ministry, etc.
create table organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  role         ciin_role not null,          -- the org's type = its members' role
  country_code text not null default 'JM',  -- JM, BB, DO ... (multi-island)
  approved     boolean not null default false, -- CIIN platform admin approves orgs
  created_at   timestamptz not null default now()
);

-- ---------- profiles ----------
-- One row per authenticated user, linked 1:1 to Supabase auth.users.
-- A user belongs to exactly one organization (Stage 1 assumption).
-- is_platform_admin marks the CIIN super-user (sits above all orgs).
create table profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text,
  org_id            uuid references organizations (id) on delete set null,
  level             member_level not null default 'member',
  is_platform_admin boolean not null default false,
  created_at        timestamptz not null default now()
);

-- ---------- invitations ----------
-- The invite-only spine. CIIN admin invites org-admins; org-admins invite members.
create table invitations (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  org_id       uuid not null references organizations (id) on delete cascade,
  level        member_level not null default 'member',
  status       invite_status not null default 'pending',
  token        uuid not null default gen_random_uuid(), -- emailed link token
  invited_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '14 days')
);

create index invitations_email_idx on invitations (lower(email));
create index invitations_token_idx on invitations (token);
create index profiles_org_idx      on profiles (org_id);

-- ---------- helper functions (used by RLS policies) ----------
-- Return the caller's org_id. SECURITY DEFINER so it can read profiles
-- without tripping the very policies it supports (avoids recursion).
create or replace function current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid()
$$;

create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_admin from profiles where id = auth.uid()), false)
$$;

create or replace function is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select level = 'org_admin' from profiles where id = auth.uid()), false)
$$;
