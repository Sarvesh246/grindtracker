-- Scheduled health retention. Per-user trimming already runs on every accepted
-- batch (migration 61); this covers users who stopped uploading, so raw samples,
-- batch receipts and expired insights never outlive their window. Sleep and daily
-- history are deliberately kept. Callable only by the service role (the cron route).
begin;

create index if not exists health_samples_end_at on public.health_samples(end_at);
create index if not exists health_batches_received on public.health_ingest_batches(received_at);

create or replace function public.health_retention_cleanup()
returns jsonb language plpgsql security definer set search_path = public as $$
declare samples_deleted integer; batches_deleted integer; insights_deleted integer;
begin
  delete from public.health_samples where end_at < now() - interval '180 days';
  get diagnostics samples_deleted = row_count;
  delete from public.health_ingest_batches where received_at < now() - interval '30 days';
  get diagnostics batches_deleted = row_count;
  delete from public.health_insights where expires_at < now();
  get diagnostics insights_deleted = row_count;
  return jsonb_build_object(
    'samples', samples_deleted, 'batches', batches_deleted, 'insights', insights_deleted
  );
end $$;
revoke all on function public.health_retention_cleanup() from public, anon, authenticated;
grant execute on function public.health_retention_cleanup() to service_role;

commit;
insert into public.grind_migrations (version) values ('63-health-retention') on conflict (version) do nothing;
