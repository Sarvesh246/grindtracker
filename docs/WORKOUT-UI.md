# Offline sync and exercise rename vs swap

Moved out of [CLAUDE.md](../CLAUDE.md) to keep that file short; its text is unchanged. Section references like "Dates & timezones" or "Units" refer to CLAUDE.md.

## Offline & weak signal (src/lib/offline/, public/sw.js)
The app opens, starts a workout and logs sets with no connection; nothing the
user logged may be lost, and it syncs later on its own.
- **Opening offline:** `sw.js` keeps the last good HTML of `/home /log /progress
  /profile /leaderboard` in `grind-pages-v1` (network-first, 4s leash, keyed by
  pathname — `/log?day=x` is one client page). A daily `WARM_ROUTES` pass
  (ServiceWorkerRegister) saves the pages + their bundles. Sign-out wipes it
  (`clearOfflineCaches`). Bump the cache name if the cached-page shape changes.
- **Starting offline:** `ActiveWorkout.initSession` falls back to the device copy
  of the catalog/bests (`saveWorkoutSnapshot`, also fed by DaySelect) and mints a
  local session id (`localSession.ts`). The server row is created later
  (`sync.ts` → `start_or_resume_session`), queued ops are re-pointed
  (`remapQueuedSession`), and the old id keeps resolving via an alias.
- **Writes:** `withOfflineGate` makes `session_logs` writes fail instantly while
  offline / on a local-only session, so the existing queue path takes over (a
  local id would otherwise hit an FK error that reads as *permanent*).
  Everything queued lives in localStorage and survives a closed app.
- **Sync is deliberately gentle** (cellular + streaming apps share the radio):
  `flushQueuedOps` is single-flight per session, sends ONE bulk upsert, stops on
  the first transient error and times requests out; `OfflineSyncAgent` (app
  shell) retries with 5s→2min backoff, only while there is queued work, visible
  and online. Don't add polling or per-set requests to this path.

## Renaming vs. swapping an exercise (ActiveWorkout)
Each exercise card has two different tools, and the difference is the history:
- **Rename** (pencil, `RenameExerciseDialog.tsx`) updates `exercises.name` on the
  SAME row. The id never changes, so every `session_logs` row, PR bar, "prev"
  weight and Progress-page series follows the new name — nothing is copied or
  lost. Use it when it's the same lift under a better name ("DB Curl" → "DB Curl
  (per arm)"). It renames the exercise everywhere, past sessions included, and
  rejects a name already used by another exercise on that day.
- **Swap** (arrows) points the slot at a DIFFERENT `exercises` row (existing or
  newly created) and deletes this session's logs for the old one; the old row's
  history stays on the old exercise and the new one starts blank.
