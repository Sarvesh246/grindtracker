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
 * True when a response should be consumed as Coach NDJSON rather than plain text.
 * Prefer Content-Type / X-Coach-Stream, but also sniff the body — custom headers
 * are sometimes unavailable to the browser, which used to dump raw JSON in the UI.
 */
export function shouldParseCoachNdjson(args: {
  contentType?: string | null
  streamHeader?: string | null
  sample?: string
}): boolean {
  const ct = (args.contentType ?? '').toLowerCase()
  if (ct.includes('ndjson') || ct.includes('jsonl')) return true
  if ((args.streamHeader ?? '').toLowerCase() === 'ndjson') return true
  return looksLikeCoachNdjson(args.sample ?? '')
}

/** Sniff the first non-empty line for a Coach stream event envelope. */
export function looksLikeCoachNdjson(sample: string): boolean {
  const line = sample
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(Boolean)
  if (!line || line[0] !== '{') return false
  try {
    const parsed = JSON.parse(line) as { type?: unknown }
    return (
      typeof parsed?.type === 'string' &&
      (parsed.type === 'text-delta' ||
        parsed.type === 'proposal' ||
        parsed.type === 'error' ||
        parsed.type === 'done')
    )
  } catch {
    return false
  }
}

/**
 * Parse an NDJSON Coach chat stream line.
 * Only returns a text-delta fallback when the line is clearly not an event object.
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
      // Incomplete JSON line mid-stream — skip until a full line arrives.
      return null
    }
  }
  return { type: 'text-delta', text: line }
}

/**
 * Re-parse a full NDJSON transcript into prose + proposals.
 * Used when the client accidentally treated the stream as plain text.
 */
export function rehydrateCoachNdjson(raw: string): {
  text: string
  proposals: CoachProposalView[]
  error: string | null
} {
  let text = ''
  const proposals: CoachProposalView[] = []
  let error: string | null = null
  for (const line of raw.split(/\r?\n/)) {
    const event = parseCoachChatStreamLine(line)
    if (!event) continue
    if (event.type === 'text-delta') text += event.text
    else if (event.type === 'proposal') {
      if (!proposals.some(p => p.id === event.proposal.id)) {
        proposals.push(event.proposal)
      }
    } else if (event.type === 'error') {
      error = event.error
    }
  }
  return { text, proposals, error }
}
