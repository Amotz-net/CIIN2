-- =====================================================================
-- Track who has seen the guided tour.
--
-- One nullable timestamp, on the profile rather than in browser storage: an
-- operator who signs in from the beach on a phone and later from the office
-- should not be walked through the same tour twice. profiles_update already
-- permits id = auth.uid(), so a user can mark their own completion.
-- NULL means "has not finished the tour" — the tour then runs on first landing.
-- =====================================================================

alter table profiles add column if not exists onboarded_at timestamptz;

comment on column profiles.onboarded_at is
  'When this user completed or skipped the guided tour. NULL = show it on next '
  'landing. Cleared to replay the tour for someone.';
