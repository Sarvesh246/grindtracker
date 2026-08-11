<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Learned User Preferences

- Do not commit `.cursor/hooks/state/continual-learning.json`; it is Cursor hook internal state, not app code.

## Learned Workspace Facts

- Production site: https://grindtrack.vercel.app/ (Vercel auto-deploys from `main`).
- GitHub repo: https://github.com/Sarvesh246/grindtracker.git (`main` branch).
- Last Workout panel must list exercises in the order they were logged (`session_logs.created_at`), not by set number.
- Workout discard requires Supabase delete RLS policies from `docs/sql/04-session-delete-rls.sql` to be applied.
- Production hardening (security/data-integrity RPCs, working-set completion gate, session write guards) lives in `docs/sql/20-production-hardening.sql`; past workout save/edit must use `upsert_past_session`, not client delete-then-insert of `session_logs`.
- Badge catalog objects must stay RSC-serializable: never put functions on `ALL_BADGES` (or pass them server→client); weight-threshold copy uses plain `weightLbs`/`weightKind` with `formatBadgeDescription()` at the call site.
- Web Push (subscriptions, prefs, scheduled sends) lives in `docs/sql/27-web-push.sql`; if an older 27 was already applied, also run `docs/sql/28-web-push-hardening.sql`. Setup/env notes are in `docs/PUSH.md` (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`).
- Vercel Hobby forbids sub-daily cron expressions; `vercel.json` fans out 24 once-daily UTC-hour jobs to `/api/cron/notifications` for roughly hourly coverage. Rest-end alerts must use in-page/local timers — Hobby cron is too coarse for short gym rests (locked-phone fallback only).
- iOS 26.5+/27 closed programmatic switch-click haptics; use `data-haptic` + mounted `HapticsSetup` overlay taps. Imperative `haptic()` still vibrates on Android but is a no-op for ticks on those iOS versions.
- First-run onboarding is a multi-step setup wizard (`src/components/setup/`, `/setup`) gated by `user_profiles.setup_completed_at` (migration `docs/sql/32-setup-completed.sql`); proxy + `grind_profile_ok` cookie use `s1:` once setup is done; complete via `POST /api/setup/complete`, clear via `POST /api/setup/replay`.
- "Replay Setup" in Profile settings is admin-only (`isAdmin` / `isAdminEmail`), same gate pattern as the feedback inbox — not shown to normal users.
- Profile (`/profile`) is the stats/dashboard surface; account preferences live at `/profile/settings`, opened from the profile header gear (not an inline settings stack on the dashboard).
