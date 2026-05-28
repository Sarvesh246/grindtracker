'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Exercise } from '@/lib/types'
import { checkAndAwardBadges, ALL_BADGES } from '@/lib/utils/badges'
import CompletionModal from './CompletionModal'

interface SetState {
  weight: string
  reps: string
  checked: boolean
  isPR: boolean
}

type LogMap = Record<string, SetState>

interface PreviousBest {
  [exerciseId: string]: number | null
}

interface CompletionData {
  xpEarned: number
  leveledUp: boolean
  newLevel: number
  prCount: number
  prExercises: { name: string; weight: number }[]
  newBadges: string[]
  duration: number
  setsCompleted: number
}

const DAY_LABEL: Record<string, string> = {
  push: 'PUSH DAY',
  pull: 'PULL DAY',
  legs: 'LEGS DAY',
}

export default function ActiveWorkout({ day }: { day: 'push' | 'pull' | 'legs' }) {
  const router = useRouter()
  const supabase = createClient()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [logs, setLogs] = useState<LogMap>({})
  const [previousBests, setPreviousBests] = useState<PreviousBest>({})
  const [startedAt, setStartedAt] = useState<Date>(new Date())
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [completionData, setCompletionData] = useState<CompletionData | null>(null)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [allExercises, setAllExercises] = useState<Exercise[]>([])
  const [swapTarget, setSwapTarget] = useState<string | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000))
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [startedAt])

  useEffect(() => {
    initSession()
  }, [day])

  async function initSession() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: exs } = await supabase
      .from('exercises')
      .select('*')
      .eq('day_type', day)
      .order('sort_order', { ascending: true })

    if (!exs || exs.length === 0) { setLoading(false); return }
    setExercises(exs)

    const { data: allExsData } = await supabase
      .from('exercises')
      .select('*')
      .order('day_type', { ascending: true })
      .order('sort_order', { ascending: true })
    setAllExercises(allExsData ?? [])

    const bests: PreviousBest = {}
    for (const ex of exs) {
      const { data } = await supabase
        .from('session_logs')
        .select('weight, sessions!inner(user_id, completed_at)')
        .eq('exercise_id', ex.id)
        .eq('sessions.user_id', user.id)
        .not('sessions.completed_at', 'is', null)
        .order('weight', { ascending: false })
        .limit(1)
        .single()
      bests[ex.id] = data?.weight ?? null
    }
    setPreviousBests(bests)

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { data: existing } = await supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('day_type', day)
      .is('completed_at', null)
      .gte('started_at', todayStart.toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    let sid: string
    let sessionStart: Date

    if (existing) {
      sid = existing.id
      sessionStart = new Date(existing.started_at)

      const { data: existingLogs } = await supabase
        .from('session_logs')
        .select('*')
        .eq('session_id', existing.id)

      const restored: LogMap = {}
      for (const ex of exs) {
        for (let s = 1; s <= ex.sets_target; s++) {
          const key = `${ex.id}-${s}`
          restored[key] = {
            weight: bests[ex.id] !== null ? String(bests[ex.id]) : '',
            reps: '',
            checked: false,
            isPR: false,
          }
        }
      }
      for (const log of (existingLogs ?? [])) {
        const key = `${log.exercise_id}-${log.set_number}`
        restored[key] = {
          weight: log.weight !== null ? String(log.weight) : '',
          reps: log.reps !== null ? String(log.reps) : '',
          checked: true,
          isPR: log.is_pr,
        }
      }
      setLogs(restored)
    } else {
      const { data: newSession } = await supabase
        .from('sessions')
        .insert({ user_id: user.id, day_type: day })
        .select()
        .single()

      sid = newSession!.id
      sessionStart = new Date(newSession!.started_at)

      const prefilled: LogMap = {}
      for (const ex of exs) {
        for (let s = 1; s <= ex.sets_target; s++) {
          const key = `${ex.id}-${s}`
          prefilled[key] = {
            weight: bests[ex.id] !== null ? String(bests[ex.id]) : '',
            reps: '',
            checked: false,
            isPR: false,
          }
        }
      }
      setLogs(prefilled)
    }

    setSessionId(sid)
    setStartedAt(sessionStart)
    setElapsed(Math.floor((Date.now() - sessionStart.getTime()) / 1000))
    setLoading(false)
  }

  function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  function totalSets(): number {
    return exercises.reduce((sum, ex) => sum + ex.sets_target, 0)
  }

  function completedSets(): number {
    return Object.values(logs).filter(l => l.checked).length
  }

  function allSetsComplete(): boolean {
    return completedSets() === totalSets() && totalSets() > 0
  }

  function progressPercent(): number {
    if (totalSets() === 0) return 0
    return (completedSets() / totalSets()) * 100
  }

  function updateLog(key: string, field: 'weight' | 'reps', value: string) {
    setLogs(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }))
  }

  async function handleCheck(exerciseId: string, setNumber: number) {
    const key = `${exerciseId}-${setNumber}`
    const logEntry = logs[key]
    if (!logEntry || !sessionId) return

    const weight = logEntry.weight !== '' ? parseFloat(logEntry.weight) : null
    const reps = logEntry.reps !== '' ? parseInt(logEntry.reps) : null

    const prevBest = previousBests[exerciseId]
    const isPR = weight !== null && prevBest !== null && weight > prevBest

    await supabase.from('session_logs').upsert({
      session_id: sessionId,
      exercise_id: exerciseId,
      set_number: setNumber,
      weight,
      reps,
      is_pr: isPR,
    }, { onConflict: 'session_id,exercise_id,set_number' })

    setLogs(prev => ({
      ...prev,
      [key]: { ...prev[key], checked: true, isPR },
    }))

    if (isPR && weight !== null) {
      setPreviousBests(prev => ({ ...prev, [exerciseId]: weight }))
    }
  }

  async function handleSwapExercise(newExercise: Exercise) {
    if (!swapTarget || !sessionId) return
    const oldExercise = exercises.find(e => e.id === swapTarget)

    await supabase
      .from('session_logs')
      .delete()
      .eq('session_id', sessionId)
      .eq('exercise_id', swapTarget)

    let prevBest: number | null = previousBests[newExercise.id] !== undefined
      ? previousBests[newExercise.id]
      : null

    if (previousBests[newExercise.id] === undefined) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from('session_logs')
          .select('weight, sessions!inner(user_id, completed_at)')
          .eq('exercise_id', newExercise.id)
          .eq('sessions.user_id', user.id)
          .not('sessions.completed_at', 'is', null)
          .order('weight', { ascending: false })
          .limit(1)
          .single()
        prevBest = data?.weight ?? null
        setPreviousBests(prev => ({ ...prev, [newExercise.id]: prevBest }))
      }
    }

    setExercises(prev => {
      const idx = prev.findIndex(e => e.id === swapTarget)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = newExercise
      return next
    })

    setLogs(prev => {
      const next = { ...prev }
      if (oldExercise) {
        for (let s = 1; s <= oldExercise.sets_target; s++) {
          delete next[`${swapTarget}-${s}`]
        }
      }
      for (let s = 1; s <= newExercise.sets_target; s++) {
        next[`${newExercise.id}-${s}`] = {
          weight: prevBest !== null ? String(prevBest) : '',
          reps: '',
          checked: false,
          isPR: false,
        }
      }
      return next
    })

    setSwapTarget(null)
  }

  async function handleFinish() {
    if (!sessionId || !allSetsComplete() || finishing) return
    setFinishing(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const prSets = Object.values(logs).filter(l => l.isPR)
    const prCount = prSets.length

    const prExercises: { name: string; weight: number }[] = []
    for (const ex of exercises) {
      for (let s = 1; s <= ex.sets_target; s++) {
        const key = `${ex.id}-${s}`
        const log = logs[key]
        if (log?.isPR && log.weight !== '') {
          if (!prExercises.find(p => p.name === ex.name)) {
            prExercises.push({ name: ex.name, weight: parseFloat(log.weight) })
          }
        }
      }
    }

    let xpEarned = 100 + (prCount * 25)

    const { data: currentStats } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (!currentStats) { setFinishing(false); return }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const lastDate = currentStats.last_workout_date
      ? new Date(currentStats.last_workout_date)
      : null

    let newStreak = 1
    if (lastDate) {
      lastDate.setHours(0, 0, 0, 0)
      const diffDays = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays === 0) {
        newStreak = currentStats.current_streak
      } else if (diffDays <= 2) {
        newStreak = currentStats.current_streak + 1
      } else {
        newStreak = 1
      }
    }

    if (newStreak % 7 === 0) {
      xpEarned += 50
    }

    const newXpTotal = currentStats.xp_total + xpEarned
    const oldLevel = Math.floor(currentStats.xp_total / 500) + 1
    const newLevel = Math.floor(newXpTotal / 500) + 1
    const leveledUp = newLevel > oldLevel

    const newLongest = Math.max(currentStats.longest_streak, newStreak)

    await supabase
      .from('sessions')
      .update({ completed_at: new Date().toISOString(), xp_earned: xpEarned })
      .eq('id', sessionId)

    const updatedStats = {
      xp_total: newXpTotal,
      level: newLevel,
      current_streak: newStreak,
      longest_streak: newLongest,
      last_workout_date: today.toISOString().split('T')[0],
      total_workouts: currentStats.total_workouts + 1,
      updated_at: new Date().toISOString(),
    }
    await supabase
      .from('user_stats')
      .update(updatedStats)
      .eq('user_id', user.id)

    const newBadges = await checkAndAwardBadges(
      supabase,
      user.id,
      { ...currentStats, ...updatedStats },
      prCount,
    )

    setCompletionData({
      xpEarned,
      leveledUp,
      newLevel,
      prCount,
      prExercises,
      newBadges,
      duration: elapsed,
      setsCompleted: completedSets(),
    })
    setFinishing(false)
  }

  if (loading) {
    return (
      <div style={{ padding: '24px 16px', color: '#555555', fontFamily: "'DM Sans', sans-serif", fontSize: '14px' }}>
        Loading workout...
      </div>
    )
  }

  return (
    <>
      {completionData && (
        <CompletionModal
          data={completionData}
          onDone={() => router.push('/home')}
        />
      )}

      {swapTarget && (
        <ExerciseSwapModal
          currentExerciseId={swapTarget}
          allExercises={allExercises}
          currentExercises={exercises}
          onSelect={handleSwapExercise}
          onClose={() => setSwapTarget(null)}
        />
      )}

      {showExitConfirm && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)',
          zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '24px',
        }}>
          <div style={{
            backgroundColor: '#1a1a1a', borderRadius: '12px',
            border: '1px solid #2e2e2e', padding: '24px', width: '100%', maxWidth: '320px',
          }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: '#f0f0f0', marginBottom: '8px' }}>
              END WORKOUT?
            </div>
            <div style={{ fontSize: '14px', color: '#888888', marginBottom: '24px' }}>
              Your progress will be lost.
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowExitConfirm(false)}
                style={{
                  flex: 1, height: '44px', backgroundColor: '#242424',
                  border: '1px solid #2e2e2e', borderRadius: '8px',
                  color: '#f0f0f0', fontFamily: "'DM Sans', sans-serif",
                  fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (sessionId) {
                    await supabase.from('sessions').delete().eq('id', sessionId)
                  }
                  router.push('/log')
                }}
                style={{
                  flex: 1, height: '44px', backgroundColor: 'rgba(239,68,68,0.15)',
                  border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
                  color: '#ef4444', fontFamily: "'DM Sans', sans-serif",
                  fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                End
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ paddingBottom: 'calc(140px + env(safe-area-inset-bottom))', fontFamily: "'DM Sans', sans-serif" }}>

        {/* Header */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          backgroundColor: '#0f0f0f',
          borderBottom: '1px solid #2e2e2e',
          padding: '0 16px',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            height: '56px',
          }}>
            <button
              onClick={() => setShowExitConfirm(true)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px', marginLeft: '-8px', minWidth: '44px', minHeight: '44px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <span style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '22px', color: '#f0f0f0', letterSpacing: '1px',
            }}>
              {DAY_LABEL[day]}
            </span>

            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '14px', color: '#888888', minWidth: '50px', textAlign: 'right',
            }}>
              {formatElapsed(elapsed)}
            </span>
          </div>

          {/* Progress bar */}
          <div style={{ height: '4px', backgroundColor: '#2e2e2e', marginLeft: '-16px', marginRight: '-16px' }}>
            <div style={{
              height: '100%',
              width: `${progressPercent()}%`,
              backgroundColor: '#c8f135',
              transition: 'width 300ms ease',
            }} />
          </div>
        </div>

        {/* Exercise cards */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {exercises.map((ex) => (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              logs={logs}
              previousBest={previousBests[ex.id] ?? null}
              onCheck={handleCheck}
              onUpdate={updateLog}
              onSwap={() => setSwapTarget(ex.id)}
            />
          ))}
        </div>
      </div>

      {/* Finish button */}
      <div style={{
        position: 'fixed',
        bottom: 'calc(64px + env(safe-area-inset-bottom))',
        left: 0,
        right: 0,
        padding: '12px 16px',
        backgroundColor: '#0f0f0f',
        borderTop: '1px solid #2e2e2e',
        zIndex: 50,
      }}>
        <button
          onClick={handleFinish}
          disabled={!allSetsComplete() || finishing}
          style={{
            width: '100%', height: '56px',
            backgroundColor: allSetsComplete() ? '#c8f135' : '#2e2e2e',
            color: allSetsComplete() ? '#0f0f0f' : '#555555',
            border: 'none', borderRadius: '12px',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '22px', letterSpacing: '1px',
            cursor: allSetsComplete() ? 'pointer' : 'default',
            transition: 'background-color 150ms ease, color 150ms ease',
          }}
        >
          {finishing ? 'SAVING...' : 'FINISH WORKOUT'}
        </button>
        <div style={{ textAlign: 'center', marginTop: '6px', fontSize: '12px', color: '#555555' }}>
          {completedSets()} / {totalSets()} sets complete
        </div>
      </div>
    </>
  )
}

