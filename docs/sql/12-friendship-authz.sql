-- Phase 12: fix friendship authorization + tighten profile reads.
-- Idempotent: safe to re-run.
--
-- WHY THIS EXISTS
-- ---------------
-- `friendships` had ONE policy covering every command:
--
--     create policy friendships_own on friendships for ALL
--       using (requester_id = auth.uid() or addressee_id = auth.uid());
--
-- A single permissive test for INSERT, UPDATE and DELETE means "I am involved
-- in this row" is treated as "I may do anything to this row". Two consequences:
--
--   1. SELF-ACCEPT. Send a request, then update your own row to
--      status='accepted'. The USING clause passes because you are the requester.
--
--   2. FABRICATION. Insert {requester_id: <victim>, addressee_id: <you>,
--      status: 'accepted'} directly. WITH CHECK passes because you are the
--      addressee. You are now the victim's "friend" and they never acted.
--
-- This is not cosmetic: `get_leaderboard` (migration 10) authorizes on
-- `status = 'accepted'`, so anyone able to mint their own acceptance can still
-- read any user's stats. **Migration 10 does not actually close that hole until
-- this migration is applied.**
--
-- The fix splits the policy by command so each one asserts the right thing:
--   INSERT — only as yourself, only as 'pending', never to yourself
--   UPDATE — only the ADDRESSEE, only pending -> accepted
--   DELETE — either party (decline / cancel / unfriend all use DELETE)
--   SELECT — either party (unchanged)

begin;

-- ── Friendships ─────────────────────────────────────────────────────────────

drop policy if exists friendships_own on friendships;
drop policy if exists "friendships_own" on friendships;

-- Read: both parties can see the row.
drop policy if exists friendships_select on friendships;
create policy friendships_select
  on friendships for select
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Create: you may only ever create a PENDING request in which YOU are the
-- requester. Self-friending is rejected outright (it would grant a trivially
-- self-approved row).
drop policy if exists friendships_insert on friendships;
create policy friendships_insert
  on friendships for insert
  with check (
    requester_id = auth.uid()
    and addressee_id <> auth.uid()
    and status = 'pending'
  );

-- Accept: ONLY the addressee, and only pending -> accepted. The requester has
-- no UPDATE path at all, which is what kills self-accept. Restricting the
-- WITH CHECK to 'accepted' also stops an accepted row being walked back to
-- 'pending' and re-accepted, or moved to some other status entirely.
drop policy if exists friendships_update on friendships;
create policy friendships_update
  on friendships for update
  using      (addressee_id = auth.uid() and status = 'pending')
  with check (addressee_id = auth.uid() and status = 'accepted');

-- Remove: either party. Covers declining a request, cancelling one you sent,
-- and unfriending — all of which the client implements as DELETE.
drop policy if exists friendships_delete on friendships;
create policy friendships_delete
  on friendships for delete
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Constrain status at the column level too, so a bad value can't be written
-- even through a future policy mistake.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'friendships_status_valid') then
    begin
      alter table friendships
        add constraint friendships_status_valid
        check (status in ('pending','accepted'));
    exception when check_violation then
      raise warning 'Skipped friendships_status_valid: existing rows have other statuses. Clean up and re-run.';
    end;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'friendships_no_self') then
    begin
      alter table friendships
        add constraint friendships_no_self
        check (requester_id <> addressee_id);
    exception when check_violation then
      raise warning 'Skipped friendships_no_self: self-friendship rows exist. Delete them and re-run.';
    end;
  end if;
end $$;

-- One relationship per pair, in either direction. Without this, a user can
-- spam the same person with unlimited requests (or hold A->B and B->A at once,
-- which makes the accordion show duplicates). Created guarded because existing
-- duplicates would abort it.
do $$
begin
  begin
    create unique index if not exists friendships_pair_uniq
      on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
  exception when unique_violation then
    raise warning 'Skipped friendships_pair_uniq: duplicate pairs exist. Dedupe and re-run.';
  end;
end $$;

-- ── Profile reads ───────────────────────────────────────────────────────────
-- `profiles_read_all` was `SELECT true` with no role restriction, so it applied
-- to `public` — meaning an UNAUTHENTICATED request carrying only the publishable
-- key could dump every username, display name and avatar in the database.
--
-- Still readable by every signed-in user, because username search has to work.
-- The narrowing is anon -> authenticated, not a per-row restriction.

drop policy if exists profiles_read_all on user_profiles;
create policy profiles_read_all
  on user_profiles for select
  to authenticated
  using (true);

commit;

-- ── Verification ────────────────────────────────────────────────────────────
-- Run as a normal (non-admin) signed-in user. All three must fail.
--
--   -- 1. self-accept: should report 0 rows updated
--   update friendships set status='accepted'
--    where requester_id = auth.uid() and status='pending';
--
--   -- 2. fabricated friendship: should raise a policy violation
--   insert into friendships (requester_id, addressee_id, status)
--   values ('<someone-elses-uuid>', auth.uid(), 'accepted');
--
--   -- 3. anon profile dump: run with the publishable key and NO session,
--   --    should return zero rows
--   --    curl "$SUPABASE_URL/rest/v1/user_profiles?select=username" -H "apikey: $ANON"
