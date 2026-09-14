-- Run this once in the SQL Editor, AFTER the expiry-digest Edge Function
-- has been deployed (see SETUP.md section 9) and its secrets are set.
--
-- It schedules a weekly job that calls the function every Monday morning —
-- pg_cron runs in UTC, so "0 7 * * 1" is 7am UTC, which is 7am UK time in
-- winter (GMT) and 8am in summer (BST). Close enough for a weekly check;
-- adjust the "0 7 * * 1" if you'd rather it ran at a different time.
--
-- Replace YOUR-PROJECT-REF and YOUR-ANON-KEY below with your project's own
-- values (Settings -> API — the same two things already in
-- assets/supabase-config.js). The anon key here is fine and expected: it's
-- only proving to Supabase that this call is allowed to invoke the
-- function at all, same as it does for the website. The function's own
-- elevated access comes from the service_role key it reads from its own
-- environment, never from this key.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'weekly-expiry-digest',
  '0 7 * * 1',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.functions.supabase.co/expiry-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR-ANON-KEY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check it's registered:
--   select * from cron.job;
-- To see its run history:
--   select * from cron.job_run_details order by start_time desc limit 10;
-- To remove it (e.g. before re-creating with a different schedule):
--   select cron.unschedule('weekly-expiry-digest');
