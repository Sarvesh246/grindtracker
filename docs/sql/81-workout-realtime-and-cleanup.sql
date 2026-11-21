-- Refresh active Home/Progress views when a workout completes on another client.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'sessions') then
    alter publication supabase_realtime add table public.sessions;
  end if;
end;
$$;

create or replace function public.delete_my_grind_data()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  perform public.delete_health_history();
  perform public.delete_my_grind_data_before_health();
  delete from grind_private.watch_workout_batches where user_id = auth.uid();
end;
$$;
revoke all on function public.delete_my_grind_data() from public, anon;
grant execute on function public.delete_my_grind_data() to authenticated;

insert into public.grind_migrations (version) values ('81-workout-realtime-and-cleanup') on conflict (version) do nothing;
