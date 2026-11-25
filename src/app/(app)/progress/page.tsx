'use client'
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient, getClientUser } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { Exercise } from '@/lib/types'
import { formatShortDate } from '@/lib/utils/formatting'
import { enabledDayKeys, logDayHref } from '@/lib/utils/dayKeys'
import { useUnit } from '@/lib/contexts/UnitContext'
import { useTour, type TourStep } from '@/components/onboarding/Tour'
import TodayLabel from '@/components/TodayLabel'
import ProgressLoading from './loading'
import FitterLine from '@/components/body/FitterLine'
import LoadGauge from '@/components/body/LoadGauge'
import { useBodySummary } from '@/components/body/useBodySummary'
import { HealthEntry } from '@/components/health/HealthEntry'
import { CACHE_KEYS, getUiState, setUiState } from '@/lib/cache/appDataCache'
import { useCachedQuery } from '@/lib/cache/useCachedQuery'
import { ChevronRight } from '@/components/ui/Icons'

type ProgressTab = 'lifts' | 'recovery' | 'body'
const PROGRESS_TABS: { id: ProgressTab; label: string }[] = [
  { id: 'lifts', label: 'Lifts' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'body', label: 'Body' },
]
const ProgressChart = dynamic(() => import('./ProgressChart'), {
  ssr: false,
  loading: () => (
    <div className="progress-chart-plot shimmer" aria-hidden="true" />
  ),
})

export type Metric = 'weight' | 'volume' | 'e1rm' | 'best'

interface ChartPoint {
  date: string
  displayDate: string
  fullDate: string
  value: number
  label: string
  isPR: boolean
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
const NO_LOGS: RawLog[] = []

const METRIC_IDS: { id: Metric; label: string }[] = [
  { id: 'weight', label: 'Weight' },
  { id: 'volume', label: 'Volume' },
  { id: 'e1rm', label: 'e1RM' },
  { id: 'best', label: 'Best set' },
]

function epley(weight: number, reps: number): number {
  // Epley 1RM estimate. reps==1 returns weight exactly.
  return weight * (1 + reps / 30)
}

type ProgressSelection = {
  selectedId: string | null
  selectedDay: string | null
  metric: Metric
}

type PhotoSummary = {
  count: number
  latestDate: string | null
  thumb: string | null
}

function dayRank(dayType: string): number {
  return DAY_ORDER[dayType] ?? 9
}

function orderedDayTypes(exercises: Exercise[]): string[] {
  return [...new Set(exercises.map(e => e.day_type))].sort((a, b) => dayRank(a) - dayRank(b))
}

function sortExercises(data: Exercise[]): Exercise[] {
  return [...data].sort((a, b) => {
    const dayDiff = dayRank(a.day_type) - dayRank(b.day_type)
    if (dayDiff !== 0) return dayDiff
    return a.sort_order - b.sort_order
  })
}

export default function ProgressPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { demoMode } = useDemoMode()
  const { unitLabel, toDisplay } = useUnit()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [metric, setMetric] = useState<Metric>('weight')
  // GRIND Body: null unless this user has watch data (and migration 59 is in).
  const body = useBodySummary()
  // Phone layout: Lifts, Recovery and Body each get the whole screen. Desktop
  // shows all three side by side and hides the tabs.
  const [tab, setTab] = useState<ProgressTab>(() =>
    typeof window === 'undefined' ? 'lifts' : (getUiState<ProgressTab>('progress:tab') ?? 'lifts')
  )
  const pickTab = (next: ProgressTab) => {
    setTab(next)
    setUiState('progress:tab', next)
  }

  const { data: allExercises = [], loading: loadingExercises } = useCachedQuery<Exercise[]>(
    CACHE_KEYS.exercises,
    async () => {
      const { data } = await supabase
        .from('exercises')
        .select('*')
        .order('day_type', { ascending: true })
        .order('sort_order', { ascending: true })
      return sortExercises((data ?? []) as Exercise[])
    },
  )

