'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { useUnit } from '@/lib/contexts/UnitContext'
import { workoutHeart, type HrSet, type RibbonBead, type WorkoutHeart } from '@/lib/body'

/**
 * A watch workout's heart rate on its past-workout screen: one sentence, the
 * trace as a line that dips in the rests, and a bead per set at its peak,
 * coloured by zone. Tap a bead for the set. Loads its own columns (migration
 * 59) and renders nothing for web-logged workouts or when they can't be read.
 */

const H = 132
const PAD_TOP = 14
const PAD_BOTTOM = 10

const ZONE_VAR = ['var(--zone-1)', 'var(--zone-1)', 'var(--zone-2)', 'var(--zone-3)', 'var(--zone-4)', 'var(--zone-5)']

export default function HeartbeatRibbon({ sessionId }: { sessionId: string }) {
  const { demoMode } = useDemoMode()
  const supabase = useMemo(() => createClient(), [])
  const [data, setData] = useState<WorkoutHeart | null>(null)

  useEffect(() => {
    if (demoMode) return
    let cancelled = false
    void (async () => {
      const [sessRes, logsRes] = await Promise.all([
        supabase
          .from('sessions')
          .select('started_at, hr_trace, hr_step, hr_zones, zone_seconds, avg_heart_rate')
          .eq('id', sessionId)
          .maybeSingle(),
        supabase
          .from('session_logs')
          .select('exercise_id, set_number, weight, reps, hr_peak, hr_end, hr_rest_drop_60, created_at, is_warmup, is_skipped')
          .eq('session_id', sessionId),
      ])
      if (cancelled || sessRes.error || logsRes.error || !sessRes.data?.started_at) return
      const s = sessRes.data
      const logs = (logsRes.data ?? []).filter(l => !l.is_skipped)
      if (!s.hr_trace && !logs.some(l => l.hr_peak != null)) return

      const ids = [...new Set(logs.map(l => l.exercise_id as string))]
      const names = new Map<string, string>()
      if (ids.length) {
        const { data: exs } = await supabase.from('exercises').select('id, name').in('id', ids)
        for (const e of exs ?? []) names.set(e.id as string, e.name as string)
      }
      if (cancelled) return
      const sets: HrSet[] = logs.map(l => ({
        exercise_id: l.exercise_id as string,
        exercise_name: names.get(l.exercise_id as string),
        set_number: l.set_number as number,
        weight: l.weight as number | null,
        reps: l.reps as number | null,
        hr_peak: l.hr_peak as number | null,
        hr_end: l.hr_end as number | null,
        hr_rest_drop_60: l.hr_rest_drop_60 as number | null,
        completed_at: l.created_at as string | null,
      }))
      const heart = workoutHeart({
        started_at: s.started_at as string,
        hr_trace: s.hr_trace as number[] | null,
        hr_step: s.hr_step as number | null,
        hr_zones: s.hr_zones as number[] | null,
        zone_seconds: s.zone_seconds as number[] | null,
        avg_heart_rate: s.avg_heart_rate as number | null,
        sets,
      })
      if (heart) setData(heart)
    })()
    return () => { cancelled = true }
  }, [sessionId, supabase, demoMode])

  if (demoMode || !data) return null
  return <HeartbeatRibbonView heart={data} />
}

