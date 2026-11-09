/**
 * Argument grounding for tools that write numbers into the user's history.
 *
 * The model once turned "Fix my bench numbers" into a 90 → 95 correction across
 * three sessions — the exact pair from a tool-description example, with nothing
 * from the user behind it. The Confirm card caught it, but a plausible guess
 * should never reach a card at all. So for the tools below, every number the
 * model puts in the call must also appear in what the user actually typed
 * (this message plus the last few of theirs, so "to 135" after "which weight?"
 * still works). If one doesn't, the tool refuses and tells the model to ask.
 *
 * Digits only: "ninety five" is not grounded, which just means one short
 * clarifying question — an acceptable cost for never rewriting history on a guess.
 */

/** Every number written in digits, tolerating "1,000" and "82.5". */
export function numbersInText(text: string): number[] {
  const out: number[] = []
  const cleaned = text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
  for (const m of cleaned.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(m[0])
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

function missingFrom(userNumbers: number[], required: unknown[]): number[] {
  const missing: number[] = []
  for (const r of required) {
    if (typeof r !== 'number' || !Number.isFinite(r)) continue
    if (!userNumbers.some(u => Math.abs(u - r) < 0.051)) missing.push(r)
  }
  return missing
}

/**
 * Null when the call is grounded (or the tool isn't guarded / there is no user
 * text to check against); otherwise a reason that is handed back to the model.
 */
export function groundingReasonFor(
  toolName: string,
  input: Record<string, unknown>,
  userText: string | undefined,
): string | null {
  if (userText == null) return null

  let required: unknown[] = []
  let ask = ''
  switch (toolName) {
    case 'propose_correct_weights':
      required = [input.fromWeight, input.toWeight]
      ask = 'which logged weight is wrong and what it should be'
      break
    case 'propose_log_body_weight':
      required = [input.weight]
      ask = 'what the scale read'
      break
    case 'propose_edit_session_log':
      required = [input.weight, input.reps, input.rpe]
      ask = 'the exact value the set should have'
      break
    default:
      return null
  }

  const missing = missingFrom(numbersInText(userText), required)
  if (missing.length === 0) return null
  return `The user never gave ${missing.join(' / ')}. Do not guess, infer, or reuse numbers from examples or past data. Ask ONE short question for ${ask}, then call the tool once they answer.`
}
