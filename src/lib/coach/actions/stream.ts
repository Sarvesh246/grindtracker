import type { CoachProposalView } from './types'

export type CoachChatStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'proposal'; proposal: CoachProposalView }
  | { type: 'error'; error: string }
  | { type: 'done' }

export type CoachActionStreamEvent =
  | {
      type: 'step'
      index: number
      total: number
      label: string
      state: 'pending' | 'active' | 'done' | 'error'
    }
  | {
      type: 'result'
      ok: boolean
      message: string
      href?: string
      status: 'executed' | 'cancelled' | 'failed'
    }
  | { type: 'error'; error: string }

export function encodeNdjson(event: object): string {
  return `${JSON.stringify(event)}\n`
}

/**
 * Parse an NDJSON Coach chat stream. Tolerates legacy plain-text streams
 * (no newlines / no JSON) by treating the whole chunk as text-delta.
 */
export function parseCoachChatStreamLine(
  line: string,
): CoachChatStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as CoachChatStreamEvent
      if (
        parsed &&
        typeof parsed === 'object' &&
        'type' in parsed &&
        typeof (parsed as { type: unknown }).type === 'string'
      ) {
        return parsed
      }
    } catch {
      // fall through to plain text
    }
  }
  return { type: 'text-delta', text: line }
}
