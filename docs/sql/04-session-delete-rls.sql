-- Allow users to discard in-progress workouts (delete own sessions + logs).
-- Run in Supabase SQL editor if discard appears to succeed but workouts still resume.

drop policy if exists "own sessions delete" on sessions;
create policy "own sessions delete"
  on sessions for delete
  using (auth.uid() = user_id);

drop policy if exists "own session logs delete" on session_logs;
create policy "own session logs delete"
  on session_logs for delete
  using (
    exists (
      select 1 from sessions
      where sessions.id = session_logs.session_id
        and sessions.user_id = auth.uid()
    )
  );

-- Record that this migration ran (needs 00-migration-tracking.sql).
insert into public.grind_migrations (version) values ('04-session-delete-rls') on conflict (version) do nothing;
