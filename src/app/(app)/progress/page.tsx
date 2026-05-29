'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Exercise } from '@/lib/types'
import { formatHeaderDate } from '@/lib/utils/formatting'
import ProgressChart from './ProgressChart'
import { useUnit } from '@/lib/contexts/UnitContext'

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
  sessions: { id: string; completed_at: string; user_id: string } | { id: string; completed_at: string; user_id: string }[] | null
}

const DAY_ORDER: Record<string, number> = { push: 0, pull: 1, legs: 2 }

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
  const supabase = createClient()
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

  useEffect(() => {
    if (!selectedId) return
    loadRawLogs(selectedId) // eslint-disable-line react-hooks/immutability
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  useEffect(() => {
    if (rawLogs.length === 0) {
      setChartData([]) // eslint-disable-line react-hooks/set-state-in-effect
      setStats({ bestWeight: null, sessionCount: 0, lastWeight: null, prCount: 0 })
      setRecentSessions([])
      return
    }
    recomputeForMetric(rawLogs, metric, unitLabel, toDisplay) // eslint-disable-line react-hooks/immutability
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawLogs, metric, unitLabel])

  async function loadRawLogs(exerciseId: string) {
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
          user_id
        )
      `)
      .eq('exercise_id', exerciseId)
      .eq('is_warmup', false)
      .eq('sessions.user_id', user.id)
      .not('sessions.completed_at', 'is', null)
      .order('completed_at', { ascending: true, foreignTable: 'sessions' })

    setRawLogs((logs ?? []) as RawLog[])
    setLoadingChart(false)
  }

  function recomputeForMetric(logs: RawLog[], m: Metric, ul: string, td: (kg: number) => number) {
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
      if (!map[s.id]) {
        map[s.id] = { id: s.id, completedAt: s.completed_at, sets: [], hasPR: false }
      }
      if (log.weight !== null && log.reps !== null) {
        map[s.id].sets.push({ weight: log.weight, reps: log.reps, isPR: log.is_pr })
      }
      if (log.is_pr) map[s.id].hasPR = true
    }

    const sessions = Object.values(map).sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(),
    )

    const points: ChartPoint[] = []
    for (const s of sessions) {
      if (s.sets.length === 0) continue
      let value: number
      let label: string
      switch (m) {
        case 'weight':
          value = td(Math.max(...s.sets.map(x => x.weight)))
          label = `${value} ${ul}`
          break
        case 'volume':
          value = Math.round(td(s.sets.reduce((sum, x) => sum + x.weight * x.reps, 0)))
          label = `${value.toLocaleString()} ${ul} · vol`
          break
        case 'e1rm': {
          const e = Math.max(...s.sets.map(x => epley(x.weight, x.reps)))
          value = td(Math.round(e * 10) / 10)
          label = `${value} ${ul} e1RM`
          break
        }
        case 'best': {
          const best = s.sets.reduce((b, x) => (x.weight > b.weight ? x : b), s.sets[0])
          value = td(best.weight)
          label = `${td(best.weight)} × ${best.reps}`
          break
        }
      }
      points.push({
        date: s.completedAt,
        displayDate: new Date(s.completedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        value,
        label,
        isPR: s.hasPR,
      })
    }

    const weights = sessions.flatMap(s => s.sets.map(x => x.weight))
    const bestWeight = weights.length > 0 ? td(Math.max(...weights)) : null
    const last = sessions.length > 0 ? sessions[sessions.length - 1] : null
    const lastWeight = last && last.sets.length > 0 ? td(Math.max(...last.sets.map(x => x.weight))) : null
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
          weight: best ? td(best.weight) : null,
          reps: best?.reps ?? null,
          isPR: s.hasPR,
        }
      })

    setChartData(points)
    setStats({ bestWeight, sessionCount: sessions.length, lastWeight, prCount })
    setRecentSessions(recent)
  }

  const selectedExercise = exercises.find(e => e.id === selectedId)
  const dayTypes = [...new Set(exercises.map(e => e.day_type))].sort(
    (a, b) => (DAY_ORDER[a] ?? 9) - (DAY_ORDER[b] ?? 9),
  )
  const exercisesForDay = selectedDay ? exercises.filter(e => e.day_type === selectedDay) : exercises

  if (loadingExercises) {
    return (
      <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", fontSize: '14px' }}>
        Loading...
      </div>
    )
  }

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", paddingBottom: '32px' }}>

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

      {/* Day picker (level 1) */}
      <div style={{ padding: '0 16px 8px', display: 'flex', gap: '6px', overflowX: 'auto' }} className="scrollbar-hide">
        {dayTypes.map(dt => {
          const active = dt === selectedDay
          return (
            <button
              key={dt}
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
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
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
              onClick={() => setSelectedId(ex.id)}
              aria-pressed={active}
              style={{
                height: '34px',
                padding: '0 12px',
                borderRadius: 'var(--radius-pill, 9999px)',
                border: active ? 'none' : '1px solid var(--border)',
                backgroundColor: active ? 'var(--accent)' : 'var(--surface)',
                color: active ? 'var(--bg)' : 'var(--text-secondary)',
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
                role="tab"
                aria-selected={active}
                onClick={() => setMetric(m.id)}
                style={{
                  flex: 1,
                  height: '34px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  backgroundColor: active ? 'var(--accent)' : 'transparent',
                  color: active ? 'var(--bg)' : 'var(--text-secondary)',
                  fontSize: '12px',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'background-color 150ms ease, color 150ms ease',
                }}
              >
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: '6px', padding: '0 16px', marginBottom: '16px' }}>
        {[
          { label: 'BEST', value: stats.bestWeight !== null ? `${stats.bestWeight}` : '—', accent: true },
          { label: 'SESSIONS', value: String(stats.sessionCount), accent: false },
          { label: 'LAST', value: stats.lastWeight !== null ? `${stats.lastWeight}` : '—', accent: false },
          { label: 'PRs', value: String(stats.prCount), accent: false },
        ].map(stat => (
          <div key={stat.label} style={{
            flex: 1,
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '10px 6px',
            textAlign: 'center',
          }}>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '22px',
              color: stat.accent ? 'var(--accent)' : 'var(--text-primary)',
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
        <div style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '16px 8px 8px',
          minHeight: '220px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {loadingChart ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading...</div>
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
                <span style={{ color: 'var(--text-secondary)' }}>{selectedExercise?.name}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--border-strong)', marginTop: '8px' }}>
                Log this exercise to see progress
              </div>
            </div>
          ) : (
            <ProgressChart data={chartData} />
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

          <div style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            overflow: 'hidden',
          }}>
            {recentSessions.map((session, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '11px 16px',
                  backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                  borderBottom: i < recentSessions.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                  {session.date}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {session.isPR && (
                    <span style={{
                      fontSize: '10px',
                      fontFamily: "'Bebas Neue', sans-serif",
                      color: 'var(--accent)',
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
                      ? `${session.weight} × ${session.reps}`
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
