-- Phase 46: stop a user from self-forging their own Coach proposal's outcome
-- Idempotent. Apply AFTER 45.
--
-- Bug: coach_action_proposals' "update own coach action proposals" RLS policy
-- (36-coach-actions.sql) let the row owner UPDATE status/result to anything,
-- because it only checked "is this my row" (auth.uid() = user_id), not which
-- transition was being made. The only other guard, the immutability trigger
-- (grind_guard_coach_proposal_immutable in 40-integrity-followups.sql),
-- pins payload/kind/user_id/conversation_id — never status or result.
--
-- /api/coach/actions itself writes status='executed' with a result payload
-- using the SAME per-user client (RLS-bound) a user could call directly via
-- PostgREST with their own JWT. Nothing distinguished "the route did this
-- legitimately after really running coach_correct_session_weights /
-- executeCreateDay / executeStartWorkout" from "the user PATCHed the row
-- straight to status='executed' with a made-up result — no mutation ever
-- ran." Self-scoped (a user can only lie to themselves about their own
-- proposal), but worth closing since 'executed' is meant to be a true claim
-- that a real weight/day/session change happened.
--
-- Fix: tighten the UPDATE policy so the authenticated role can only make the
-- transitions a user legitimately drives themselves — pending -> confirmed
-- (claim it, before executing), pending -> cancelled, and pending -> failed
-- (the expired-proposal path; harmless even if self-set, since it just
-- means "nothing happened"). Never pending/confirmed -> executed, and never
-- any transition once the row has left 'pending' at all. Only the SERVICE
-- ROLE — which bypasses RLS — can write status='executed'/'failed' for the
-- real completed-or-failed-mutation case; see the paired app change moving
-- every post-confirm updateCoachProposalStatus() call in
-- /api/coach/actions/route.ts onto createServiceClient().

drop policy if exists "update own coach action proposals" on coach_action_proposals;
create policy "update own coach action proposals"
  on coach_action_proposals for update
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status in ('confirmed', 'cancelled', 'failed'));
