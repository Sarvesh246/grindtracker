'use client'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Exercise } from '@/lib/types'
import { formatHeaderDate, formatShortDate } from '@/lib/utils/formatting'
import ProgressChart from './ProgressChart'
import { useUnit } from '@/lib/contexts/UnitContext'
import { useTour, type TourStep } from '@/components/onboarding/Tour'
import Card from '@/components/ui/Card'

export type Metric = 'weight' | 'volume' | 'e1rm' | 'best'

interface ChartPoint {
  date: string
  displayDate: string
  value: number
  label: string
  isPR: boolean
}

interface ExerciseStats {
  bestWeight: number | null
  sessionCount: number
  lastWeight: number | null
  prCount: number
}

interface RecentSession {
  date: string
  weight: number | null
  reps: number | null
  isPR: boolean
}

interface RawLog {
  weight: number | null
  reps: number | null
  is_pr: boolean
  is_warmup: boolean
  sessions: {
    id: string
    completed_at: string
    local_date: string | null
    user_id: string
  } | {
    id: string
    completed_at: string
    local_date: string | null
    user_id: string
  }[] | null
}

const DAY_ORDER: Record<string, number> = { push: 0, pull: 1, legs: 2 }

/** Upper bound on set logs pulled for one exercise's chart (~4 years of 5x5). */
const MAX_CHART_LOGS = 2000

const METRIC_IDS: { id: Metric; label: string }[] = [
  { id: 'weight', label: 'Weight' },
  { id: 'volume', label: 'Volume' },
  { id: 'e1rm', label: 'e1RM' },
  { id: 'best', label: 'Best Set' },
]

function epley(weight: number, reps: number): number {
  // Epley 1RM estimate. reps==1 returns weight exactly.
  return weight * (1 + reps / 30)
}

