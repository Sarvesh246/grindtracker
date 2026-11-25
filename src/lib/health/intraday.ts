import { clockLabel } from './model'
import { formatSyncTime } from '../utils/formatting'

/** Pure helpers for the watch's all-day data (migration 69) on the Health page. */

/**
 * The step total only reaches the server at each sync, so between syncs the
 * curve is drawn straight from one reading to the next, starting from 0 at
 * midnight (the watch's counter resets then). Nothing is drawn past the last
 * sync. A later reading lower than an earlier one (the counter can't go back)
 * is ignored.
 */
export function stepCurve(values: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array(96).fill(null)
  const known: [number, number][] = [[0, 0]]
  for (let i = 0; i < Math.min(96, values.length); i++) {
    const v = values[i]
    if (v == null) continue
    if (i === 0) known[0] = [0, v]
    else if (v >= known[known.length - 1][1]) known.push([i, v])
  }
  if (known.length === 1 && values[0] == null) return out
  for (let k = 0; k < known.length; k++) {
    const [i, v] = known[k]
    out[i] = v
    const next = known[k + 1]
    if (!next) break
    for (let j = i + 1; j < next[0]; j++) out[j] = Math.round(v + ((next[1] - v) * (j - i)) / (next[0] - i))
  }
  return out
}

/** "Received 2:14 PM (background) · 31 syncs, 27 in the background". `syncs`
 *  is that date's sync log, newest first; before migration 69 it is empty and
 *  only the row's last write is known. */
export function receivedText(
  syncs: { received_at: string; source: 'app' | 'background' }[],
  syncedAt: string | null
): string {
  const last = syncs[0]
  if (!last) return syncedAt ? `Received ${formatSyncTime(syncedAt)}` : 'Nothing received for this date'
  const how = last.source === 'background' ? 'background' : 'watch app open'
  const bg = syncs.filter((s) => s.source === 'background').length
  const count = syncs.length === 1 ? '1 sync' : `${syncs.length} syncs`
  return `Received ${clockLabel(last.received_at)} (${how}) · ${count}, ${bg} in the background`
}

