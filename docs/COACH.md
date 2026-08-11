# GRIND Coach (Gemini)

Personal fitness Q&A over the signed-in user’s stats, history, and program.
Server-only Gemini key; free-tier friendly with hard per-user rate limits.

## Apply SQL first

Paste and run [`sql/33-coach.sql`](sql/33-coach.sql) in the Supabase SQL editor
**before** calling `/api/coach/chat`. Creates `coach_messages` + RLS + rate-limit
trigger.

Limits (also in `src/lib/coach/constants.ts` — change both):

| Limit | Value |
| --- | --- |
| User messages / 24 hours | 15 |
| User messages / 10 minutes | 8 |
| Max user message length | 2000 chars (API); 4000 in DB |

## Env

| Variable | Where | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | Server only | AI Studio key — never `NEXT_PUBLIC_*` |
| `GEMINI_MODEL` | Server only | Default `gemini-flash-lite-latest` (a floating alias — pinned model IDs like `gemini-2.5-flash-lite` get retired by Google and start 404ing) |

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
    "burstRemaining": 8
  },
  "model": "gemini-flash-lite-latest",
  "configured": true
}
```

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

**Success:** plain text stream (`text/plain` stream via AI SDK
`toTextStreamResponse`). Headers:

- `X-Coach-Daily-Remaining`
- `X-Coach-Daily-Limit`
- `X-Coach-Model`

**Errors:** `401`, `400`, `429` (rate limit), `503` (missing key / SQL not applied),
`502` (model failure).

## How context works

`buildCoachContext` (server) loads only the caller’s data via Supabase RLS:

- Profile, `user_stats`, program days, rotation + next day
- Rest days (weekly + recent one-offs)
- Recent body weight
- Last ~10 completed sessions + working sets
- Recent PR sets

Weights stay **canonical lbs** in the pack; the system prompt tells the model
to convert when `unit_preference` is `kg`.

## UI

Floating coach on authenticated `(app)` routes (`src/components/coach/`):

| Piece | Behavior |
| --- | --- |
| **FAB** | Lime 56px circle, G+spark mark; drag past 8px snaps to four corners (`br` default). Dock in `localStorage` key `grind_coach_fab_dock`. |
| **Visibility** | Hidden when `pathname === '/log' && searchParams.has('day')` (active workout), same as bottom nav. |
| **Sheet** | Compact / expanded sizes; backdrop close; Escape closes; session history in memory only. |
| **API** | First open → `GET /api/coach/chat` (quota). Send → `POST` stream + `unit` from `UnitContext`; quota pill from `X-Coach-Daily-*` headers. |
| **z-index** | FAB 420 · backdrop 430 · sheet 440. |

Not a nav tab; not a `/coach` route in v1.