// ─── Exercise Card ─────────────────────────────────────────────────────────────

interface ExerciseCardProps {
  exercise: Exercise
  logs: LogMap
  previousBest: number | null
  onCheck: (exerciseId: string, setNumber: number) => void
  onUpdate: (key: string, field: 'weight' | 'reps', value: string) => void
  onSwap: () => void
}

function ExerciseCard({ exercise, logs, previousBest, onCheck, onUpdate, onSwap }: ExerciseCardProps) {
  return (
    <div style={{
      backgroundColor: '#1a1a1a',
      border: '1px solid #2e2e2e',
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 16px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f0f0f0', flex: 1 }}>
            {exercise.name}
          </div>
          <button
            onClick={onSwap}
            title="Swap exercise"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '2px', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: 0.5,
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#555555' }}>
            {exercise.sets_target} sets × {exercise.reps_target} reps
          </span>
          <span style={{ fontSize: '12px', color: '#555555', fontFamily: "'JetBrains Mono', monospace" }}>
            {previousBest !== null ? `prev: ${previousBest} lbs` : 'no previous data'}
          </span>
        </div>
      </div>

      <div style={{ height: '1px', backgroundColor: '#2e2e2e' }} />

      <div style={{ padding: '8px 0' }}>
        {Array.from({ length: exercise.sets_target }, (_, i) => i + 1).map((setNum) => {
          const key = `${exercise.id}-${setNum}`
          const logEntry = logs[key] ?? { weight: '', reps: '', checked: false, isPR: false }
          return (
            <SetRow
              key={key}
              setNumber={setNum}
              logEntry={logEntry}
              onCheck={() => onCheck(exercise.id, setNum)}
              onWeightChange={(v) => onUpdate(key, 'weight', v)}
              onRepsChange={(v) => onUpdate(key, 'reps', v)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ─── Exercise Swap Modal ───────────────────────────────────────────────────────

interface ExerciseSwapModalProps {
  currentExerciseId: string
  allExercises: Exercise[]
  currentExercises: Exercise[]
  onSelect: (exercise: Exercise) => void
  onClose: () => void
}

const DAY_SECTION_LABEL: Record<string, string> = {
  push: 'PUSH — Chest · Shoulders · Triceps',
  pull: 'PULL — Back · Biceps · Rear Delts',
  legs: 'LEGS — Quads · Hamstrings · Glutes',
}

function ExerciseSwapModal({ currentExerciseId, allExercises, currentExercises, onSelect, onClose }: ExerciseSwapModalProps) {
  const available = allExercises.filter(
    ex => ex.id === currentExerciseId || !currentExercises.find(ce => ce.id === ex.id)
  )

  const grouped: Record<string, Exercise[]> = {
    push: available.filter(e => e.day_type === 'push'),
    pull: available.filter(e => e.day_type === 'pull'),
    legs: available.filter(e => e.day_type === 'legs'),
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)',
        zIndex: 300, display: 'flex', alignItems: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', backgroundColor: '#1a1a1a',
          borderRadius: '16px 16px 0 0',
          maxHeight: '72vh', display: 'flex', flexDirection: 'column',
          border: '1px solid #2e2e2e', borderBottom: 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 16px 14px',
          borderBottom: '1px solid #2e2e2e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: '#f0f0f0', letterSpacing: '1px' }}>
            SWAP EXERCISE
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              width: '32px', height: '32px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {(['push', 'pull', 'legs'] as const).map(dayType => {
            const exs = grouped[dayType]
            if (exs.length === 0) return null
            return (
              <div key={dayType}>
                <div style={{
                  padding: '12px 16px 6px',
                  fontSize: '10px', color: '#555555',
                  textTransform: 'uppercase', letterSpacing: '1.5px',
                }}>
                  {DAY_SECTION_LABEL[dayType]}
                </div>
                {exs.map(ex => {
                  const isCurrent = ex.id === currentExerciseId
                  return (
                    <button
                      key={ex.id}
                      onClick={() => !isCurrent && onSelect(ex)}
                      style={{
                        width: '100%', textAlign: 'left',
                        background: isCurrent ? 'rgba(200, 241, 53, 0.05)' : 'none',
                        border: 'none',
                        borderBottom: '1px solid #2e2e2e',
                        padding: '14px 16px',
                        cursor: isCurrent ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: '12px',
                      }}
                    >
                      <div>
                        <div style={{
                          fontSize: '15px', fontWeight: 600,
                          color: isCurrent ? '#c8f135' : '#f0f0f0',
                          fontFamily: "'DM Sans', sans-serif",
                          marginBottom: '2px',
                        }}>
                          {ex.name}
                        </div>
                        <div style={{ fontSize: '12px', color: '#555555', fontFamily: "'DM Sans', sans-serif" }}>
                          {ex.sets_target} sets × {ex.reps_target} reps
                        </div>
                      </div>
                      {isCurrent && (
                        <span style={{
                          fontSize: '10px', color: '#c8f135',
                          backgroundColor: 'rgba(200, 241, 53, 0.1)',
                          border: '1px solid rgba(200, 241, 53, 0.25)',
                          borderRadius: '9999px', padding: '2px 8px',
                          fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                          flexShrink: 0,
                        }}>
                          CURRENT
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Set Row ───────────────────────────────────────────────────────────────────

interface SetRowProps {
  setNumber: number
  logEntry: SetState
  onCheck: () => void
  onWeightChange: (v: string) => void
  onRepsChange: (v: string) => void
}

function SetRow({ setNumber, logEntry, onCheck, onWeightChange, onRepsChange }: SetRowProps) {
  const [justChecked, setJustChecked] = useState(false)

  function handleCheck() {
    if (logEntry.checked) return
    setJustChecked(true)
    setTimeout(() => setJustChecked(false), 300)
    onCheck()
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '8px 16px',
      opacity: logEntry.checked ? 0.6 : 1,
      transition: 'opacity 150ms ease',
    }}>
      <span style={{
        fontSize: '12px', color: '#555555', fontFamily: "'DM Sans', sans-serif",
        minWidth: '40px', fontWeight: 500,
      }}>
        SET {setNumber}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
        <input
          type="number"
          inputMode="decimal"
          value={logEntry.weight}
          onChange={e => onWeightChange(e.target.value)}
          onFocus={e => e.target.select()}
          disabled={logEntry.checked}
          placeholder="0"
          style={{
            width: '72px', height: '40px',
            backgroundColor: '#242424',
            border: `1px solid ${logEntry.checked ? '#2e2e2e' : '#3a3a3a'}`,
            borderRadius: '8px',
            color: '#f0f0f0',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            textAlign: 'center',
            outline: 'none',
          }}
        />
        <span style={{ fontSize: '12px', color: '#555555' }}>lbs</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <input
          type="number"
          inputMode="numeric"
          value={logEntry.reps}
          onChange={e => onRepsChange(e.target.value)}
          onFocus={e => e.target.select()}
          disabled={logEntry.checked}
          placeholder="0"
          style={{
            width: '56px', height: '40px',
            backgroundColor: '#242424',
            border: `1px solid ${logEntry.checked ? '#2e2e2e' : '#3a3a3a'}`,
            borderRadius: '8px',
            color: '#f0f0f0',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '16px',
            textAlign: 'center',
            outline: 'none',
          }}
        />
        <span style={{ fontSize: '12px', color: '#555555' }}>reps</span>
      </div>

      {logEntry.isPR && (
        <span style={{
          fontSize: '10px', fontFamily: "'Bebas Neue', sans-serif",
          color: '#c8f135',
          backgroundColor: 'rgba(200, 241, 53, 0.1)',
          border: '1px solid rgba(200, 241, 53, 0.3)',
          borderRadius: '9999px', padding: '2px 7px',
          letterSpacing: '0.5px',
        }}>
          PR
        </span>
      )}

      <button
        onClick={handleCheck}
        disabled={logEntry.checked}
        style={{
          width: '40px', height: '40px', minWidth: '40px',
          borderRadius: '9999px',
          border: `2px solid ${logEntry.checked ? '#c8f135' : '#3a3a3a'}`,
          backgroundColor: logEntry.checked ? 'rgba(200, 241, 53, 0.12)' : 'transparent',
          cursor: logEntry.checked ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: justChecked ? 'scale(1.2)' : 'scale(1)',
          transition: 'transform 200ms ease, border-color 150ms ease, background-color 150ms ease',
          flexShrink: 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke={logEntry.checked ? '#c8f135' : '#555555'}
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>
    </div>
  )
}
