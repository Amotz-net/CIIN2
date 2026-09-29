-- DEV ONLY. Not a migration: the address is the dev project's.
-- Puts the watcher on an hourly timer. The watcher is deployed without token
-- checking, so the schedule carries no key.
-- Stop it with:  select cron.unschedule('ciin_watch_hourly');
select cron.schedule('ciin_watch_hourly', '7 * * * *', $cron$
  select net.http_post(
    url := 'https://oycflvlmfdosnmnhmguh.supabase.co/functions/v1/watch',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);
