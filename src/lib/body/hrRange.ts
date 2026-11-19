/**
 * The spread the 15-min heart-rate averages flatten. The watch sends every
 * all-day HR sample it stored (about one a minute) with each snapshot, with a
 * minute of overlap between snapshots, so samples are merged by time first.
 */

export interface HrRange {
  /** 96 × 15-min buckets from local midnight: lowest and highest sample. */
  low: (number | null)[]
  high: (number | null)[]
}

/** Buckets with fewer samples than this show no range: one or two readings
 *  aren't a spread. */
const MIN_SAMPLES = 3

export function hrRange(rows: { hr_t: number[] | null; hr_v: number[] | null }[]): HrRange | null {
  const byTime = new Map<number, number>()
  for (const r of rows) {
    if (!r.hr_t || !r.hr_v) continue
    r.hr_t.forEach((t, i) => {
      const v = r.hr_v![i]
      if (v != null) byTime.set(t, v)
    })
  }
  const low: (number | null)[] = new Array(96).fill(null)
  const high: (number | null)[] = new Array(96).fill(null)
  const n = new Array(96).fill(0)
  for (const [t, v] of byTime) {
    const b = Math.floor(t / 900)
    if (b < 0 || b > 95) continue
    n[b]++
    low[b] = low[b] == null ? v : Math.min(low[b]!, v)
    high[b] = high[b] == null ? v : Math.max(high[b]!, v)
  }
  for (let b = 0; b < 96; b++) {
    if (n[b] < MIN_SAMPLES) { low[b] = null; high[b] = null }
  }
  return low.some(v => v != null) ? { low, high } : null
}
