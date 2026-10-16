/**
 * Shape the chat turns sent to Gemini.
 *
 * A failed or empty Coach reply is dropped client-side, so the next send
 * ships history ending in a user turn plus the new user message — two (or
 * more) user turns in a row. Gemini handles that badly: the model tends to
 * act on the EARLIER unanswered ask (often a pasted weekly plan, i.e. a huge
 * tool call) under the budget computed for the new one, runs out of tokens
 * mid function call, and finishes with nothing. Merging same-role runs keeps
 * strict user/model alternation and makes the unanswered ask explicit.
 */

export type CoachTurn = { role: 'user' | 'assistant'; content: string }

export function normalizeCoachTurns(turns: CoachTurn[]): CoachTurn[] {
  const out: CoachTurn[] = []
  for (const turn of turns) {
    const content = turn.content.trim()
    if (!content) continue
    const last = out[out.length - 1]
    if (last && last.role === turn.role) {
      last.content = `${last.content}\n\n${content}`
    } else {
      out.push({ role: turn.role, content })
    }
  }
  // Contents must open with a user turn; a tail-sliced history can start
  // mid-exchange on an assistant reply.
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

/**
 * User turns after the last assistant reply — asks that never got an answer
 * and are about to be merged into the current message.
 */
export function unansweredUserTurns(history: CoachTurn[]): string[] {
  const out: string[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') break
    out.unshift(history[i].content)
  }
  return out
}