/** The ribbon itself, from an already-computed workoutHeart(). */
export function HeartbeatRibbonView({ heart }: { heart: WorkoutHeart }) {
  const { fmt, unitLabel } = useUnit()
  const [picked, setPicked] = useState<number | null>(null)
  const traceEnd = heart.points.length ? heart.points[heart.points.length - 1][0] : 0
  const beadEnd = heart.beads.length ? heart.beads[heart.beads.length - 1].at : 0
  const duration = Math.max(traceEnd, beadEnd, 60)

  // Beads without set timestamps share x = 0; spread those evenly instead.
  const timed = heart.beads.some(b => b.at > 0)
  const beadX = (b: RibbonBead, i: number) =>
    timed ? b.at / duration : (i + 0.5) / Math.max(1, heart.beads.length)

  const values = [...heart.points.map(p => p[1]), ...heart.beads.map(b => b.peak)]
  const lo = Math.min(...values) - 6
  const hi = Math.max(...values) + 6
  const yOf = (bpm: number) => PAD_TOP + (1 - (bpm - lo) / Math.max(1, hi - lo)) * (H - PAD_TOP - PAD_BOTTOM)

  // Break the line at gaps longer than a minute so a dropped signal isn't drawn as a plateau.
  let d = ''
  heart.points.forEach(([t, v], i) => {
    const gap = i > 0 && t - heart.points[i - 1][0] > 60
    d += `${i === 0 || gap ? 'M' : 'L'}${(t / duration) * 1000},${yOf(v)} `
  })

  const zonesSeen = new Set(heart.beads.map(b => b.zone))
  const legend = [2, 3, 4, 5].filter(z => zonesSeen.has(z) || (heart.zoneSeconds?.[z - 1] ?? 0) > 0)
  const sel = picked != null ? heart.beads[picked] : null
  const footer = [
    heart.avg != null ? `avg ${heart.avg}` : null,
    heart.minutesHard != null ? `${heart.minutesHard} min in Z3+` : null,
  ].filter(Boolean).join(' · ')

  const setWeight = (set: HrSet) =>
    set.weight == null ? '—' : set.weight === 0 ? 'BW' : `${fmt(set.weight)} ${unitLabel}`

  return (
    <section
      className="swap-in"
      aria-label="Heart rate for this workout"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Heart rate
        </div>
        {heart.sentence && (
          <p style={{ fontSize: '14px', lineHeight: 1.45, color: 'var(--text-primary)', fontWeight: 500 }}>{heart.sentence}</p>
        )}
      </div>

      <div style={{ position: 'relative', height: H }}>
        <svg
          role="img"
          aria-label={heart.sentence ?? `Heart rate trace${footer ? `, ${footer}` : ''}.`}
          width="100%"
          height={H}
          viewBox={`0 0 1000 ${H}`}
          preserveAspectRatio="none"
          style={{ display: 'block' }}
        >
          <line x1={0} x2={1000} y1={H - 1} y2={H - 1} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {d && (
            <path
              d={d}
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {heart.beads.map((b, i) => {
          const active = picked === i
          const name = b.set.exercise_name ?? 'Set'
          return (
            <button
              key={`${b.set.exercise_id}-${b.set.set_number}`}
              type="button"
              className="hit-44"
              data-haptic="light"
              aria-pressed={active}
              aria-label={`${name} set ${b.set.set_number}: peak ${b.peak} bpm, zone ${b.zone}`}
              onClick={() => setPicked(active ? null : i)}
              style={{
                position: 'absolute',
                left: `${beadX(b, i) * 100}%`,
                top: yOf(b.peak),
                width: active ? 16 : 12,
                height: active ? 16 : 12,
                transform: 'translate(-50%, -50%)',
                borderRadius: '9999px',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                backgroundColor: ZONE_VAR[b.zone] ?? 'var(--zone-1)',
                boxShadow: active
                  ? '0 0 0 2px var(--surface), 0 0 0 4px var(--text-primary)'
                  : '0 0 0 2px var(--surface)',
                transition: 'width 150ms ease, height 150ms ease, box-shadow 150ms ease',
              }}
            />
          )
        })}
      </div>

      {sel && (
        <div
          key={picked}
          className="swap-in"
          role="status"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: '4px 12px',
            padding: '12px 14px',
            borderRadius: '10px',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
          }}
        >
          <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>
            {sel.set.exercise_name ?? 'Set'} · set {sel.set.set_number}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-primary)' }}>
            {setWeight(sel.set)}{sel.set.reps != null ? ` × ${sel.set.reps}` : ''}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Peak <span style={{ fontFamily: 'var(--font-mono)' }}>{sel.peak}</span> bpm
            {sel.zone > 0 ? ` · zone ${sel.zone}` : ''}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right' }}>
            {sel.set.hr_rest_drop_60 != null
              ? <>Dropped <span style={{ fontFamily: 'var(--font-mono)' }}>{sel.set.hr_rest_drop_60}</span> in the next minute</>
              : 'No rest reading after'}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        {footer && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>{footer}</span>
        )}
        {legend.length > 0 && (
          <ul aria-label="Zone colours" style={{ listStyle: 'none', display: 'flex', gap: '6px' }}>
            {legend.map(z => (
              <li
                key={z}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  height: '22px', padding: '0 8px', borderRadius: '9999px',
                  border: '1px solid var(--border)',
                  fontSize: '10px', fontWeight: 600, letterSpacing: '1px', color: 'var(--text-muted)',
                }}
              >
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '9999px', backgroundColor: ZONE_VAR[z] }} />
                Z{z}
              </li>
            ))}
          </ul>
        )}
      </div>

      {heart.beads.length > 0 && (
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Set peaks are approximate: wrist heart rate lags during heavy lifts.
        </p>
      )}
    </section>
  )
}
