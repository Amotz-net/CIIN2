-- =====================================================================
-- Alert levels, a second channel for urgent alerts, and the daily summary.
--
--   urgent   sent at once by email AND by SMS or WhatsApp
--   action   sent at once by email: somebody has to do something
--   info     held for the daily summary: nothing to do, worth knowing
--
-- A person's phone number and choices are theirs alone: nobody else in their
-- organisation can read them.
--
-- Safe to run twice.
-- =====================================================================

alter table alerts add column if not exists level text not null default 'action';
alter table alerts drop constraint if exists alerts_level_check;
alter table alerts add constraint alerts_level_check check (level in ('urgent', 'action', 'info'));
alter table alerts drop constraint if exists alerts_status_check;
alter table alerts add constraint alerts_status_check
  check (status in ('queued', 'sent', 'failed', 'not_configured', 'held', 'summarised'));
create index if not exists alerts_profile_idx on alerts (profile_id, created_at desc);

create table if not exists alert_prefs (
  profile_id  uuid primary key references profiles (id) on delete cascade,
  phone       text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),   -- international form, e.g. +18765550123
  sms         boolean not null default false,
  whatsapp    boolean not null default false,
  summary     boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table alert_prefs enable row level security;
drop policy if exists prefs_own on alert_prefs;
create policy prefs_own on alert_prefs for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- A person sees the alerts sent to them. (Organisation-wide reading of the
-- alert log stays with the existing policy for administrators' use.)
drop policy if exists alerts_own on alerts;
create policy alerts_own on alerts for select using (profile_id = auth.uid());
