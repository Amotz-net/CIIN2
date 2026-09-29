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

-- Reminders and escalation, five minutes after the watcher.
-- Stop it with:  select cron.unschedule('ciin_remind_hourly');
select cron.schedule('ciin_remind_hourly', '12 * * * *', $cron$
  select net.http_post(
    url := 'https://oycflvlmfdosnmnhmguh.supabase.co/functions/v1/remind',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);

-- The daily summary, at 11:00 UTC: six in the morning in Jamaica.
-- Stop it with:  select cron.unschedule('ciin_summary_daily');
select cron.schedule('ciin_summary_daily', '0 11 * * *', $cron$
  select net.http_post(
    url := 'https://oycflvlmfdosnmnhmguh.supabase.co/functions/v1/summary',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);
