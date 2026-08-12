# GRIND Coach (Gemini)

Personal fitness Q&A over the signed-in user’s stats, history, and program.
Server-only Gemini key; free-tier friendly with hard per-user rate limits.

## Apply SQL first

Paste and run [`sql/33-coach.sql`](sql/33-coach.sql), then
[`sql/34-coach-quota-fixes.sql`](sql/34-coach-quota-fixes.sql), then
[`sql/35-coach-conversations.sql`](sql/35-coach-conversations.sql) in the
Supabase SQL editor **before** relying on saved chats. 33 creates
`coach_messages` + RLS + rate-limit trigger; 34 adds a refund path for failed
turns and the admin dev-unlimited toggle; 35 adds `coach_conversations` so
threads can be listed, reopened, and deleted.

Limits (also in `src/lib/coach/constants.ts` — change both):

| Limit | Value |
| --- | --- |
| User messages / 24 hours | 15 |
| User messages / 10 minutes | 8 |
| Max user message length | 2000 chars (API); 4000 in DB |

A turn that never produces a visible reply (model call fails, retired model,
network error) doesn't count against these — the route calls
`grind_coach_refund_message` to delete that turn's row instead of charging
the user's quota for a reply they never got. The admin account can also flip
"Unlimited Coach Messages" in Profile → Settings → Developer to bypass both
limits entirely (`user_profiles.coach_dev_unlimited`, enforced in Postgres by
`enforce_coach_rate_limit()` — not just hidden in the UI) for testing against
Gemini's own free-tier quota without the app's 15/day cap in the way.

## Env

| Variable | Where | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | Server only | AI Studio key — never `NEXT_PUBLIC_*` |
| `GEMINI_MODEL` | Server only | Default `gemini-3.5-flash-lite`. `gemini-flash-lite-latest` also works. Avoid retired pins like `gemini-2.5-flash-lite`. Coach uses AI SDK `reasoning: 'none'` so thinking config stays valid across 2.5 (`thinkingBudget: 0`) and 3.x (`thinkingLevel: 'minimal'`) — do not hardcode `thinkingBudget` for 3.x models. |

(`GOOGLE_GENERATIVE_AI_API_KEY` is accepted as a fallback name.)

Local: [`.env.local`](../.env.local). Production: Vercel → Environment Variables,
then redeploy.

## API

### `GET /api/coach/chat`

Auth required. Returns:

```json
{
  "quota": {
    "dailyUsed": 0,
    "dailyLimit": 15,
    "dailyRemaining": 15,
    "burstUsed": 0,
    "burstLimit": 8,
    "burstRemaining": 8,
    "unlimited": false
  },
  "model": "gemini-3.5-flash-lite",
  "configured": true
}
```

`quota.unlimited` is only ever `true` for the admin account with the dev
toggle on (see above) — the client skips both cap checks when it's set, and
Postgres enforces the same exemption independently.

### `POST /api/coach/chat`

Auth required. Body:

```json
{
  "message": "How's my streak?",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "unit": "lbs"
}
```

- `history` optional; last 12 turns max (client-side conversation only).
- `unit` optional (`lbs`/`kg` or `imperial`/`metric`); falls back to
  `grind_unit_pref` cookie.

**Success:** plain text stream (`text/plain`), assembled from the AI SDK's
`fullStream` by hand rather than `toTextStreamResponse()` — that helper
silently drops `error` parts, which used to make upstream failures look like
Coach wasn't responding at all. Header: `X-Coach-Model`. The client re-fetches
`GET /api/coach/chat` after every turn (success or failure) to read the
post-turn quota back from Postgres, rather than trusting an optimistic
pre-call estimate — necessary because a failed turn gets refunded server-side
and a header set before streaming starts can't know that yet.

