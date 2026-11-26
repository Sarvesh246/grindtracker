begin;

-- Stats and badge functions call this with server-owned workout dates.
-- Browser and device clients have no reason to supply an arbitrary date span.
revoke execute on function public.grind_dates_connected(uuid, date, date) from public, anon, authenticated;

insert into public.grind_migrations (version) values ('87-internal-stats-permissions') on conflict (version) do nothing;

commit;
