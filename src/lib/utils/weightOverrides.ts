/**
 * sessions.weight_overrides (migration 60): today-only prefill weights the
 * Coach set, exercise id → canonical lbs. The column is JSON, so anything that
 * isn't a sane weight is dropped rather than trusted.
 */
export function parseWeightOverrides(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
    if (id && Number.isFinite(n) && n >= 0 && n <= 2000) out[id] = n
  }
  return out
}
