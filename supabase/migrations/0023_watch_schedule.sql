-- =====================================================================
-- Put the watcher on a timer.
--
-- RUN THIS LAST. It makes the mission origin live: from the moment it is
-- applied, the watcher raises real missions against real segments on a
-- schedule. Apply 0021 (decision chain) and 0022 (hub capacity) first, or the
-- watcher will run against tables that do not exist yet.
--
-- Hourly is deliberate. The AFAI product is a 7-day composite and the drift
-- feed a near-real-time current field, so polling faster would add load without
-- adding information; polling slower risks missing the front edge of an
-- arrival. The watcher is idempotent per segment — it will not raise a second
-- mission while one is still open — so an extra run costs nothing.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The service role key is read from Vault rather than written into the schedule,
-- so it never appears in cron.job or in a migration committed to git.
-- Set it once (Supabase dashboard → Project Settings → Vault):
--   name: ciin_service_role_key   secret: <the service role key>
do $$
declare
  v_url text := current_setting('app.settings.supabase_url', true);
begin
  if not exists (select 1 from cron.job where jobname = 'ciin_watch_hourly') then
    perform cron.schedule(
      'ciin_watch_hourly',
      '7 * * * *',                       -- :07 past the hour, off the round-hour rush
      $cron$
      select net.http_post(
        url     := (select decrypted_secret from vault.decrypted_secrets where name = 'ciin_functions_url') || '/watch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ciin_service_role_key')
        ),
        body    := '{}'::jsonb
      );
      $cron$
    );
  end if;
end $$;

comment on extension pg_cron is
  'Runs the CIIN watcher hourly. Unschedule with: select cron.unschedule(''ciin_watch_hourly'');';
