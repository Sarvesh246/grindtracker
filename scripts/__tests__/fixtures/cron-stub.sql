-- Job catalog for the scratch watch API database. Keeps scheduled commands
-- available for inspection without dispatching production HTTP requests.
create schema if not exists cron;
create table if not exists cron.job (
  jobid bigint generated always as identity primary key,
  jobname text unique not null,
  schedule text not null,
  command text not null
);

create or replace function cron.unschedule(text) returns boolean language sql as $$
  with removed as (delete from cron.job where jobname = $1 returning jobid)
  select exists(select from removed);
$$;

create or replace function cron.schedule(text, text, text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values ($1, $2, $3)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$$;
