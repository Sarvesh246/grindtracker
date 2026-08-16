export const REST_PRESETS = [60, 90, 120, 180] as const
const STORAGE_PREFIX = 'grind.rest.'
const DEFAULT_REST_KEY = 'grind.rest.default'
export const DEFAULT_REST = 120

function readPositiveSeconds(raw: string | null): number | null {
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** User's global default rest, configurable in Settings. Falls back to DEFAULT_REST. */
export function getDefaultRest(): number {
  if (typeof window === 'undefined') return DEFAULT_REST
  return readPositiveSeconds(localStorage.getItem(DEFAULT_REST_KEY)) ?? DEFAULT_REST
}

export function setDefaultRest(seconds: number) {
  if (typeof window === 'undefined') return
  localStorage.setItem(DEFAULT_REST_KEY, String(seconds))
}

export function getExerciseRest(exerciseId: string): number {
  if (typeof window === 'undefined') return getDefaultRest()
  return readPositiveSeconds(localStorage.getItem(STORAGE_PREFIX + exerciseId)) ?? getDefaultRest()
}

export function setExerciseRest(exerciseId: string, seconds: number) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_PREFIX + exerciseId, String(seconds))
}

const SESSION_REST_KEY = (sessionId: string) => `${STORAGE_PREFIX}session.${sessionId}`

/** Rest override for this open workout (all exercises) until finish/discard. */
export function getSessionRest(sessionId: string | null | undefined): number | null {
  if (!sessionId || typeof window === 'undefined') return null
  return readPositiveSeconds(localStorage.getItem(SESSION_REST_KEY(sessionId)))
}

export function setSessionRest(sessionId: string, seconds: number) {
  if (typeof window === 'undefined') return
  if (!Number.isFinite(seconds) || seconds <= 0) return
  localStorage.setItem(SESSION_REST_KEY(sessionId), String(seconds))
}

export function clearSessionRest(sessionId: string) {
  if (typeof window === 'undefined') return
  localStorage.removeItem(SESSION_REST_KEY(sessionId))
}

/** Session override → per-exercise override → Settings default. */
export function resolveRestSeconds(exerciseId: string, sessionId?: string | null): number {
  return getSessionRest(sessionId) ?? getExerciseRest(exerciseId)
}

const PAUSE_ON_EXIT_KEY = 'grind.rest.pause_on_exit'

/**
 * Whether "Save & Exit" freezes the active rest timer where it was (default)
 * or lets it keep counting down in the background. Configurable in Settings.
 */
export function getPauseRestOnExit(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(PAUSE_ON_EXIT_KEY) !== 'false'
}

export function setPauseRestOnExit(value: boolean) {
  if (typeof window === 'undefined') return
  localStorage.setItem(PAUSE_ON_EXIT_KEY, String(value))
}