  // Disabled days (every exercise inactive) stay out of the progress pickers.
  const exercises = useMemo(() => {
    const enabled = new Set(enabledDayKeys(allExercises))
    return allExercises.filter(e => enabled.has(e.day_type))
  }, [allExercises])

  const { data: photoSummary } = useCachedQuery<PhotoSummary>(
    demoMode ? 'progress:photos:demo' : CACHE_KEYS.progressPhotos,
    async () => {
      // Demo Mode shows nothing here at all — real progress photos never
      // touch the screen, and there's no plausible fake photo to show instead.
      if (demoMode) return { count: 0, latestDate: null, thumb: null }
      const user = await getClientUser(supabase)
      if (!user) return { count: 0, latestDate: null, thumb: null }
      const { count } = await supabase
        .from('progress_photo_groups')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
      if (!count) return { count: 0, latestDate: null, thumb: null }

      const { data: latest } = await supabase
        .from('progress_photo_groups')
        .select('id, taken_date')
        .eq('user_id', user.id)
        .order('taken_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!latest) return { count, latestDate: null, thumb: null }

      const { data: photo } = await supabase
        .from('progress_photos')
        .select('storage_path')
        .eq('group_id', latest.id)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (!photo) return { count, latestDate: latest.taken_date, thumb: null }

      const { data: signed } = await supabase.storage
        .from('progress-photos')
        .createSignedUrl(photo.storage_path, 3600)
      return {
        count,
        latestDate: latest.taken_date,
        thumb: signed?.signedUrl ?? null,
      }
    },
  )
  const photoCount = photoSummary?.count ?? null
  const latestPhotoDate = photoSummary?.latestDate ?? null
  const latestPhotoThumb = photoSummary?.thumb ?? null

  const { data: rawLogs, loading: loadingChart } = useCachedQuery<RawLog[]>(
    selectedId ? CACHE_KEYS.progressLogs(selectedId) : null,
    async () => {
      const user = await getClientUser(supabase)
      if (!user) return []
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
        .eq('exercise_id', selectedId!)
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
      return ((logs ?? []) as RawLog[]).slice().reverse()
    },
  )

  useEffect(() => {
    if (exercises.length === 0) return
    if (selectedId && exercises.some(e => e.id === selectedId)) {
      if (!selectedDay) {
        // Keep the day pill in sync if an exercise is already chosen.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedDay(exercises.find(e => e.id === selectedId)?.day_type ?? null)
      }
      return
    }
    // Always land on the first day pill (Push, then Pull, Legs, then custom).
    // Metric is the only selection restored across visits — picking another
    // day is what the top row is for.
    const saved = getUiState<ProgressSelection>(CACHE_KEYS.progressSelection)
    if (saved?.metric) setMetric(saved.metric)
    if (getUiState<{ ready: boolean }>('progress:health-return')?.ready && saved?.selectedId && exercises.some(e => e.id === saved.selectedId)) {
      setSelectedId(saved.selectedId)
      setSelectedDay(exercises.find(e => e.id === saved.selectedId)?.day_type ?? null)
      return
    }
    const firstDay = orderedDayTypes(exercises)[0] ?? exercises[0].day_type
    const firstEx = exercises.find(e => e.day_type === firstDay) ?? exercises[0]
    setSelectedId(firstEx.id)
    setSelectedDay(firstDay)
  }, [exercises, selectedId, selectedDay])

  useEffect(() => {
    if (!selectedId) return
    setUiState<ProgressSelection>(CACHE_KEYS.progressSelection, {
      selectedId,
      selectedDay,
      metric,
    })
  }, [selectedId, selectedDay, metric])

  useEffect(() => {
    const restore = getUiState<{ scroll: number; ready: boolean }>('progress:health-return')
    if (!restore?.ready || loadingExercises || loadingChart || (exercises.length > 0 && !selectedId)) return
    const frame = requestAnimationFrame(() => {
      const main = document.querySelector('.app-main')
      if (main) main.scrollTop = restore.scroll
      setUiState('progress:health-return', null)
    })
    return () => cancelAnimationFrame(frame)
  }, [loadingExercises, loadingChart, selectedId, exercises.length])

  const { chartData, stats, recentSessions } = useMemo(() => {
    const logs = rawLogs ?? NO_LOGS
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
      switch (metric) {
        case 'weight':
          value = Math.round(Math.max(...s.sets.map(x => x.weight)) * 10) / 10
          label = value === 0 ? 'BW' : `${value} ${unitLabel}`
          break
        case 'volume':
          value = Math.round(s.sets.reduce((sum, x) => sum + x.weight * x.reps, 0))
          label = `${value.toLocaleString()} ${unitLabel} · vol`
          break
        case 'e1rm': {
          const e = Math.max(...s.sets.map(x => epley(x.weight, x.reps)))
          value = Math.round(e * 10) / 10
          label = `${value} ${unitLabel} e1RM`
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
        fullDate: display.toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
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
        // Same date-only guard as the chart points above: `completedAt` is
        // usually a bare YYYY-MM-DD `local_date`, which `new Date()` parses as
        // UTC midnight — rendering it back in the viewer's local timezone then
        // shows the previous calendar day for anyone west of UTC. Parsing at
        // local noon keeps it on the intended day regardless of timezone.
        const recentDate = /^\d{4}-\d{2}-\d{2}$/.test(s.completedAt)
          ? new Date(s.completedAt + 'T12:00:00')
          : new Date(s.completedAt)
        return {
          date: recentDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          weight: best ? Math.round(best.weight * 10) / 10 : null,
          reps: best?.reps ?? null,
          isPR: s.hasPR,
        }
      })

    return {
      chartData: points,
      stats: { bestWeight, sessionCount: sessions.length, lastWeight, prCount },
      recentSessions: recent,
    }
  }, [rawLogs, metric, unitLabel, toDisplay])

  const selectedExercise = exercises.find(e => e.id === selectedId)
  const dayTypes = orderedDayTypes(exercises)
  const exercisesForDay = selectedDay ? exercises.filter(e => e.day_type === selectedDay) : exercises

  // Walkthrough (hook must run before the early returns below). Only
  // active once exercises exist — the blank-slate hero has nothing to point at.
  const progressSteps: TourStep[] = [
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
      ? { target: 'progress-tabs', title: 'Lifts, recovery and body', body: 'Switch between your lift charts, today’s recovery and progress photos.' }
      : { target: 'progress-photos', title: 'Progress photos', body: 'Log physique photos here and compare them over time.' },
    { target: 'progress-selector', title: 'Pick what to chart', body: 'Choose a workout day and exercise.' },
    { target: 'progress-chart', title: 'Read your chart', body: 'Switch metrics above the plot. Each point is a workout session, and highlighted points mark PRs.' },
  ]
  const progressTour = useTour('progress', progressSteps, {
    active: !loadingExercises && exercises.length > 0,
  })

  if (loadingExercises) {
    return <ProgressLoading />
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
          <TodayLabel style={{ fontSize: '13px', color: 'var(--text-muted)' }} />
        </div>

        <div style={{ padding: '0 16px 8px' }}>
          <PhotoEntryCard
            count={photoCount}
            latestDate={latestPhotoDate}
            thumb={latestPhotoThumb}
          />
        </div>

        <div style={{ padding: '8px 16px' }}><HealthEntry body={body} />
          {body?.hasGarminActivities && <Link href="/progress/garmin" className="progress-garmin-entry press-card">Garmin activities<ChevronRight size={16} /></Link>}
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

  function selectDay(day: string) {
    if (day === selectedDay) return
    setSelectedDay(day)
    setSelectedId(exercises.find(exercise => exercise.day_type === day)?.id ?? null)
  }

  function handleMetricKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = METRIC_IDS.length - 1
    let next: number
    switch (event.key) {
      case 'ArrowRight': next = index === last ? 0 : index + 1; break
      case 'ArrowLeft': next = index === 0 ? last : index - 1; break
      case 'Home': next = 0; break
      case 'End': next = last; break
      default: return
    }
    event.preventDefault()
    const nextMetric = METRIC_IDS[next].id
    setMetric(nextMetric)
    document.getElementById(`progress-metric-${nextMetric}`)?.focus()
  }

  const formatWeight = (weight: number | null) =>
    weight === null ? '—' : weight === 0 ? 'BW' : `${weight} ${unitLabel}`
  const summary = [
    { label: 'Best weight', value: formatWeight(stats.bestWeight) },
    { label: 'Last weight', value: formatWeight(stats.lastWeight) },
    { label: 'Sessions', value: stats.sessionCount },
    { label: 'PR sets', value: stats.prCount },
  ]

  return (
    <div className="page page--progress progress-workspace">
      {progressTour}
      <header className="progress-heading">
        <h1>Progress</h1>
        <TodayLabel />
      </header>

      <nav className="progress-tabs" role="tablist" aria-label="Progress sections" data-onboard="progress-tabs">
        <span className="progress-tabs-thumb" aria-hidden="true" style={{ '--tab': PROGRESS_TABS.findIndex(t => t.id === tab) } as CSSProperties} />
        {PROGRESS_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`progress-tab-${t.id}`}
            aria-selected={tab === t.id}
            className="press"
            data-haptic="light"
            onClick={() => pickTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="progress-layout" data-tab={tab}>
        <section className="progress-filters" data-onboard="progress-selector" aria-label="Chart filters">
          <div className="progress-selectors">
            <label>
              Workout day
              <select value={selectedDay ?? ''} onChange={event => selectDay(event.target.value)}>
                {dayTypes.map(day => (
                  <option key={day} value={day}>{day.replace(/-/g, ' ')}</option>
                ))}
              </select>
            </label>
            <label>
              Exercise
              <select value={selectedId ?? ''} onChange={event => setSelectedId(event.target.value)}>
                {exercisesForDay.map(exercise => (
                  <option key={exercise.id} value={exercise.id}>{exercise.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="progress-chips">
            <div role="group" aria-label="Workout day" className="scrollbar-hide chip-row progress-day-chips">
              {dayTypes.map(day => (
                <button
                  key={day}
                  type="button"
                  className="press"
                  data-haptic="light"
                  aria-pressed={day === selectedDay}
                  onClick={() => selectDay(day)}
                >
                  {day.replace(/-/g, ' ')}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Exercise" className="progress-exercise-chips">
              {exercisesForDay.map(exercise => (
                <button
                  key={exercise.id}
                  type="button"
                  className="press"
                  data-haptic="light"
                  aria-pressed={exercise.id === selectedId}
                  onClick={() => setSelectedId(exercise.id)}
                >
                  {exercise.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="progress-main">
          <section data-onboard="progress-chart" className={`progress-chart-card${!loadingChart && !chartData.length ? ' progress-chart-card--empty' : ''}`} aria-labelledby="progress-exercise-title">
            <div className="progress-chart-header">
              <h2 id="progress-exercise-title" title={selectedExercise?.name}>{selectedExercise?.name ?? 'Exercise progress'}</h2>
              {(loadingChart || chartData.length > 0) && <div className="progress-metrics" role="tablist" aria-label="Chart metric">
                {METRIC_IDS.map(({ id, label }, index) => (
                  <button
                    key={id}
                    type="button"
                    id={`progress-metric-${id}`}
                    className="press"
                    data-haptic="light"
                    role="tab"
                    aria-selected={metric === id}
                    aria-controls="progress-metric-panel"
                    tabIndex={metric === id ? 0 : -1}
                    onClick={() => setMetric(id)}
                    onKeyDown={event => handleMetricKeyDown(event, index)}
                  >
                    {label}
                  </button>
                ))}
              </div>}
            </div>
            <div
              role={chartData.length ? 'tabpanel' : undefined}
              id="progress-metric-panel"
              aria-labelledby={chartData.length ? `progress-metric-${metric}` : undefined}
              aria-busy={loadingChart || undefined}
              tabIndex={0}
            >
              {loadingChart || !selectedId ? (
                <div className="progress-chart-plot shimmer" aria-hidden="true" />
              ) : chartData.length === 0 ? (
                <div className="progress-chart-plot progress-chart-empty">
                  <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 20h18M6 16v-4m6 4V8m6 8V4" />
                  </svg>
                  <p>No sessions logged for this exercise.</p>
                  {selectedExercise && <Link className="progress-start-link" href={logDayHref(selectedExercise.day_type)}>
                    Open {selectedExercise.day_type.replace(/-/g, ' ')} workout
                  </Link>}
                </div>
              ) : (
                <ProgressChart key={selectedId} data={chartData} metric={metric} />
              )}
            </div>
            {chartData.length > 0 && <dl className="progress-stats">
              {summary.map(({ label, value }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{loadingChart ? '—' : value}</dd>
                </div>
              ))}
            </dl>}
          </section>

          <div className="progress-details">
            {selectedId && body?.hasWatch && <FitterLine key={selectedId} exerciseId={selectedId} />}

            {recentSessions.length > 0 && (
              <section className="progress-history" aria-labelledby="progress-history-title">
                <header><h2 id="progress-history-title">Recent sessions</h2></header>
                <table className="progress-recent-table" aria-labelledby="progress-history-title" tabIndex={0}>
                  <thead><tr><th scope="col">Date</th><th scope="col">Best set</th><th scope="col">Record</th></tr></thead>
                  <tbody>
                    {recentSessions.map((session, index) => (
                      <tr key={index}>
                        <th scope="row">{session.date}</th>
                        <td className="progress-history-set">
                          {session.weight !== null && session.reps !== null
                            ? `${formatWeight(session.weight)} × ${session.reps}` : '—'}
                        </td>
                        <td>{session.isPR ? <span className="progress-history-pr">PR</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        </div>

        <aside className="progress-related" aria-label="Photos and recovery">
          <div className="progress-pane" data-pane="recovery">
            <HealthEntry body={body} />
            {body?.hasGarminActivities && <Link href="/progress/garmin" className="progress-garmin-entry press-card">Garmin activities<ChevronRight size={16} /></Link>}
            {body?.strength ? <LoadGauge load={body.strength} /> : body?.hasWatch && body.load && <LoadGauge load={body.load} />}
          </div>
          <div className="progress-pane" data-pane="body">
            <PhotoEntryCard count={photoCount} latestDate={latestPhotoDate} thumb={latestPhotoThumb} />
          </div>
        </aside>
      </div>
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
}: {
  count: number | null
  latestDate: string | null
  thumb: string | null
}) {
  const subtitle = count === null
    ? ''
    : count === 0
      ? 'Add your first photo'
      : `Last logged ${latestDate ? formatShortDate(latestDate) : ''} · ${count} ${count === 1 ? 'entry' : 'entries'}`

  return (
    <div data-onboard="progress-photos">
      <Link
        href="/progress/photos" className="press-card" aria-label="Progress photos" data-haptic="light"
        style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', textDecoration: 'none', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-sm)' }}
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
          alt="" loading="lazy" decoding="async"
          style={{ width: '38px', height: '38px', borderRadius: 'var(--radius-sm)', objectFit: 'cover', flexShrink: 0 }}
        />
      )}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
      </Link>
    </div>
  )
}
