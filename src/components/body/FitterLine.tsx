'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient, getClientUser } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { useUnit } from '@/lib/contexts/UnitContext'
import { fitterLine, type DatedHrSet, type FitterLine as FitterLineData } from '@/lib/body'

/**
 * "Getting fitter" under an exercise's progress chart: the same weight and
 * reps compared by peak heart rate, then vs now. Only speaks when fitterLine()
 * finds enough comparable watch sets; otherwise (and for web-only users, or
 * before migration 59) it renders nothing.
 */

const MAX_ROWS = 400

export default function FitterLine({ exerciseId }: { exerciseId: string }) {
  const { demoMode } = useDemoMode()
  const { fmt, unitLabel } = useUnit()
  const supabase = useMemo(() => createClient(), [])
  const [sets, setSets] = useState<DatedHrSet[] | null>(null)

  useEffect(() => {
    if (demoMode) return
    let cancelled = false
    void (async () => {
      const user = await getClientUser(supabase)
      if (!user || cancelled) return
      const { data, error } = await supabase
        .from('session_logs')
        .select('exercise_id, set_number, weight, reps, hr_peak, hr_end, hr_rest_drop_60, sessions!inner(local_date, user_id, completed_at)')
        .eq('exercise_id', exerciseId)
        .eq('is_warmup', false)
        .not('hr_peak', 'is', null)
        .eq('sessions.user_id', user.id)
        .not('sessions.completed_at', 'is', null)
        .order('local_date', { ascending: false, foreignTable: 'sessions' })
        .limit(MAX_ROWS)
      if (cancelled) return
      if (error || !data) { setSets(null); return }
      const out: DatedHrSet[] = []
      for (const row of data) {
        const raw = row.sessions as unknown
        const s = (Array.isArray(raw) ? raw[0] : raw) as { local_date: string | null } | null
        if (!s?.local_date) continue
        out.push({
          exercise_id: row.exercise_id as string,
          set_number: row.set_number as number,
          weight: row.weight as number | null,
          reps: row.reps as number | null,
          hr_peak: row.hr_peak as number | null,
          hr_end: row.hr_end as number | null,
          hr_rest_drop_60: row.hr_rest_drop_60 as number | null,
          local_date: s.local_date,
        })
      }
      setSets(out)
    })()
    return () => { cancelled = true }
  }, [exerciseId, supabase, demoMode])

  const line = useMemo(
    () => (sets ? fitterLine(sets, w => (w === 0 ? 'BW' : `${fmt(w)} ${unitLabel}`)) : null),
    [sets, fmt, unitLabel],
  )
  if (demoMode || !line) return null
  return <FitterLineView line={line} />
}

/** The card itself, from an already-computed fitterLine(). */
export function FitterLineView({ line }: { line: FitterLineData }) {
  const easier = line.deltaBpm > 0
  // Tiny two-point picture: then on the left, now on the right, higher = harder.
  const W = 120
  const Hh = 44
  const lo = Math.min(line.earlierAvg, line.recentAvg)
  const hi = Math.max(line.earlierAvg, line.recentAvg)
  const y = (v: number) => 8 + (1 - (v - lo) / Math.max(1, hi - lo)) * (Hh - 16)

  return (
    <div style={{ padding: '0 16px', marginBottom: '24px' }}>
      <div
        className="swap-in"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
            {easier ? 'Getting fitter' : 'Working harder'}
          </div>
          {/* Its own line: "185 lbs × 8" breaking after the number reads as two things. */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {line.label}
          </div>
          <p style={{ fontSize: '14px', lineHeight: 1.4, color: 'var(--text-primary)', fontWeight: 500 }}>{line.sentence}</p>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
          <svg
            role="img"
            aria-label={`Peak heart rate ${Math.round(line.earlierAvg)} bpm in ${line.then}, ${Math.round(line.recentAvg)} bpm now.`}
            width={W}
            height={Hh}
            viewBox={`0 0 ${W} ${Hh}`}
          >
            <line x1={14} y1={y(line.earlierAvg)} x2={W - 14} y2={y(line.recentAvg)} stroke="var(--border-strong)" strokeWidth={2} strokeLinecap="round" />
            <circle cx={14} cy={y(line.earlierAvg)} r={5} fill="var(--text-muted)" />
            <circle cx={W - 14} cy={y(line.recentAvg)} r={6} fill={easier ? 'var(--accent)' : 'var(--text-primary)'} />
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
            <span>{Math.round(line.earlierAvg)}</span>
            <span style={{ color: 'var(--text-primary)' }}>{Math.round(line.recentAvg)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