**Errors:** `401`, `400`, `429` (rate limit), `503` (missing key / SQL not applied),
`502` (model failure). A `200` with a visible in-body error message ("Sorry, I
hit an error generating a reply…") happens instead of a hard error status when
the failure occurs mid-stream, after headers are already sent.

## How context works

`buildCoachContext` (server) loads only the caller’s data via Supabase RLS +
existing RPCs (`grind_badge_metrics`, `grind_home_history`,
`get_friend_profile`, `get_exercise_bests`, `get_exercise_last_weights`):

- Profile (incl. join date), `user_stats`, badges earned (id + label)
- Program: days, **flex days**, day→push/pull/legs categories, rotation,
  next day + that day’s exercises (targets)
- Full **active catalog** grouped by day (sets/reps/`weight_target`)
- **Exercise performance**: all-time best weight/volume + last-session weight
  per active exercise
- **Lifetime**: volume, heaviest set, max reps, unique exercises, PR/set/
  days-active counts, body-weight log count, friend flag (boolean only)
- Schedule: `last_trained_by_day` (when each day was last completed)
- Rest days (weekly + recent one-offs, with weekday names)
- Body weight: trend summary (latest, Δ7/30d, 90d min/max) + recent points
- RPE summary from the recent-session window
- Open/incomplete session (if any)
- Progress-photo **metadata** only (count + latest date/note — never images)
- `training_history` — tenure + layoff snapshot from **all** completed-session
  `local_date`s (first/last workout, days since, rolling 30/90-day counts,
  significant breaks of ≥14 idle days)
- Last ~14 completed sessions: newest 3 keep full set rows (incl. notes);
  older ones are per-exercise rollups (top weight, volume, avg RPE, PR flag)
- Recent PR sets

Weights stay **canonical lbs** in the pack; the system prompt tells the model
to convert when `unit_preference` is `kg`.

Reply behavior is enforced in `COACH_SYSTEM_PROMPT` for **every** turn
(starter chips and free-typed questions share `POST /api/coach/chat`). These
are **behavioral requirements**, not suggestions. Correct sequence:

**Understand intent → assess complexity → determine relevance → choose depth → choose format → answer → verify**

Format must **emerge from the ask** — the prompt treats depth/format lists as
calibration examples, not templates to fill. At runtime,
`inferCoachIntent()` (`src/lib/coach/intent.ts`) classifies the user message
and adapts:

- **maxOutputTokens** — simple definitions cannot sprawl into workout-length
  replies; workouts/programs get a higher ceiling
- **turn reminder** — a one-line intent nudge after `USER_DATA` (e.g.
  definition → no personal history; recommendation → one decision first)

So different intents get physically different depth budgets without requiring
the user (or the prompt) to prescribe formatting per question.

Key gates:

- Intent before formatting (never pick a template first)
- Minimum necessary structure (no auto Application/Logging/Why/Summary)
- Personalization Required / Useful / Unnecessary
- Relevance over completeness
- Answer-first decisions with commitment + fallback
- Observed → hedged interpretation → recommendation
- Exact output-shape compliance
- Safety overrides performance
- Final 14-point quality check before sending

When a workout or similar list is structured, exercise names render as larger
skim titles and detail lines stay quieter (`CoachMessageContent` title/stack
blocks). Progressive disclosure stays **inside one reply** so users are not
nudged into burning extra daily messages. Behavioral contracts live in
`src/lib/coach/__tests__/prompt.test.ts`; intent divergence is locked in
`src/lib/coach/__tests__/intent.test.ts`; the stress catalog
(`src/lib/coach/stressCatalog.ts`) classifies prompts by personalization need
and preferred format.

## UI

Floating coach on authenticated `(app)` routes (`src/components/coach/`):

| Piece | Behavior |
| --- | --- |
| **FAB** | Lime 56px orb with a large G+spark mark; drag past 8px shows a soft liquid stretch, then snaps to four corners (`br` default). Dock in `localStorage` key `grind_coach_fab_dock`. |
| **Visibility** | Hidden when `pathname === '/log' && searchParams.has('day')` (active workout), same as bottom nav. |
| **Compact sheet** | Quick “type to orb” card; backdrop closes; expand morphs fluidly into the full Coach page. |
| **Full page** | Dedicated chat surface (Siri-app style) with New + History. Close dismisses. Escape closes history first, then Coach. |
| **Saved chats** | `GET/POST /api/coach/conversations`, `GET/DELETE /api/coach/conversations/[id]`. Chat `POST` accepts `conversationId` and returns `X-Coach-Conversation-Id`. |
| **Markdown** | Assistant replies render via `CoachMessageContent` (paragraphs, lists, labels, skim titles / exercise stacks, pipe tables, **bold**). |
| **API** | First open → `GET /api/coach/chat` (quota). Send → `POST` stream + `unit` from `UnitContext`; quota pill re-synced via `GET` after every turn settles. |
| **z-index** | FAB 420 · backdrop 430 · sheet/page 440. |

Not a nav tab; the full experience is an overlay page, not a `/coach` route.
