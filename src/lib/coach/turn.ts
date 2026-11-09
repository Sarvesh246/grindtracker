import type { ModelMessage } from 'ai'
import { buildCoachTurnReminder, inferCoachIntent, type CoachIntentProfile } from './intent'
import { buildCoachSystemPrompt } from './prompt'
import {
  normalizeCoachTurns,
  unansweredUserTurns,
  type CoachTurn,
} from './history'

export type CoachTurnPlan = {
  profile: CoachIntentProfile
  system: string
  messages: ModelMessage[]
  maxOutputTokens: number
  reasoning: 'none' | 'low'
  /** false = pure Q&A intent; the action tools are not offered. */
  toolsEnabled: boolean
  /** What the user actually typed lately — grounding check for write tools. */
  userText: string
}

/**
 * Everything that decides HOW a turn is run, in one place, so the chat route
 * and the eval harness (scripts/coach-eval.ts) cannot drift apart.
 *
 * Asks left unanswered by a failed reply are merged into this turn (see
 * normalizeCoachTurns), and the model may act on any of them — a pasted week is
 * a multi-thousand-token tool call — so budget, tools and prompt sections cover
 * the most demanding of them, not just the new message.
 */
export function planCoachTurn(args: {
  message: string
  history: CoachTurn[]
  userDataJson: string
  recentActions: string | null
}): CoachTurnPlan {
  const { message, history } = args
  const priorUser = [...history].reverse().find(m => m.role === 'user')
  const profile = inferCoachIntent(message, priorUser?.content ?? null)
  const profiles = [
    profile,
    ...unansweredUserTurns(history).map(t => inferCoachIntent(t)),
  ]

  const merged: Pick<CoachIntentProfile, 'mechanics' | 'toolPolicy'> = {
    mechanics: profiles.some(p => p.mechanics),
    toolPolicy: profiles.some(p => p.toolPolicy === 'all') ? 'all' : 'none',
  }

  const system = buildCoachSystemPrompt({
    profile: merged,
    userDataJson: args.userDataJson,
    recentActions: args.recentActions,
    turnReminder: buildCoachTurnReminder(profile),
  })

  const userText = [
    ...history.filter(m => m.role === 'user').slice(-3).map(m => m.content),
    message,
  ].join('\n')

  return {
    profile,
    system,
    messages: normalizeCoachTurns([...history, { role: 'user', content: message }]),
    maxOutputTokens: Math.max(...profiles.map(p => p.maxOutputTokens)),
    reasoning: profiles.some(p => p.thinking === 'low') ? 'low' : 'none',
    toolsEnabled: merged.toolPolicy === 'all',
    userText,
  }
}

/** Cut a truncated reply back to its last whole sentence (or line). */
export function trimToLastSentence(text: string): string {
  const t = text.trimEnd()
  const cut = Math.max(
    t.lastIndexOf('. '),
    t.lastIndexOf('! '),
    t.lastIndexOf('? '),
    t.lastIndexOf('\n'),
  )
  const endsClean = /[.!?)\]*"”]$/.test(t)
  if (endsClean) return t
  // Keep the whole text if there is no real sentence to fall back to.
  return cut >= 12 ? t.slice(0, cut + 1).trimEnd() : t
}
