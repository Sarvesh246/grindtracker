import { localDateKey } from '@/lib/utils/formatting'

export type GrindExportPayload = {
  exported_at: string
  format_version: 1
  profile: {
    username: string | null
    display_name: string | null
  }
  stats: Record<string, unknown> | null
  sessions: unknown[]
  session_logs: unknown[]
  exercises: unknown[]
  body_weights: unknown[]
  badges: unknown[]
  rest_days: unknown[]
  rest_dates: unknown[]
}

/** Build a filename-safe export basename for the current local day. */
export function exportFilename(prefix = 'grind-export'): string {
  return `${prefix}-${localDateKey()}.json`
}

/** Trigger a browser download of a JSON blob. */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Flatten sessions + logs into CSV rows (one row per set). */
export function sessionsLogsToCsv(
  sessions: Array<{
    id: string
    day_type: string
    local_date?: string | null
    started_at: string
    completed_at: string | null
    xp_earned: number
    note: string | null
  }>,
  logs: Array<{
    session_id: string
    exercise_id: string
    set_number: number
    weight: number | null
    reps: number | null
    is_pr: boolean
    is_warmup?: boolean
    is_skipped?: boolean
    note?: string | null
    rpe?: number | null
  }>,
  exerciseNames: Record<string, string>,
): string {
  const sessionById = new Map(sessions.map(s => [s.id, s]))
  const header = [
    'local_date',
    'day_type',
    'started_at',
    'completed_at',
    'xp_earned',
    'session_note',
    'exercise',
    'set_number',
    'weight_lbs',
    'reps',
    'rpe',
    'is_pr',
    'is_warmup',
    'is_skipped',
    'set_note',
  ]
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = [header.join(',')]
  for (const log of logs) {
    const s = sessionById.get(log.session_id)
    if (!s) continue
    rows.push(
      [
        s.local_date ?? '',
        s.day_type,
        s.started_at,
        s.completed_at ?? '',
        s.xp_earned,
        s.note ?? '',
        exerciseNames[log.exercise_id] ?? log.exercise_id,
        log.set_number,
        log.weight ?? '',
        log.reps ?? '',
        log.rpe ?? '',
        log.is_pr,
        !!log.is_warmup,
        !!log.is_skipped,
        log.note ?? '',
      ]
        .map(escape)
        .join(','),
    )
  }
  return rows.join('\n')
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
