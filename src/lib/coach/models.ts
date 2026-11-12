/**
 * Models the Coach can run on, in fallback order. Pure (no SDK import) so the
 * client dropdown, the chat route and the eval harness share one list.
 *
 * Free-tier Gemini quotas are counted PER MODEL, so when the preferred model
 * is rate limited (or 503s under load) the route moves down this list instead
 * of failing the turn. Every entry here passed the eval's A2 (personal data),
 * C10 (one action card) and D5 (multi-exercise day) cases — run
 * `npm run coach:eval -- --model <id> --id <case> --runs 1` before adding one;
 * a model that can't do tool calls breaks action cards.
 */
export type CoachModelGroup = 'fast' | 'smart'

export type CoachModelOption = {
  id: string
  /** Full name, used in the menu. */
  label: string
  /** Compact name for the trigger pill. */
  short: string
  /** One-line trade-off shown under the name. */
  note: string
  group: CoachModelGroup
}

/** Sentinel the client sends to mean "default model, then fall back". */
export const COACH_AUTO_MODEL = 'auto'

export const COACH_MODEL_GROUPS: readonly { id: CoachModelGroup; label: string }[] = [
  { id: 'fast', label: 'Fast' },
  { id: 'smart', label: 'Smarter' },
]

export const COACH_MODELS: readonly CoachModelOption[] = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', short: '3.5 Flash Lite', note: 'Quick replies · most messages per day', group: 'fast' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', short: '3.1 Flash Lite', note: 'Quick replies · its own daily limit', group: 'fast' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', short: '3.6 Flash', note: 'Sharpest advice · ~20 messages a day', group: 'smart' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', short: '3.5 Flash', note: 'Sharper advice · ~20 messages a day', group: 'smart' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', short: '3 Flash', note: 'Sharper advice · ~20 messages a day', group: 'smart' },
]
// Tested and left out (2026-11-12): gemini-3.7/3.8-flash 503 "high demand"
// on every call; gemma-4-26b/31b took 58–150s a turn (route deadline is 52s)
// and missed the tool-call cases; gemini-2.5-flash(-lite) 404 for new keys.

export function coachModelById(id: string): CoachModelOption | undefined {
  return COACH_MODELS.find(m => m.id === id)
}

const KNOWN = new Set(COACH_MODELS.map(m => m.id))

export function isCoachModelId(id: unknown): id is string {
  return typeof id === 'string' && KNOWN.has(id)
}

/**
 * Ordered list of models to try for one turn: the requested model first (or
 * the env/default one for "auto"), then every other listed model in order.
 * An unknown request is treated as "auto" — the client can't pick a model
 * that isn't on the list.
 */
export function resolveCoachModelChain(
  requested: unknown,
  defaultModel: string,
): string[] {
  const first = isCoachModelId(requested) ? requested : defaultModel
  return [first, ...COACH_MODELS.map(m => m.id).filter(id => id !== first)]
}

/**
 * Per-family call settings. Gemini 3 wants the default temperature (lower
 * values loop); Gemma has no thinking config, so `reasoning` must not be sent.
 */
export function coachModelSettings(modelId: string): {
  temperature?: number
  supportsReasoning: boolean
} {
  if (modelId.startsWith('gemma-')) {
    return { temperature: 0.4, supportsReasoning: false }
  }
  if (/gemini-3|-latest$/.test(modelId)) return { supportsReasoning: true }
  return { temperature: 0.4, supportsReasoning: true }
}
