# GRIND watch API (v1)

The HTTP API a Garmin Connect IQ app uses to fetch today's workout and upload
logged sets. Everything a client needs is on this page.

- Base URL: `https://grindtrack.vercel.app/api/watch/v1`
- Transport: HTTPS only, JSON in and out (`Content-Type: application/json`).
- Code: `src/app/api/watch/v1/*` (routes), `src/lib/watch/*` (handlers,
  validation), `docs/sql/58-watch-api.sql` (tables + RPCs).

| Endpoint | Purpose |
| --- | --- |
| `GET /ping` | Auth + connectivity check, returns server time |
| `GET /today` | Today's planned workout, compact |
| `POST /sessions` | Idempotent upload of a session and any of its sets |

## Auth

1. In GRIND: **Profile → Settings → Watch**, name the device, tap **Generate
   token**. The token is shown **once**; copy it into the watch app's settings
   (e.g. a Connect IQ app setting the user pastes in Garmin Connect).
2. The watch sends it on every request:

   ```
   Authorization: Bearer gwt_<64 lowercase hex chars>
   ```

- A token is `gwt_` + 64 hex characters (68 total). Anything else is rejected
  without a database lookup.
- The server stores only `sha256(token)`. Lost token → generate a new one and
  revoke the old device. Revoking takes effect on the next request.
- The user id is **never** sent by the client; it comes from the token.
- Each successful request updates the device's "last used" time in Settings.
- Up to 10 active devices per account.

| Status | `error.code` | Meaning | Watch should |
| --- | --- | --- | --- |
| 401 | `missing_token` | No `Authorization` header | Ask the user to pair |
| 401 | `invalid_token` | Malformed or unknown token | Ask the user to pair |
| 401 | `token_revoked` | Revoked in Settings | Ask the user to pair again |
| 429 | `rate_limited` | Over 60 requests/minute for this device | Wait `Retry-After` seconds |

## Errors

Every failure has the same body:

```json
{ "error": { "code": "validation_failed", "message": "sets.0.reps: Too small: expected number to be >=0" } }
```

`validation_failed` also carries `details`: `[{ "path": "sets.0.reps", "message": "..." }]`.
Treat `code` as the stable contract; `message` is for logs and may change.

| Status | Codes | Retry? |
| --- | --- | --- |
| 400 | `invalid_json` | No — fix the payload |
| 401 | `missing_token`, `invalid_token`, `token_revoked` | No — re-pair |
| 409 | `session_id_conflict`, `open_session_conflict`, `day_already_logged` | See `POST /sessions` |
| 413 | `payload_too_large` | Split the sets over several requests |
| 422 | `validation_failed`, `unknown_workout`, `workout_required`, `no_working_sets` | No — fix the payload |
| 429 | `rate_limited` | Yes, after `Retry-After` |
| 500 | `internal_error` | Yes, with backoff |
| 503 | `service_unavailable` | Yes, after `Retry-After` |

Connect IQ also reports **negative** response codes when the request never
reached the server (e.g. `-104` phone not connected, `-300` timeout,
`-400` invalid response body). Those are always "keep the data, retry later".

All responses carry `Cache-Control: no-store`.

## GET /ping

```
GET /api/watch/v1/ping
Authorization: Bearer gwt_…
```

`200`:

```json
{ "ok": true, "api_version": 1, "server_time": "2026-11-16T18:04:05.123Z", "device": "Fenix 7" }
```

Use `server_time` to detect a badly wrong watch clock before uploading.

## GET /today

Query parameters (all optional):

| Param | Example | Meaning |
| --- | --- | --- |
| `date` | `2026-11-16` | The watch's local date. Clamped server-side to UTC today ±1. |
| `utc_offset_seconds` | `-18000` | Used when `date` is absent, to work out the local date. |
| `unit` | `kg` | Unit for `weight` in the response. Default `lbs`. |
| `day` | `pull` | A day id from `days` (below): return that day's exercises instead of the up-next one. An unknown or disabled day is ignored (you get the up-next day, not an error). Honored on rest days too. |

