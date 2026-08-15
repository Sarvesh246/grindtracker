/** Default 40 / 60 / 80% ramp into the working set. */
export const DEFAULT_WARMUP_PERCENTS = [40, 60, 80]
export const MIN_WARMUP_PERCENT = 5
export const MAX_WARMUP_PERCENT = 95
export const MAX_WARMUP_SETS = 5

export const WARMUP_PREF_KEY = 'grind_warmup_pref'

export function clampWarmupPercent(n: number): number {
  if (!Number.isFinite(n)) return 40
  return Math.min(MAX_WARMUP_PERCENT, Math.max(MIN_WARMUP_PERCENT, Math.round(n)))
}

/**
 * Coerce stored / typed percents into 0–5 unique-enough values in 5–95.
 * Empty means the user turned the ramp off.
 */
export function normalizeWarmupPercents(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WARMUP_PERCENTS]
  const nums: number[] = []
  for (const item of raw) {
    const n = typeof item === 'number' ? item : Number(item)
    if (!Number.isFinite(n) || n <= 0 || n >= 100) continue
    nums.push(clampWarmupPercent(n))
    if (nums.length >= MAX_WARMUP_SETS) break
  }
  return nums
}

export function percentsToFractions(percents: number[]): number[] {
  return percents.map(p => p / 100)
}

export function parseWarmupPrefRaw(raw: string | null | undefined): number[] {
  if (!raw || !raw.trim()) return [...DEFAULT_WARMUP_PERCENTS]
  try {
    return normalizeWarmupPercents(JSON.parse(raw) as unknown)
  } catch {
    const parts = raw.split(/[,\s]+/).filter(Boolean)
    if (parts.length === 0) return [...DEFAULT_WARMUP_PERCENTS]
    return normalizeWarmupPercents(parts)
  }
}

export function readWarmupPercents(): number[] {
  if (typeof window === 'undefined') return [...DEFAULT_WARMUP_PERCENTS]
  try {
    const cookie = document.cookie.match(/(?:^|;\s*)grind_warmup_pref=([^;]*)/)
    if (cookie?.[1]) return parseWarmupPrefRaw(decodeURIComponent(cookie[1]))
  } catch {
    /* ignore */
  }
  try {
    return parseWarmupPrefRaw(window.localStorage.getItem(WARMUP_PREF_KEY))
  } catch {
    return [...DEFAULT_WARMUP_PERCENTS]
  }
}

export function writeWarmupPercents(percents: number[]) {
  const normalized = normalizeWarmupPercents(percents)
  const encoded = encodeURIComponent(JSON.stringify(normalized))
  try {
    document.cookie = `${WARMUP_PREF_KEY}=${encoded};path=/;max-age=31536000;samesite=lax`
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.setItem(WARMUP_PREF_KEY, JSON.stringify(normalized))
  } catch {
    /* ignore */
  }
}

/** Tooltip / settings copy, e.g. "40%, 60%, then 80%". */
export function formatWarmupPercentsList(percents: number[]): string {
  if (percents.length === 0) return 'none'
  if (percents.length === 1) return `${percents[0]}%`
  if (percents.length === 2) return `${percents[0]}% then ${percents[1]}%`
  const head = percents.slice(0, -1).map(p => `${p}%`).join(', ')
  return `${head}, then ${percents[percents.length - 1]}%`
}
