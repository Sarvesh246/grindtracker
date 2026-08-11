/**
 * Mirrors `enforce_coach_rate_limit` in docs/sql/33-coach.sql.
 * Change both places together.
 */
export const COACH_DAILY_LIMIT = 15
export const COACH_BURST_LIMIT = 8
/** Burst window in minutes (SQL: `interval '10 minutes'`). */
export const COACH_BURST_WINDOW_MINUTES = 10

/** Max length of a single user message (DB check allows up to 4000). */
export const COACH_MAX_MESSAGE_CHARS = 2000

/** Max prior turns (user+assistant pairs count as 2) accepted from the client. */
export const COACH_MAX_HISTORY_MESSAGES = 12

// Pinned model IDs get retired out from under you (gemini-2.5-flash-lite
// started 404ing "no longer available to new users" — see PR #69). Track
// Google's floating flash-lite alias instead so this doesn't happen again.
export const COACH_DEFAULT_MODEL = 'gemini-flash-lite-latest'

/** How many completed sessions to include in the personal context pack. */
export const COACH_CONTEXT_SESSIONS = 10

/** Cap working sets listed per session in the pack. */
export const COACH_CONTEXT_SETS_PER_SESSION = 40

/** Recent PR rows to surface. */
export const COACH_CONTEXT_RECENT_PRS = 12

/** Body-weight points to include. */
export const COACH_CONTEXT_BODY_WEIGHTS = 14
