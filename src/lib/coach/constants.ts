/**
 * How many completed sessions to include in the personal context pack.
 * Older ones are exercise-rollups; the newest few keep full set rows.
 */
export const COACH_CONTEXT_SESSIONS = 14

/** Newest N sessions keep full set detail; the rest are per-exercise rollups. */
export const COACH_CONTEXT_FULL_DETAIL_SESSIONS = 3

/** Cap working sets listed per full-detail session. */
export const COACH_CONTEXT_SETS_PER_SESSION = 40

/** Recent PR rows to surface. */
export const COACH_CONTEXT_RECENT_PRS = 20

/** Body-weight points included in the prompt (newest). */
export const COACH_CONTEXT_BODY_WEIGHTS = 14

/** Fetch this many BW rows to compute trend deltas, then slim for the prompt. */
export const COACH_CONTEXT_BODY_WEIGHTS_FETCH = 90

/** Cap exercise_performance rows (active catalog bests / last weights). */
export const COACH_CONTEXT_EXERCISE_BESTS = 80

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

// Prefer a current stable Flash-Lite pin. gemini-2.5-flash-lite started
// 404ing "no longer available to new users"; gemini-flash-lite-latest also
// works but can hot-swap behavior. Override anytime with GEMINI_MODEL.
export const COACH_DEFAULT_MODEL = 'gemini-3.5-flash-lite'
