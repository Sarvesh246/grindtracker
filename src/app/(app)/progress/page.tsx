'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Exercise } from '@/lib/types'
import { formatHeaderDate } from '@/lib/utils/formatting'
import ProgressChart from './ProgressChart'

interface ChartPoint {
  date: string
  displayDate: string
  weight: number
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
  isPR: boolean
}

const DAY_ORDER: Record<string, number> = { push: 0, pull: 1, legs: 2 }

export default function ProgressPage() {
  const supabase = createClient()

  const [exercises, setExercises] = useState<Exercise[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function checkScroll() {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }

  function scrollBy(delta: number) {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

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
      }
      setLoadingExercises(false)
    }
    loadExercises()
  }, [])

  useEffect(() => {
    if (!selectedId) return
    loadChartData(selectedId)
  }, [selectedId])

  useEffect(() => {
    // Check if the exercise list overflows after loading
    const el = scrollRef.current
    if (!el) return
    setCanScrollRight(el.scrollWidth > el.clientWidth + 4)
  }, [exercises])

  async function loadChartData(exerciseId: string) {
    setLoadingChart(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoadingChart(false); return }

    const { data: logs } = await supabase
      .from('session_logs')
      .select(`
        weight,
        is_pr,
        sessions!inner(
          id,
          completed_at,
          user_id
        )
      `)
      .eq('exercise_id', exerciseId)
      .eq('sessions.user_id', user.id)
      .not('sessions.completed_at', 'is', null)
      .order('sessions(completed_at)', { ascending: true })

    if (!logs || logs.length === 0) {
      setChartData([])
      setStats({ bestWeight: null, sessionCount: 0, lastWeight: null, prCount: 0 })
      setRecentSessions([])
      setLoadingChart(false)
      return
    }

    const sessionMap: Record<string, {
      completedAt: string
      maxWeight: number | null
      hasPR: boolean
    }> = {}

    for (const log of logs) {
      const sessionsRaw = log.sessions as unknown as { id: string; completed_at: string; user_id: string }[] | { id: string; completed_at: string; user_id: string } | null
      const session = Array.isArray(sessionsRaw) ? sessionsRaw[0] : sessionsRaw
      if (!session) continue
      const sid = session.id
      if (!sessionMap[sid]) {
        sessionMap[sid] = {
          completedAt: session.completed_at,
          maxWeight: null,
          hasPR: false,
        }
      }
      if (log.weight !== null) {
        if (sessionMap[sid].maxWeight === null || log.weight > sessionMap[sid].maxWeight!) {
          sessionMap[sid].maxWeight = log.weight
        }
      }
      if (log.is_pr) sessionMap[sid].hasPR = true
    }

    const sessions = Object.values(sessionMap).sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    )

    const points: ChartPoint[] = sessions
      .filter(s => s.maxWeight !== null)
      .map(s => ({
        date: s.completedAt,
        displayDate: new Date(s.completedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        weight: s.maxWeight!,
        isPR: s.hasPR,
      }))

    const weights = sessions.filter(s => s.maxWeight !== null).map(s => s.maxWeight!)
    const bestWeight = weights.length > 0 ? Math.max(...weights) : null
    const lastWeight = weights.length > 0 ? weights[weights.length - 1] : null
    const prCount = logs.filter(l => l.is_pr).length

    const recent: RecentSession[] = sessions
      .slice(-8)
      .reverse()
      .map(s => ({
        date: new Date(s.completedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        weight: s.maxWeight,
        isPR: s.hasPR,
      }))

    setChartData(points)
    setStats({
      bestWeight,
      sessionCount: sessions.length,
      lastWeight,
      prCount,
    })
    setRecentSessions(recent)
    setLoadingChart(false)
  }

  const selectedExercise = exercises.find(e => e.id === selectedId)

  const grouped: Record<string, Exercise[]> = { push: [], pull: [], legs: [] }
  for (const ex of exercises) {
    grouped[ex.day_type]?.push(ex)
  }

  if (loadingExercises) {
    return (
      <div style={{ padding: '24px 16px', color: '#555555', fontFamily: "'DM Sans', sans-serif", fontSize: '14px' }}>
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
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '32px', color: '#f0f0f0', letterSpacing: '1px',
        }}>
          PROGRESS
        </span>
        <span style={{ fontSize: '13px', color: '#555555' }}>
          {formatHeaderDate()}
        </span>
      </div>

      {/* Exercise selector — horizontal scroll with arrows */}
      <div style={{ position: 'relative', marginBottom: '0' }}>
        {/* Left fade + arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scrollBy(-180)}
            style={{
              position: 'absolute', left: 0, top: 0, bottom: '12px', zIndex: 2,
              width: '40px',
              background: 'linear-gradient(to right, #0f0f0f 60%, transparent)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
              paddingLeft: '4px',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}

        <div
          ref={scrollRef}
          onScroll={checkScroll}
          style={{
            overflowX: 'auto',
            paddingBottom: '12px',
            paddingLeft: '16px',
          }}
          className="scrollbar-hide"
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: 'max-content', paddingRight: '40px' }}>
            {(['push', 'pull', 'legs'] as const).map((dayType) => (
              <div key={dayType} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  fontSize: '11px', color: '#555555',
                  textTransform: 'uppercase', letterSpacing: '1.5px',
                  whiteSpace: 'nowrap', paddingLeft: dayType === 'push' ? '0' : '4px',
                }}>
                  {dayType}
                </span>

                {grouped[dayType].map((ex) => {
                  const active = ex.id === selectedId
                  return (
                    <button
                      key={ex.id}
                      onClick={() => setSelectedId(ex.id)}
                      style={{
                        height: '36px',
                        padding: '0 14px',
                        borderRadius: '9999px',
                        border: active ? 'none' : '1px solid #2e2e2e',
                        backgroundColor: active ? '#c8f135' : '#1a1a1a',
                        color: active ? '#0f0f0f' : '#888888',
                        fontSize: '13px',
                        fontFamily: "'DM Sans', sans-serif",
                        fontWeight: active ? 700 : 400,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'background-color 150ms ease, color 150ms ease',
                      }}
                    >
                      {ex.name}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Right fade + arrow */}
        {canScrollRight && (
          <button
            onClick={() => scrollBy(180)}
            style={{
              position: 'absolute', right: 0, top: 0, bottom: '12px', zIndex: 2,
              width: '40px',
              background: 'linear-gradient(to left, #0f0f0f 60%, transparent)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              paddingRight: '4px',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
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
            backgroundColor: '#1a1a1a',
            border: '1px solid #2e2e2e',
            borderRadius: '10px',
            padding: '10px 6px',
            textAlign: 'center',
          }}>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '22px',
              color: stat.accent ? '#c8f135' : '#f0f0f0',
              lineHeight: 1,
              marginBottom: '3px',
            }}>
              {stat.value}
            </div>
            <div style={{ fontSize: '9px', color: '#555555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ padding: '0 16px', marginBottom: '24px' }}>
        <div style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #2e2e2e',
          borderRadius: '12px',
          padding: '16px 8px 8px',
          minHeight: '220px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {loadingChart ? (
            <div style={{ color: '#555555', fontSize: '14px' }}>Loading...</div>
          ) : chartData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3a3a3a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10"/>
                  <line x1="12" y1="20" x2="12" y2="4"/>
                  <line x1="6" y1="20" x2="6" y2="14"/>
                  <line x1="2" y1="20" x2="22" y2="20"/>
                </svg>
              </div>
              <div style={{ fontSize: '14px', color: '#555555', lineHeight: 1.5 }}>
                No data yet for<br />
                <span style={{ color: '#888888' }}>{selectedExercise?.name}</span>
              </div>
              <div style={{ fontSize: '12px', color: '#3a3a3a', marginTop: '8px' }}>
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
            fontSize: '12px', color: '#555555',
            textTransform: 'uppercase', letterSpacing: '1.5px',
            marginBottom: '10px',
          }}>
            RECENT SESSIONS
          </div>

          <div style={{
            backgroundColor: '#1a1a1a',
            border: '1px solid #2e2e2e',
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
                  borderBottom: i < recentSessions.length - 1 ? '1px solid #2e2e2e' : 'none',
                }}
              >
                <span style={{ fontSize: '14px', color: '#888888' }}>
                  {session.date}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {session.isPR && (
                    <span style={{
                      fontSize: '10px',
                      fontFamily: "'Bebas Neue', sans-serif",
                      color: '#c8f135',
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
                    color: session.weight !== null ? '#f0f0f0' : '#555555',
                  }}>
                    {session.weight !== null ? `${session.weight} lbs` : '—'}
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