export default function ProgressPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { unitLabel, toDisplay } = useUnit()

  const [exercises, setExercises] = useState<Exercise[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [metric, setMetric] = useState<Metric>('weight')
  const [rawLogs, setRawLogs] = useState<RawLog[]>([])
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [stats, setStats] = useState<ExerciseStats>({
    bestWeight: null,
    sessionCount: 0,
    lastWeight: null,
    prCount: 0,
  })
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])
  const [loadingExercises, setLoadingExercises] = useState(true)
  const [loadingChart, setLoadingChart] = useState(false)

  const [photoCount, setPhotoCount] = useState<number | null>(null)
  const [latestPhotoDate, setLatestPhotoDate] = useState<string | null>(null)
  const [latestPhotoThumb, setLatestPhotoThumb] = useState<string | null>(null)

  // Deferred, off the (user_id, taken_date desc) index — zero-photo users
  // (the common case early on) pay just the one cheap count query below and
  // never touch storage.
  useEffect(() => {
    async function loadPhotoSummary() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { count } = await supabase
        .from('progress_photo_groups')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
      setPhotoCount(count ?? 0)
      if (!count) return

      const { data: latest } = await supabase
        .from('progress_photo_groups')
        .select('id, taken_date')
        .eq('user_id', user.id)
        .order('taken_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!latest) return
      setLatestPhotoDate(latest.taken_date)

      const { data: photo } = await supabase
        .from('progress_photos')
        .select('storage_path')
        .eq('group_id', latest.id)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (!photo) return

      const { data: signed } = await supabase.storage
        .from('progress-photos')
        .createSignedUrl(photo.storage_path, 3600)
      if (signed?.signedUrl) setLatestPhotoThumb(signed.signedUrl)
    }
    loadPhotoSummary()
  }, [supabase])

  useEffect(() => {
    async function loadExercises() {
      const { data } = await supabase
        .from('exercises')
        .select('*')
        .order('day_type', { ascending: true })
        .order('sort_order', { ascending: true })

      if (data && data.length > 0) {
        const sorted = [...data].sort((a, b) => {
          const dayDiff = (DAY_ORDER[a.day_type] ?? 0) - (DAY_ORDER[b.day_type] ?? 0)
          if (dayDiff !== 0) return dayDiff
          return a.sort_order - b.sort_order
        })
        setExercises(sorted)
        setSelectedId(sorted[0].id)
        setSelectedDay(sorted[0].day_type)
      }
      setLoadingExercises(false)
    }
    loadExercises()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadRawLogs = useCallback(async (exerciseId: string) => {
    setLoadingChart(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoadingChart(false); return }

    const { data: logs } = await supabase
      .from('session_logs')
      .select(`
        weight,
        reps,
        is_pr,
        is_warmup,
        sessions!inner(
          id,
          completed_at,
          local_date,
          user_id
        )
      `)
      .eq('exercise_id', exerciseId)
      .eq('is_warmup', false)
      .eq('sessions.user_id', user.id)
      .not('sessions.completed_at', 'is', null)
      // Newest-first with a cap, then reversed below for the chart.
      //
      // This was an unbounded fetch of every set ever logged for the exercise.
      // A daily lifter on a 5x5 program generates ~1,300 rows a year, so after a
      // few years the chart payload grows without limit for the heaviest — i.e.
      // most engaged — users. MAX_CHART_LOGS covers several years of history at
      // full resolution and bounds the worst case.
      .order('local_date', { ascending: false, foreignTable: 'sessions' })
      .limit(MAX_CHART_LOGS)

    // Restore ascending (oldest → newest) order the chart expects; the query
    // sorts descending so that the LIMIT keeps the most recent history.
    setRawLogs(((logs ?? []) as RawLog[]).slice().reverse())
    setLoadingChart(false)
  }, [supabase])

  useEffect(() => {
    if (!selectedId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRawLogs(selectedId)
  }, [selectedId, loadRawLogs])

  const recomputeForMetric = useCallback((logs: RawLog[], m: Metric, ul: string) => {
    interface SessionAgg {
      id: string
      completedAt: string
      sets: { weight: number; reps: number; isPR: boolean }[]
      hasPR: boolean
    }
    const map: Record<string, SessionAgg> = {}
    for (const log of logs) {
      const sRaw = log.sessions
      const s = Array.isArray(sRaw) ? sRaw[0] : sRaw
      if (!s) continue
      // Prefer local_date (streak/calendar day) over UTC completed_at.
      const dateKey = s.local_date ?? s.completed_at
      if (!map[s.id]) {
        map[s.id] = { id: s.id, completedAt: dateKey, sets: [], hasPR: false }
      }
      if (log.weight !== null && log.reps !== null) {
        // Convert stored canonical lbs into the active display unit here so every
        // downstream metric (weight/volume/e1RM/best), stat tile, and recent-session
        // value is computed and rendered in the user's chosen unit.
        map[s.id].sets.push({ weight: toDisplay(log.weight), reps: log.reps, isPR: log.is_pr })
      }
      if (log.is_pr) map[s.id].hasPR = true
    }

    const sessions = Object.values(map).sort(
      (a, b) => {
        const aT = /^\d{4}-\d{2}-\d{2}$/.test(a.completedAt)
          ? new Date(a.completedAt + 'T12:00:00').getTime()
          : new Date(a.completedAt).getTime()
        const bT = /^\d{4}-\d{2}-\d{2}$/.test(b.completedAt)
          ? new Date(b.completedAt + 'T12:00:00').getTime()
          : new Date(b.completedAt).getTime()
        return aT - bT
      },
    )

    const points: ChartPoint[] = []
    for (const s of sessions) {
      if (s.sets.length === 0) continue
      let value: number
      let label: string
      switch (m) {
        case 'weight':
          value = Math.round(Math.max(...s.sets.map(x => x.weight)) * 10) / 10
          label = value === 0 ? 'BW' : `${value} ${ul}`
          break
        case 'volume':
          value = Math.round(s.sets.reduce((sum, x) => sum + x.weight * x.reps, 0))
          label = `${value.toLocaleString()} ${ul} · vol`
          break
        case 'e1rm': {
          const e = Math.max(...s.sets.map(x => epley(x.weight, x.reps)))
          value = Math.round(e * 10) / 10
          label = `${value} ${ul} e1RM`
          break
        }
        case 'best': {
          const best = s.sets.reduce((b, x) => (x.weight > b.weight ? x : b), s.sets[0])
          value = Math.round(best.weight * 10) / 10
          label = value === 0 ? `BW × ${best.reps}` : `${value} × ${best.reps}`
          break
        }
      }
      const display = /^\d{4}-\d{2}-\d{2}$/.test(s.completedAt)
        ? new Date(s.completedAt + 'T12:00:00')
        : new Date(s.completedAt)
      points.push({
        date: s.completedAt,
        displayDate: display.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        value,
        label,
        isPR: s.hasPR,
      })
    }

    const weights = sessions.flatMap(s => s.sets.map(x => x.weight))
    const bestWeight = weights.length > 0 ? Math.round(Math.max(...weights) * 10) / 10 : null
    const last = sessions.length > 0 ? sessions[sessions.length - 1] : null
    const lastWeight = last && last.sets.length > 0 ? Math.round(Math.max(...last.sets.map(x => x.weight)) * 10) / 10 : null
    const prCount = logs.filter(l => l.is_pr).length

    const recent: RecentSession[] = sessions
      .slice(-8)
      .reverse()
      .map(s => {
        const best = s.sets.length > 0
          ? s.sets.reduce((b, x) => (x.weight > b.weight ? x : b), s.sets[0])
          : null
        return {
          date: new Date(s.completedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          weight: best ? Math.round(best.weight * 10) / 10 : null,
          reps: best?.reps ?? null,
          isPR: s.hasPR,
        }
      })

    setChartData(points)
    setStats({ bestWeight, sessionCount: sessions.length, lastWeight, prCount })
    setRecentSessions(recent)
  }, [toDisplay])

  // Recompute the chart/stats from the raw logs whenever they or the selected
  // metric change (recomputeForMetric does the setState work internally).
  useEffect(() => {
    if (rawLogs.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChartData([])
      setStats({ bestWeight: null, sessionCount: 0, lastWeight: null, prCount: 0 })
      setRecentSessions([])
      return
    }
    recomputeForMetric(rawLogs, metric, unitLabel)
  }, [rawLogs, metric, unitLabel, recomputeForMetric])

  const selectedExercise = exercises.find(e => e.id === selectedId)
  const dayTypes = [...new Set(exercises.map(e => e.day_type))].sort(
    (a, b) => (DAY_ORDER[a] ?? 9) - (DAY_ORDER[b] ?? 9),
  )
  const exercisesForDay = selectedDay ? exercises.filter(e => e.day_type === selectedDay) : exercises

  // Two-step walkthrough (hook must run before the early returns below). Only
  // active once exercises exist — the blank-slate hero has nothing to point at.
  const progressSteps: TourStep[] = [
    { target: 'progress-selector', title: 'Pick what to chart', body: 'Choose which lift or metric to chart.' },
    { target: 'progress-chart', title: 'Read your chart', body: 'Each point is a working set; the highlighted ones are PRs.' },
  ]
  const progressTour = useTour('progress', progressSteps, {
    active: !loadingExercises && exercises.length > 0,
  })

  if (loadingExercises) {
    return (
      <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", fontSize: '14px' }}>
        Loading...
      </div>
    )
  }

  // Blank slate — no exercises means the day/exercise pickers, metric toggle and
  // chart would all render as an empty, broken-looking shell (previously "No data
  // yet for" with no name). Replace the whole thing with one clear hero that
  // routes into workout setup, matching Home + DaySelect's first-run language.
  if (exercises.length === 0) {
    return (
      <div className="page page--progress" style={{ fontFamily: "'DM Sans', sans-serif", paddingBottom: '32px' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '24px 16px 16px',
        }}>
          <h1 style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '32px', color: 'var(--text-primary)', letterSpacing: '1px',
            fontWeight: 'normal',
          }}>
            PROGRESS
          </h1>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {formatHeaderDate()}
          </span>
        </div>

        <div style={{ padding: '0 16px 8px' }}>
          <PhotoEntryCard
            count={photoCount}
            latestDate={latestPhotoDate}
            thumb={latestPhotoThumb}
            onClick={() => router.push('/progress/photos')}
          />
        </div>

        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center', gap: '16px', padding: '48px 24px 40px',
        }}>
          <span style={{
            width: '76px', height: '76px', borderRadius: '9999px',
            backgroundColor: 'var(--accent-wash)', color: 'var(--accent-text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
              <line x1="2" y1="20" x2="22" y2="20"/>
            </svg>
          </span>
          <h2 style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: '28px',
            color: 'var(--text-primary)', letterSpacing: '1px', lineHeight: 1, margin: 0,
          }}>
            NO PROGRESS YET
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '320px', lineHeight: 1.5 }}>
            Set up a workout and log a session — your lifts chart here, tracking
            weight, volume, e1RM, and every PR over time.
          </p>
          <button
            onClick={() => router.push('/log?new=1')}
            style={{
              marginTop: '4px', height: '52px', padding: '0 32px',
              backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: 'none',
              borderRadius: '12px', fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '20px', letterSpacing: '1px', cursor: 'pointer',
            }}
          >
            SET UP A WORKOUT
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page page--progress" style={{ fontFamily: "'DM Sans', sans-serif", paddingBottom: '32px' }}>
      {progressTour}

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '24px 16px 16px',
      }}>
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '32px', color: 'var(--text-primary)', letterSpacing: '1px',
          fontWeight: 'normal',
        }}>
          PROGRESS
        </h1>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {formatHeaderDate()}
        </span>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <PhotoEntryCard
          count={photoCount}
          latestDate={latestPhotoDate}
          thumb={latestPhotoThumb}
          onClick={() => router.push('/progress/photos')}
        />
      </div>

      {/* Selector cluster — day picker, exercise picker, and metric toggle. Wrapped
          so the onboarding coach mark can spotlight the whole "what to chart" area. */}
      <div data-onboard="progress-selector">

      {/* Day picker (level 1) */}
      <div style={{ padding: '0 16px 8px', display: 'flex', gap: '6px', overflowX: 'auto' }} className="scrollbar-hide">
        {dayTypes.map(dt => {
          const active = dt === selectedDay
          return (
            <button
              key={dt}
              className="press"
              onClick={() => {
                setSelectedDay(dt)
                const first = exercises.find(e => e.day_type === dt)
                if (first) setSelectedId(first.id)
              }}
              aria-pressed={active}
              style={{
                height: '32px',
                padding: '0 14px',
                borderRadius: 'var(--radius-pill, 9999px)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                backgroundColor: active ? 'rgba(200, 241, 53, 0.12)' : 'var(--surface)',
                color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-sans)',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: 'var(--tracking-label)',
                textTransform: 'uppercase',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {dt.replace(/-/g, ' ')}
            </button>
          )
        })}
      </div>

      {/* Divider */}
      <div style={{ margin: '4px 16px 12px', borderTop: '1px solid var(--border)' }} />

      {/* Exercise picker (level 2) */}
      <div style={{ padding: '0 16px 12px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {exercisesForDay.map(ex => {
          const active = ex.id === selectedId
          return (
            <button
              key={ex.id}
              className="press"
              onClick={() => setSelectedId(ex.id)}
              aria-pressed={active}
              style={{
                height: '34px',
                padding: '0 12px',
                borderRadius: 'var(--radius-pill, 9999px)',
                border: active ? 'none' : '1px solid var(--border)',
                backgroundColor: active ? 'var(--accent)' : 'var(--surface)',
                color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
                fontSize: '13px',
                fontFamily: 'var(--font-sans)',
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {ex.name}
            </button>
          )
        })}
      </div>

      {/* Metric toggle */}
      <div style={{ padding: '0 16px 12px' }}>
        <div
          role="tablist"
          aria-label="Chart metric"
          style={{
            display: 'flex',
            gap: '4px',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '4px',
          }}
        >
          {METRIC_IDS.map(m => {
            const active = m.id === metric
            return (
              <button
                key={m.id}
                className="press"
                role="tab"
                aria-selected={active}
                onClick={() => setMetric(m.id)}
                style={{
                  flex: 1,
                  height: '34px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  backgroundColor: active ? 'var(--accent)' : 'transparent',
                  color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
                  fontSize: '12px',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      </div>{/* end selector cluster */}

      {/* Stats bar. Keyed on the selection so the tiles re-run their entrance
          when you switch exercise or metric — the numbers all change at once,
          and swapping them in place reads as a glitch. */}
      <div
        key={`${selectedId}-${metric}`}
        className="stagger"
        style={{ display: 'flex', gap: '6px', padding: '0 16px', marginBottom: '16px' }}
      >
        {[
          { label: 'BEST', value: stats.bestWeight !== null ? (stats.bestWeight === 0 ? 'BW' : `${stats.bestWeight} ${unitLabel}`) : '—', accent: true },
          { label: 'SESSIONS', value: String(stats.sessionCount), accent: false },
          { label: 'LAST', value: stats.lastWeight !== null ? (stats.lastWeight === 0 ? 'BW' : `${stats.lastWeight} ${unitLabel}`) : '—', accent: false },
          { label: 'PRs', value: String(stats.prCount), accent: false },
        ].map((stat, i) => (
          <div key={stat.label} style={{
            '--i': i,
            flex: 1,
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '10px 6px',
            textAlign: 'center',
          } as CSSProperties}>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '22px',
              color: stat.accent ? 'var(--accent-text)' : 'var(--text-primary)',
              lineHeight: 1,
              marginBottom: '3px',
            }}>
              {stat.value}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ padding: '0 16px', marginBottom: '24px' }}>
        <div data-onboard="progress-chart" style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '16px 12px 12px',
          minHeight: '220px',
          // Column flex (not row) so children stretch to the card's full width —
          // the chart + data table wrapper would otherwise shrink-wrap to its
          // content as a row flex item and render narrow. justifyContent still
          // vertically centers the loading / empty states.
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}>
          {loadingChart ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center' }}>Loading...</div>
          ) : chartData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--border-strong)' }}>
                  <line x1="18" y1="20" x2="18" y2="10"/>
                  <line x1="12" y1="20" x2="12" y2="4"/>
                  <line x1="6" y1="20" x2="6" y2="14"/>
                  <line x1="2" y1="20" x2="22" y2="20"/>
                </svg>
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                No data yet for<br />
                <span style={{ color: 'var(--text-secondary)' }}>{selectedExercise?.name ?? 'this exercise'}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--border-strong)', marginTop: '8px' }}>
                Log this exercise to see progress
              </div>
            </div>
          ) : (
            // Keyed so switching exercise or metric replays the entrance
            // instead of hard-cutting one series into the next.
            <div key={`${selectedId}-${metric}`} className="swap-in" style={{ width: '100%' }}>
              <ProgressChart data={chartData} />
            </div>
          )}
        </div>
      </div>

      {/* Recent sessions */}
      {recentSessions.length > 0 && (
        <div style={{ padding: '0 16px' }}>
          <div style={{
            fontSize: '12px', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '1.5px',
            marginBottom: '10px',
          }}>
            RECENT SESSIONS
          </div>

          <div
            key={`${selectedId}-${metric}`}
            className="stagger"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          >
            {recentSessions.map((session, i) => (
              <div
                key={i}
                style={{
                  '--i': i,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '11px 16px',
                  backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                  borderBottom: i < recentSessions.length - 1 ? '1px solid var(--border)' : 'none',
                } as CSSProperties}
              >
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                  {session.date}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {session.isPR && (
                    <span style={{
                      fontSize: '10px',
                      fontFamily: "'Bebas Neue', sans-serif",
                      color: 'var(--accent-text)',
                      backgroundColor: 'rgba(200, 241, 53, 0.1)',
                      border: '1px solid rgba(200, 241, 53, 0.3)',
                      borderRadius: '9999px',
                      padding: '2px 8px',
                      letterSpacing: '0.5px',
                    }}>
                      PR
                    </span>
                  )}
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '14px',
                    color: session.weight !== null ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}>
                    {session.weight !== null && session.reps !== null
                      ? `${session.weight === 0 ? 'BW' : session.weight} × ${session.reps}`
                      : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Entry point into /progress/photos — one full-width row, not a whole
 * section, so the primary lift-chart flow above stays uncluttered. Renders
 * icon+label immediately; the thumbnail/count fill in once the (cheap,
 * deferred) summary query resolves.
 */
function PhotoEntryCard({
  count,
  latestDate,
  thumb,
  onClick,
}: {
  count: number | null
  latestDate: string | null
  thumb: string | null
  onClick: () => void
}) {
  const subtitle = count === null
    ? ''
    : count === 0
      ? 'Add your first photo'
      : `Last logged ${latestDate ? formatShortDate(latestDate) : ''} · ${count} photo${count === 1 ? '' : 's'}`

  return (
    <Card
      as="section"
      padding="sm"
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
    >
      <span style={{
        width: '42px', height: '42px', borderRadius: '9999px', flexShrink: 0,
        backgroundColor: 'var(--accent-wash)', color: 'var(--accent-text)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="15" rx="2" /><circle cx="8.5" cy="10.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
        </svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '15px', letterSpacing: '0.5px', color: 'var(--text-primary)' }}>
          PROGRESS PHOTOS
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '1px' }}>
          {subtitle}
        </div>
      </div>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          style={{ width: '38px', height: '38px', borderRadius: 'var(--radius-sm)', objectFit: 'cover', flexShrink: 0 }}
        />
      )}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Card>
  )
}