Send `date` from the watch clock (`Gregorian.info(Time.now(), …)`); without
it the server falls back to the user's saved push timezone, then UTC.

The workout is whatever GRIND's Home screen shows as **up next** (the user's
rotation, skipping disabled days), unless today is one of their rest days.
`days` lists every enabled day in rotation order so the watch can let the user
pick another one; fetch it with `?day=<id>`. Only the chosen day's exercises
are sent, which keeps the payload small.

`200` with a workout:

```json
{
  "date": "2026-11-16",
  "unit": "lbs",
  "workout": {
    "id": "push",
    "name": "Push",
    "exercises": [
      { "id": "3f0e1c7a-6a8b-4f1e-9a43-2c8d6b1f0e55", "name": "Bench Press", "sets": 3, "reps": 8, "reps_max": 12, "weight": 135, "rest": 120 },
      { "id": "9b2d4e10-1c3f-4a5b-8d7e-6f1a2b3c4d5e", "name": "Overhead Press", "sets": 3, "reps": 6, "reps_max": null, "weight": null, "rest": null }
    ]
  },
  "days": [{ "id": "pull", "name": "Pull" }, { "id": "push", "name": "Push" }, { "id": "legs", "name": "Legs" }]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `days[]` | array | Every enabled day, rotation order, at most 14. `id` is what `?day=` takes. Present whenever there is at least one day, including on rest days. |
| `workout.id` | string | The GRIND day key. Send it back as `workout_id`. |
| `exercises[]` | array | Plan order. At most 20. |
| `id` | UUID | Send back as a set's `exercise_id`. |
| `name` | string | At most 32 characters (longer names end in `…`). |
| `sets` | int | Target sets. |
| `reps` | int \| null | Target reps, or the low end of a range; null for non-numeric targets ("AMRAP"). |
| `reps_max` | int \| null | High end of a range ("8-12" → 12), else null. |
| `weight` | number \| null | In `unit`, 0.1 precision. The exercise's target weight, else the last weight used; null if neither. |
| `rest` | int \| null | Seconds after a working set; null = use the watch's default. |

`200` with nothing planned:

```json
{ "date": "2026-11-16", "unit": "lbs", "workout": null, "reason": "rest_day", "days": [{ "id": "pull", "name": "Pull" }] }
```

`reason` is `rest_day` (a scheduled or one-off rest day; `days` is still sent
so the user can train anyway) or `no_plan` (the user has no enabled days yet,
so there is no `days`). Payloads are well under 4 KB (20 exercises with
32-character names ≈ 3 KB); a test enforces the 4 KB budget.

Every `200` also carries `body` (GRIND Body, migration 59), or `null` when it
can't be read:

```json
"body": { "charge": { "score": 72, "band": "primed", "label": "Primed", "advice": "Push your top sets" }, "smart_rest": false }
```

`charge` is null with fewer than two inputs (see `src/lib/body/charge.ts`);
`advice` is at most ~20 characters. `smart_rest` is the user's Settings → Watch
switch. Older watch builds ignore the field.

Since migration 68, `body` also carries `hrv`: `{ low, high, days, today,
status }`, the usual readiness-check range in ms (null until 5 mornings), and
`lift`: `{ advice: "deload" | "push", headline, percent }` when lifting load
advice fired, else null. Each exercise may carry `tune`, the rep counter
settings learned from the user's own sets of it (`ac`, `cv`, `swing`, `lag`;
only valid, in-range keys; absent = defaults). See `src/lib/reps/tuning.ts`.

## POST /sessions

Upload a session — finished or not — and any of its sets. Call it as often as
you like: after each set, on finishing, or once at the end. Re-sending the same
data is always safe.

```
POST /api/watch/v1/sessions
Authorization: Bearer gwt_…
Content-Type: application/json
```

```json
{
  "id": "6c1f2a9e-0d4b-4c7e-9f3a-5b8e2d1c0a7f",
  "workout_id": "push",
  "started_at": "2026-11-16T17:00:00Z",
  "ended_at": "2026-11-16T17:52:30Z",
  "utc_offset_seconds": -18000,
  "heart_rate": { "avg": 128, "max": 171 },
  "calories": 410,
  "sets": [
    {
      "id": "a3e1d6c2-7b9f-4e08-b1a5-0c4d2e6f8a91",
      "exercise_id": "3f0e1c7a-6a8b-4f1e-9a43-2c8d6b1f0e55",
      "set_number": 1,
      "reps": 8,
      "weight": 61.2,
      "unit": "kg",
      "completed_at": "2026-11-16T17:05:12Z",
      "rest_seconds": 120,
      "is_warmup": false
    }
  ]
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `id` | yes | UUID the **watch generates once** per workout and keeps for every upload of it |
| `workout_id` | no | `workout.id` from `/today`. When absent, the day of the first set's exercise is used. Ignored after the session exists |
| `started_at` | yes | ISO 8601. Send UTC (`…Z`); offsets are accepted and converted |
| `ended_at` | no | ISO 8601, ≥ `started_at`. Present = the workout is finished |
| `utc_offset_seconds` | no | Watch's UTC offset, −50400…50400 (`System.getClockTime().timeZoneOffset`). Decides which calendar day the workout counts for in streaks. Send it |
| `heart_rate.avg`, `.max` | no | int 20–250 |
| `calories` | no | int 0–20000 |
| `sets` | no | 0–200 sets. May be empty (e.g. a "finish" upload) |
| `sets[].id` | yes | UUID the watch generates once per set |
| `sets[].exercise_id` | yes | An exercise id from `/today` |
| `sets[].set_number` | yes | int 1–100, unique per exercise within the session |
| `sets[].reps` | yes | int 0–1000 |
| `sets[].weight` | yes | number 0–2000, in `unit`. Bodyweight = 0 |
| `sets[].unit` | yes | `"lbs"` or `"kg"` |
| `sets[].completed_at` | yes | ISO 8601 |
| `sets[].rest_seconds` | no | int 0–3600, rest taken before this set |
| `sets[].is_warmup` | no | default false. Warm-ups don't count for XP or PRs |
| `sets[].hr_peak`, `.hr_end` | no | int 20–250. Peak HR around the set, and HR when it was logged |
| `sets[].hr_rest_drop_60` | no | int −100–200. How far HR fell 60 s into the following rest |
| `hr.trace` | no | Up to 43,200 ints 0–250, one reading per `hr.step` s from `started_at`; 0 = no reading |
| `hr.trace_b64` | no | The same trace as one byte a reading, base64 (a byte over 250 = no reading). Wins over `trace`. Builds from 2026-11-18 send this at `step` 1; a 1 s trace as JSON numbers is too big a request for the watch. Over 8,640 readings needs migration 70 |
| `hr.step` | no | int 1–60, default 5 |
| `hr.zones` | no | 5–6 ints: zone 1–5 floors (+ max) from the watch's profile |
| `hr.zone_seconds` | no | exactly 5 ints, seconds spent in zones 1–5 |
| `hr.training_effect` | no | number 0–5 |

Heart-rate fields are display and advice only (never XP, PRs or the
leaderboard). They are stored after the session by
`watch_store_session_body`; if that fails the upload still succeeds. Send `hr`
with every request of a finished workout: it overwrites, so retries are safe. A
2-hour trace with 40 sets is about 12 KB.

Also rejected with `validation_failed`: unknown fields, two sets with the same
`id` or the same (`exercise_id`, `set_number`) in one request, any timestamp
more than 5 minutes in the future or more than 730 days old. The body must be at
most 64 KB (≈ 200 sets).

### Response

`201` when this request created the session, `200` when it already existed:

```json
{
  "session": {
    "id": "6c1f2a9e-0d4b-4c7e-9f3a-5b8e2d1c0a7f",
    "workout_id": "push",
    "status": "completed",
    "created": false,
    "completed_now": true,
    "started_at": "2026-11-16T17:00:00+00:00",
    "completed_at": "2026-11-16T17:52:30+00:00",
    "local_date": "2026-11-16",
    "xp_earned": 140
  },
  "sets": {
    "accepted": ["a3e1d6c2-7b9f-4e08-b1a5-0c4d2e6f8a91"],
    "updated": [],
    "duplicate": [],
    "rejected": []
  },
  "stats": { "xp_total": 5230, "level": 12, "current_streak": 9, "pr_count": 1 },
  "new_badges": ["early_bird"]
}
```

- `session.status`: `open` or `completed`. `completed_now` is true only on the
  request that finished it.
- `stats` is null while the session is open (XP is only earned on finish).
  `new_badges` is `[]` unless this request finished the session.
- Each set id lands in exactly one list:

| List | Meaning | Watch should |
| --- | --- | --- |
| `accepted` | New, stored | Mark synced |
| `duplicate` | Already stored with identical values | Mark synced |
| `updated` | Already stored, values changed and saved (an edit on the watch) | Mark synced |
| `rejected` | Not stored: `[{ "id", "code", "message" }]` | Mark failed; don't resend unchanged |

Rejected set codes: `unknown_exercise` (not one of this account's exercises),
`set_number_taken` (another set already uses that exercise + set number in this
session, e.g. logged in the web app), `set_id_conflict` (the id belongs to a
different session — generate a new UUID). A rejected set never fails the
request; the other sets still apply.

### Idempotency

Session and set ids are the database primary keys, so nothing is ever stored
twice:

- Same session id again → the existing session is updated, never duplicated
  (`201` the first time, `200` after).
- Same set id again → `duplicate` (or `updated` if its values changed).
- Same `ended_at` again → no second completion, no extra XP.
- Concurrent uploads of the same session are serialized server-side.
- A whole request is one transaction: on any 4xx/5xx nothing from it was saved.

So the safe client loop is: keep every set in local storage with a `synced`
flag; upload whatever isn't synced plus the session fields; on `200`/`201`
mark `accepted` + `duplicate` + `updated` as synced; on a negative Connect IQ
code, `429`, `500` or `503` keep everything and retry later with backoff
(e.g. 30 s, 2 min, 10 min, then on next app start).

### Partial syncs and completion

1. First upload without `ended_at` → session created **open** (`201`). It
   appears in GRIND as an in-progress workout (Home's resume card; opening that
   day in Log resumes it with the watch's sets).
2. More uploads with new sets → added to the open session.
3. Upload with `ended_at` → session completed: XP, level, streak, PRs and
   badges are computed exactly as for a web workout, and GRIND's "up next"
   moves on (only if this is the user's most recent workout).
4. Sets that arrive after completion are still stored; stats recompute.

Completion rules (same as the web app):

| Code | Status | When | Watch should |
| --- | --- | --- | --- |
| `no_working_sets` | 422 | Finishing with no non-warm-up set | Don't retry as-is |
| `open_session_conflict` | 409 | Creating an **open** session for a day already open in the web app | Retry later, or upload with `ended_at` (a finished upload never conflicts) |
| `day_already_logged` | 409 | That day is already finished on that date | Stop; tell the user |
| `session_id_conflict` | 409 | The session id belongs to another account | Generate a new session id |
| `unknown_workout` | 422 | `workout_id` isn't one of the user's days | Refresh `/today` |
| `workout_required` | 422 | New session with no `workout_id` and no known exercise | Send `workout_id` |

### Units and time

- Weights are stored in lbs; a kg set is converted (×2.20462) and the device's
  original number and unit are kept alongside, so a re-upload compares exactly.
  Send whatever unit the watch displays; always set `unit`.
- All timestamps are stored in UTC. The workout's calendar day (for streaks) is
  the local date of `ended_at` using `utc_offset_seconds`.

## POST /daily

The day's body snapshot (GRIND Body, migration 59). The watch sends it when
the app opens and at most every 15 minutes while it's open, never mid-workout,
and every 15 minutes from the background service with the app closed. Fire and
forget: a failure waits for the next snapshot.

```json
{
  "date": "2026-11-16",
  "body_battery": [null, null, 86, 85, "… 96 buckets of 15 min from local midnight …"],
  "stress": ["… 96 buckets, 0–100 or null …"],
  "body_battery_now": 36,
  "resting_hr": 58,
  "recovery_hours": 14,
  "steps": 8412,
  "active_minutes": 40,
  "floors": 6,
  "spo2": 96,
  "vo2max": 60,
  "respiration": 15,
  "heart_rate": ["… 96 buckets, average bpm or null …"],
  "bucket": 58,
  "source": "background"
}
```

Everything but `date` is optional. Series must have exactly 96 entries. The
server derives high, low, latest, wake value and stress average, and merges
series with earlier snapshots of the same date (the watch's history reaches back
only a few hours, so each open fills in its own stretch). `date` must be within
the last 30 days. `200` returns `{ "local_date", "synced_at" }`.

Migration `69` adds the all-day fields. `heart_rate` is 96 bucket averages
(25–250 bpm). `bucket` (0–95) is the local 15-minute slot the snapshot was taken
in: the server puts `steps`, `active_minutes` and `floors` there on the day's
curves (`steps_series`, …), since the watch only knows running totals.
`source` is `app` (the default) or `background`, and every stored snapshot is
logged in `body_sync_log` with it, so the Health page can show when and how
the last one arrived. Before migration 69 these fields are accepted and
ignored.

Migration `70` adds two keys that exist only to understand the watch; nothing
in the app shows them, and `npm run watchreport` reads them back:

- `hr_raw`: `{ "t": [...], "v": [...] }`, every all-day heart-rate sample the
  watch stored since its last stored snapshot (a minute of overlap, at most 4
  hours back, at most 480), unaveraged. `t` is seconds from local midnight.
- `diag`: `taken_at` (the watch's clock), `battery`, `charging`, `free_mem`,
  `total_mem`, `part`, `fw`, `ciq`, `period_s` (the background period),
  `prev_bg_at` / `prev_bg_code` (the previous background run and its HTTP
  code; a failed run stores nothing, so this is the only trace of it), and
  `probe`: per sensor value, `[value, age in minutes]` or a code (`-1` empty,
  `-2` threw, `-3` not on this firmware). Keys: `bb_h`, `stress_h`, `hr_h`,
  `spo2_h`, `temp_h`, `press_h` (newest history sample with a value, looking
  back up to six), `resp`, `stress`, `ttr`, `hr`, `spo2`, `temp`, `press`,
  `rhr`, `avg_rhr`, `vo2` (live). `wk_hr`: the last watch workout's
  heart-rate reads, `[reads, misses, from the recording, from the sensor
  fallback]`.

Both are stored per snapshot in `body_sync_log` (30 days). Before migration 70
they are accepted and ignored.

`spo2` is the newest SpO2 *history* sample, sent only when it is under 30
minutes old. The live sensor value it replaced held the last reading for hours
once the watch stopped measuring (diagnostics, 2026-11-19); left out, the
server keeps the day's last value.

Migration `71` adds `respiration` (4–60 breaths/min): the live rate, which the
server places at `bucket` on `resp_series` like the running totals.
Respiration *history* is still empty on the Forerunner 165 Music, but the live
rate is filled in on most snapshots. The overnight median is the resting
respiration Charge compares with your usual. Each snapshot's `heart_rate` is
also kept in `body_sync_log.hr_avg`, so `npm run watchreport` can see Garmin
revise a finished bucket. Before migration 71 both are accepted and ignored.

## POST /rep-lab

One finished set recorded for tuning the wrist rep counter (migration `66`).
The watch sends these one per request, only after the set's workout has
synced, and deletes each once it gets `201`. A `4xx` other than `401` also
drops it, so a set the server can't place never blocks the queue. Switch it
off under Home → MENU → Rep lab.

A recording comes in one of two formats. Builds from `2026-11-18b` send the
**tape** format; the server decodes it into the same stored arrays.

Tape format (migration `67` stores the extra signals; before it they are
dropped and the motion is still stored):

| Field | Type | Notes |
| --- | --- | --- |
| `enc` | `"i16b64"` | Each motion axis is one base64 string of big-endian int16. |
| `ax`, `ay`, `az` | base64 ≤ 938 samples | Accelerometer, milli-g at 12.5 Hz, same length. Recorded through the whole set, after a manual takeover too. |
| `mx`, `my`, `mz` | base64, optional | Compass at 12.5 Hz, when the watch delivers it. |
| `hr` | int[] ≤ 100 | Heart rate per sensor batch (about 1 s), 0 = no reading. |
| `beats` | int[] ≤ 240, optional | Milliseconds between heartbeats. |
| `step_marks` | [int, int][] ≤ 100 | Per batch: accelerometer samples since START, steps since START. Expanded to `steps` per sample. |
| `slim` | bool, optional | The compass and beats were dropped after three Bluetooth failures to get the record through. |
| `diag` | object | Adds `tape_samples`, `tape_total`, `mag_samples`, `beats`, `mem_peak`, `mem_total`, `battery_start`, `battery_end`, `rich`, `rich_bad`. |

Plus the shared fields from `id` to `clipped`, `events` and `app_version` in
the table below (not `x`, `y`, `z`, `steps`). A full tape is under 30 KB.

The first format:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | The set's id, the same as in `POST /sessions`. |
| `session_id` | uuid | Must be one of the caller's sessions, else `422 session_not_found`. |
| `exercise_id`, `exercise_name`, `set_number`, `weight`, `unit` | | Context, optional. |
| `logged_reps` | int | What was saved. The truth for tuning. |
| `auto_reps` | int or null | The counter's confident count at finish. |
| `auto_shown`, `typed` | bool | The saved number was the AUTO one; reps were changed by hand during the set. |
| `started_at`, `finished_at` | ISO 8601 | START press and finish press. |
| `rate_hz` | number | 12.5. |
| `clipped` | bool | The 75 s rolling window dropped the start of the set. |
| `x`, `y`, `z` | int[] ≤ 938 | The analyzed motion window, milli-g, same length. |
| `steps` | int[] | Step counter delta per sample. |
| `events` | number[][] ≤ 120 | `[ms since START, kind, …]`: 1 first batch (samples, timestamped), 2 count shown (n, −1 none), 3 analysis done (reps, ok, wall ms, steps), 4 input gap (code), 5 wrist settled (moving batches), 6 glance kept count (count, re-check), 7 taken over by hand. |
| `diag` | object | Sensor status, batch and analysis counts, longest worker callback, … |
| `app_version` | string | |

A correction, after the set was reopened with Undo and saved again:
`{ "id", "logged_reps", "corrected": true }`. A recording sent again never
undoes a correction. `201` returns `{ "id", "stored" }`.

Read them with `npm run replab` (see `watch/README.md`).

## POST /readiness

One morning readiness check (migration `68`): a minute of beat-to-beat
intervals recorded while the user sits still, after a 10 s settle.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Chosen by the watch; a re-send overwrites itself. |
| `local_date` | YYYY-MM-DD | The watch's local date. |
| `measured_at` | ISO 8601 | Start of the measured minute. |
| `duration_s` | int 10–600 | 60 today. |
| `rr_ms` | int[] 1–600 | Intervals as delivered, artifacts included. |
| `moving_s` | int, optional | Seconds the accelerometer saw movement. |
| `watch_rmssd` | number, optional | What the watch showed, kept to check the two agree. |
| `app_version` | string, optional | |

The server recomputes RMSSD, mean HR, SDNN, artifacts and quality from
`rr_ms` (`src/lib/body/hrv.ts`, the same steps the watch runs) and stores the
raw intervals with them. A poor reading is stored as poor and never reaches
Charge or the baseline. `201` returns `{ id, stored, rmssd, mean_hr, quality,
reason }`; `stored` is false while the user has health collection switched off.

## POST /telemetry

App health from the watch (migration `67`), sent through the same queue as the
rep lab, one record per request, without waiting for any workout.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Chosen by the watch; a re-send overwrites itself. |
| `kind` | `unclean_exit` or `session` | `unclean_exit`: the previous run never reached a clean stop (a crash, a flat battery, a reboot), reported on the next start. `session`: one saved workout's vitals. |
| `at` | ISO 8601 | When it happened, by the watch's clock. |
| `app_version` | string | |
| `data` | object ≤ 40 fields | Strings, numbers, booleans, null or number arrays ≤ 20. An `unclean_exit` carries what the app was doing (`phase`: open, set, logged; `sets`, `manual`, `listening`, `mem`, `battery`, `longest_callback_ms`, …). A `session` carries `duration_s`, `sets`, `battery_start/end`, `mem_peak`, `longest_callback_ms`, sets with compass and beats, sensor gaps, and upload outcomes (`uploads_ok`, `uploads_failed`, `upload_codes`). Both add the device's `part`, `fw` and `ciq`. |

`201` returns `{ "id", "stored" }`; a database failure is `503` and the watch
retries.

## Rate limits and payload size

- 60 requests per minute per device (all endpoints together). Over the limit:
  `429` with `Retry-After`.
- Request body: 64 KB max, 200 sets max. `/today` response: < 4 KB.
- Batch sets: one request per finished exercise (or one at the end) is plenty;
  don't send one request per set when the phone is connected and idle-sync
  later.

## Monkey C notes

```monkeyc
using Toybox.Communications;
using Toybox.Lang;
using Toybox.Time;
using Toybox.Time.Gregorian;
using Toybox.System;
using Toybox.Cryptography;

const BASE = "https://grindtrack.vercel.app/api/watch/v1";

function headers(token) {
    return {
        "Authorization" => "Bearer " + token,
        "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
    };
}

function fetchToday(token, callback) {
    var info = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
    var date = Lang.format("$1$-$2$-$3$", [info.year, info.month.format("%02d"), info.day.format("%02d")]);
    Communications.makeWebRequest(BASE + "/today", { "date" => date, "unit" => "kg" }, {
        :method => Communications.HTTP_REQUEST_METHOD_GET,
        :headers => headers(token),
        :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
    }, callback); // callback(responseCode, data)
}

function uploadSession(token, session, callback) {
    Communications.makeWebRequest(BASE + "/sessions", session, {
        :method => Communications.HTTP_REQUEST_METHOD_POST,
        :headers => headers(token),
        :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
    }, callback);
}

// ISO 8601 UTC from a Moment.
function isoUtc(moment) {
    var u = Gregorian.utcInfo(moment, Time.FORMAT_SHORT);
    return Lang.format("$1$-$2$-$3$T$4$:$5$:$6$Z", [u.year, u.month.format("%02d"), u.day.format("%02d"),
        u.hour.format("%02d"), u.min.format("%02d"), u.sec.format("%02d")]);
}

// RFC 4122 v4 UUID (Cryptography.randomBytes needs CIQ 3.0+).
function uuid4() {
    var b = Cryptography.randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = "";
    for (var i = 0; i < 16; i++) {
        hex += b[i].format("%02x");
        if (i == 3 || i == 5 || i == 7 || i == 9) { hex += "-"; }
    }
    return hex;
}

// Offset for utc_offset_seconds.
var offset = System.getClockTime().timeZoneOffset;
```

- Generate the session UUID when the workout starts and each set's UUID when
  the set is logged; persist them (`Application.Storage`) with the set so a
  retry reuses them.
- A `200`/`201` callback means the server has the data; use the lists in
  `sets` to mark what's synced.
- Treat `401` as "re-pair" and stop retrying until the token changes.
- Keep the JSON you build small: send only unsynced sets plus the session
  fields.

## Manual testing with curl

```bash
BASE=https://grindtrack.vercel.app/api/watch/v1   # or http://localhost:3000/api/watch/v1
TOKEN=gwt_...                                      # from Settings → Watch

# 1. Ping
curl -s "$BASE/ping" -H "Authorization: Bearer $TOKEN"

# 2. Auth failure (expect 401 missing_token / invalid_token)
curl -s -i "$BASE/ping"
curl -s -i "$BASE/ping" -H "Authorization: Bearer gwt_0000000000000000000000000000000000000000000000000000000000000000"

# 3. Today's plan (note an exercise id and workout id from the output)
curl -s "$BASE/today?date=$(date +%F)&unit=lbs" -H "Authorization: Bearer $TOKEN"

# 4. Partial sync: open session with one set (expect 201)
SESSION=$(uuidgen | tr A-Z a-z); SET1=$(uuidgen | tr A-Z a-z)
EX=<exercise id from /today>; DAY=<workout.id from /today>
NOW=$(date -u +%FT%TZ)
curl -s -X POST "$BASE/sessions" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "id": "'$SESSION'", "workout_id": "'$DAY'", "started_at": "'$NOW'", "utc_offset_seconds": 0,
  "sets": [{ "id": "'$SET1'", "exercise_id": "'$EX'", "set_number": 1, "reps": 8, "weight": 60, "unit": "kg", "completed_at": "'$NOW'" }]
}'

# 5. Re-send the exact same body (expect 200, set listed under "duplicate")
#    — rerun the command above.

# 6. Finish it (expect 200, "completed_now": true, stats filled in)
curl -s -X POST "$BASE/sessions" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "id": "'$SESSION'", "started_at": "'$NOW'", "ended_at": "'$(date -u +%FT%TZ)'", "utc_offset_seconds": 0, "sets": []
}'

# 7. Validation error (expect 422 validation_failed with details)
curl -s -X POST "$BASE/sessions" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "id": "not-a-uuid", "started_at": "yesterday" }'
```

Step 4 creates a real workout on your account. Delete it afterwards from
**Log → Past** (or skip step 6 and discard the open session from Home).

## Where watch data shows up

Watch sessions and sets are rows in the same `sessions` / `session_logs`
tables the web app writes, so Home, Log, Past, Progress, the calendar,
streaks, PRs, badges and the leaderboard all include them with no special
cases. They are marked `source = 'watch'` (debugging only; the UI doesn't
show it). Editing a watch workout in **Log → Past** rewrites its sets as web
sets (`source` back to `web`, device unit dropped).

## Server setup

- Apply `docs/sql/58-watch-api.sql` in the Supabase SQL editor **before**
  deploying the code (`npm run migrations:check` afterwards).
- Env: `SUPABASE_SERVICE_ROLE_KEY` must be set on Vercel (already required by
  the push cron). The watch routes use it because the watch has no Supabase
  session; every watch RPC is granted to `service_role` only and takes the
  user id the route derived from the token.

## Tests

- `src/lib/watch/__tests__/watchApi.test.ts` (in `npm test`): token parsing,
  validation, error shapes, `/today` payload and size budget, handler
  behavior with fake deps.
- `src/lib/watch/__tests__/watchApi.db.test.ts` (in `npm run test:sql-parity`,
  needs `PARITY_DATABASE_URL`): loads every migration into a scratch Postgres
  and runs the real handlers against it — auth failures, revocation, rate
  limit, idempotent re-upload, partial sync → completion, late sets,
  cross-account isolation, grants, and that watch rows appear in the web app's
  history reads.
