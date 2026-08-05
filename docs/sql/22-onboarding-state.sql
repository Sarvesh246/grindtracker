-- Phase 22: server-side onboarding state.
-- Idempotent: safe to re-run.
--
-- WHY THIS EXISTS
-- ---------------
-- The first-time-user tour/tooltip "seen" flags (migration-less commit
-- a750e98) lived only in browser localStorage, keyed grind_onboarding_{userId}.
-- That ties "have I seen this" to one browser's storage rather than the
-- account: private browsing, a cleared-site-data event, or the installed PWA
-- (a separate storage partition from the website on some platforms) all read
-- back empty, so the walkthrough resurfaces on what the user experiences as
-- just "signing back in". Every other piece of account state in this app is
-- server-authoritative (see CLAUDE.md); onboarding should be too.
--
-- These columns are owner-writable through the SAME row-level policy that
-- already lets a user update their own username (see ProfileDashboard's
-- `.from('user_profiles').update(...).eq('id', user.id)`) — no new RLS
-- policy needed, new columns on an existing row are covered by the existing
-- per-row check.

alter table user_profiles
  add column if not exists onboarding_tours_seen text[] not null default '{}',
  add column if not exists onboarding_tooltips_seen text[] not null default '{}',
  add column if not exists onboarding_skip_all boolean not null default false;
