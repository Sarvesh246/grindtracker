<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Learned User Preferences

- Do not commit `.cursor/hooks/state/` continual-learning hook state (e.g. `continual-learning.json`); it is Cursor internal state, not app code.
- Primary daily use is iOS PWA (Add to Home Screen); optimize UX feedback for that path (real-tap `data-haptic`), not Android-only vibrate.
- Haptics should feel satisfying but tasteful: light for routine controls; heavier feel on set-complete, saves, and confirms — do not overdo.
- Coach G orb should always stay a circle (no square morph) and must not rotate while dragging; prefer slower Apple-like fluid motion over snappy/fast transitions.
- Coach sheet drag is two-stage (partial drag minimizes, further drag closes) and should track the finger fluidly without mid-close flashes or minimized-sheet pop-ins; backdrop blur stays until fully closed.
- On iOS PWA, opening the coach may tint the status bar / `theme-color`, but closing it must fully restore the main app background color (no stuck olive/surface chrome).
- In expanded Coach page mode, keep the header visible when the keyboard opens — shrink/compress from the bottom so the composer sits above the keyboard (do not translate the whole sheet up).
- Landing workout demos should mirror real ActiveWorkout set rows: identical LBS/REPS input sizes with the PR badge overlaid, not shrunk inputs.

## Learned Workspace Facts

- Production site: https://grindtrack.vercel.app/ auto-deploys from `main` (https://github.com/Sarvesh246/grindtracker.git).
- Last Workout panel must list exercises in the order they were logged (`session_logs.created_at`), not by set number.
- Workout discard needs Supabase delete RLS from `docs/sql/04-session-delete-rls.sql`; production hardening and past save/edit via `upsert_past_session` live in `docs/sql/20-production-hardening.sql` (never client delete-then-insert of `session_logs`).
- Rest weekday removals soft-end with `effective_until` (`docs/sql/43-rest-weekday-history.sql`) so past scheduled rest still counts for streaks; do not DELETE `user_rest_days` rows that already covered history.
- Badge catalog objects must stay RSC-serializable: never put functions on `ALL_BADGES` (or pass them server→client); weight-threshold copy uses plain `weightLbs`/`weightKind` with `formatBadgeDescription()` at the call site.
- Web Push (subscriptions, prefs, scheduled sends) lives in `docs/sql/27-web-push.sql`; if an older 27 was already applied, also run `docs/sql/28-web-push-hardening.sql`. Setup/env notes are in `docs/PUSH.md`.
- Vercel Hobby forbids sub-daily cron expressions; `vercel.json` fans out 24 once-daily UTC-hour jobs to `/api/cron/notifications` for roughly hourly coverage. Rest-end alerts must use in-page/local timers — Hobby cron is too coarse for short gym rests.
- iOS 26.5+/27 closed programmatic switch-click haptics; use `data-haptic` + mounted `HapticsSetup` overlay taps. Imperative `haptic()` still vibrates on Android but is a no-op for ticks on those iOS versions.
- First-run onboarding is a multi-step setup wizard (`src/components/setup/`, `/setup`) gated by `user_profiles.setup_completed_at` (migration `docs/sql/32-setup-completed.sql`); proxy + `grind_profile_ok` cookie use `s1:` once setup is done; complete via `POST /api/setup/complete`, clear via `POST /api/setup/replay`. "Replay Setup" in Profile settings is admin-only (`isAdmin` / `isAdminEmail`), same gate pattern as the feedback inbox.
- Profile (`/profile`) is the stats/dashboard surface; account preferences live at `/profile/settings`, opened from the profile header gear (not an inline settings stack on the dashboard).
- AI Coach (floating G orb + sheet under `src/components/coach/`) is Gemini-backed; default model `gemini-3.5-flash-lite` via `GEMINI_MODEL` / `COACH_DEFAULT_MODEL` (see `docs/COACH.md`); schema in `docs/sql/33-coach.sql`–`35-coach-conversations.sql`; standard users get 15 messages per rolling 24h with reset copy, admin/dev can bypass the app cap (show Unlimited/dev without a fake N/15 remaining); coach “today” must use the user’s local timezone.
- Marketing landing at `/` for logged-out visitors (`src/components/landing/`); signed-in `/` redirects to `/home` (proxy keeps exact `/` public). Landing demos are CSS-only and should reuse real `BadgeIcon` / badge ids.
- iOS cannot open Add to Home Screen programmatically; Install CTAs use Web Share / `beforeinstallprompt` / scroll-to-`#install` fallback (`src/components/landing/installApp.ts`).
