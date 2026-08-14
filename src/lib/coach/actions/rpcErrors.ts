/** Map tagged Postgres exceptions to the plain-English Coach already uses. */
export function mapCoachRpcError(message: string, fallback: string): string {
  const msg = message || ''
  if (msg.includes('NO_WORKING_SETS')) {
    return 'Log at least one working set (weight and reps, not a warm-up) before finishing.'
  }
  if (msg.includes('UNDO_WINDOW_EXPIRED')) {
    return 'The 10-minute undo window has passed. This workout stays finished.'
  }
  if (msg.includes('REST_BUDGET_EXCEEDED')) {
    return 'No rest days left this week — your weekly rest budget is already used up.'
  }
  if (msg.includes('SESSION_NOT_OPEN')) {
    return 'No open workout to finish (already completed or discarded).'
  }
  if (msg.includes('SESSION_NOT_COMPLETED')) {
    return 'That workout is not finished (or already reopened).'
  }
  if (msg.includes('SESSION_NOT_FOUND')) {
    return 'Could not find that completed workout.'
  }
  if (msg.includes('INVALID_DOW')) {
    return 'Day of week must be Sunday–Saturday (0–6).'
  }
  return fallback
}
