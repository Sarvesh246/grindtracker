'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Exercise } from '@/lib/types'
import { getLevel } from '@/lib/utils/gamification'
import { checkAndAwardBadges } from '@/lib/utils/badges'

function parseDefaultReps(repsTarget: string): string {
  return repsTarget.split('-')[0].trim()
}

function getYesterdayString(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DAY_TYPES = ['push', 'pull', 'legs'] as const

type SetInput = { weight: string; reps: string }

function LogPastContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const yesterday = getYesterdayString()
  const paramDate = searchParams.get('date')
  const initialDate = paramDate && paramDate <= yesterday ? paramDate : yesterday

  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [selectedDayType, setSelectedDayType] = useState<string | null>(null)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [setInputs, setSetInputs] = useState<Record<string, SetInput[]>>({})
  const [skippedExercises, setSkippedExercises] = useState<Set<string>>(new Set())
  const [loadingExercises, setLoadingExercises] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState(false)
  const [done, setDone] = useState<{ xpEarned: number; prCount: number } | null>(null)

  useEffect(() => {
    if (!selectedDayType) return
    loadExercises(selectedDayType)
    setDuplicateWarning(false)
    setSkippedExercises(new Set())
  }, [selectedDayType])

  async function loadExercises(dayType: string) {
    setLoadingExercises(true)
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .eq('day_type', dayType)
      .order('sort_order', { ascending: true })

    const exs = data ?? []
    setExercises(exs)

    const inputs: Record<string, SetInput[]> = {}
    for (const ex of exs) {
      inputs[ex.id] = Array.from({ length: ex.sets_target }, () => ({
        weight: '',
        reps: parseDefaultReps(ex.reps_target),
      }))
    }
    setSetInputs(inputs)
    setLoadingExercises(false)
  }

  function updateSet(exerciseId: string, setIdx: number, field: 'weight' | 'reps', value: string) {
    setSetInputs(prev => {
      const updated = prev[exerciseId].map((s, i) => i === setIdx ? { ...s, [field]: value } : s)
      return { ...prev, [exerciseId]: updated }
    })
  }

  async function handleSubmit(force = false) {
    if (!selectedDayType) return
    setError(null)
    setSubmitting(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not logged in.'); setSubmitting(false); return }

    const dayStart = new Date(selectedDate + 'T00:00:00').toISOString()
    const dayEnd = new Date(selectedDate + 'T23:59:59').toISOString()

    if (!force) {
      const { data: existing } = await supabase
        .from('sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('day_type', selectedDayType)
        .not('completed_at', 'is', null)
        .gte('completed_at', dayStart)
        .lte('completed_at', dayEnd)
        .limit(1)

      if (existing && existing.length > 0) {
        setDuplicateWarning(true)
        setSubmitting(false)
        return
      }
    }

    const { data: statsData } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (!statsData) { setError('Could not load stats.'); setSubmitting(false); return }

    // Get prior sessions for PR detection
    const { data: priorSessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .lt('completed_at', dayStart)

    const priorIds = (priorSessions ?? []).map(s => s.id)

    const prevBests: Record<string, number | null> = {}
    if (priorIds.length > 0) {
      const { data: priorLogs } = await supabase
        .from('session_logs')
        .select('exercise_id, weight')
        .in('session_id', priorIds)
        .not('weight', 'is', null)

      for (const log of priorLogs ?? []) {
        const prev = prevBests[log.exercise_id] ?? null
        if (log.weight !== null && (prev === null || log.weight > prev)) {
          prevBests[log.exercise_id] = log.weight
        }
      }
    }

    // Insert session
    const started = new Date(selectedDate + 'T12:00:00').toISOString()
    const completed = new Date(selectedDate + 'T13:00:00').toISOString()

    const { data: newSession, error: sessionErr } = await supabase
      .from('sessions')
      .insert({ user_id: user.id, day_type: selectedDayType, started_at: started, completed_at: completed, xp_earned: 0 })
      .select()
      .single()

    if (sessionErr || !newSession) {
      setError('Failed to create session.')
      setSubmitting(false)
      return
    }

    // Build and upsert session logs
    const logsToInsert: {
      session_id: string
      exercise_id: string
      set_number: number
      weight: number | null
      reps: number | null
      is_pr: boolean
    }[] = []

    let prCount = 0

    for (const ex of exercises) {
      if (skippedExercises.has(ex.id)) continue
      const sets = setInputs[ex.id] ?? []
      for (let i = 0; i < sets.length; i++) {
        const s = sets[i]
        const weight = s.weight !== '' ? parseFloat(s.weight) : null
        const reps = s.reps !== '' ? parseInt(s.reps) : null
        const prevBest = prevBests[ex.id] ?? null
        const isPR = weight !== null && prevBest !== null && weight > prevBest
        if (isPR) prCount++

        logsToInsert.push({
          session_id: newSession.id,
          exercise_id: ex.id,
          set_number: i + 1,
          weight,
          reps,
          is_pr: isPR,
        })
      }
    }

    await supabase
      .from('session_logs')
      .upsert(logsToInsert, { onConflict: 'session_id,exercise_id,set_number' })

    const xpEarned = 100 + prCount * 25

    await supabase
      .from('sessions')
      .update({ xp_earned: xpEarned })
      .eq('id', newSession.id)

    const newXpTotal = statsData.xp_total + xpEarned
    const newLevel = getLevel(newXpTotal)

    const updatedStats = {
      ...statsData,
      xp_total: newXpTotal,
      level: newLevel,
      total_workouts: statsData.total_workouts + 1,
      updated_at: new Date().toISOString(),
    }

    await supabase
      .from('user_stats')
      .update({
        xp_total: newXpTotal,
        level: newLevel,
        total_workouts: statsData.total_workouts + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    await checkAndAwardBadges(supabase, user.id, updatedStats, prCount)

    setDone({ xpEarned, prCount })
    setSubmitting(false)
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div style={{ padding: '24px 16px', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '64px', gap: '16px' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '28px', color: '#f0f0f0', letterSpacing: '1px', textAlign: 'center' }}>
          WORKOUT LOGGED
        </div>
        <div style={{ backgroundColor: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '12px', padding: '20px 24px', textAlign: 'center', width: '100%', maxWidth: '320px' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '40px', color: '#c8f135', lineHeight: 1 }}>
            +{done.xpEarned} XP
          </div>
          {done.prCount > 0 && (
            <div style={{ fontSize: '14px', color: '#888888', marginTop: '6px' }}>
              {done.prCount} PR{done.prCount !== 1 ? 's' : ''} detected
            </div>
          )}
          <div style={{ fontSize: '13px', color: '#555555', marginTop: '4px' }}>
            {selectedDate} · {selectedDayType?.toUpperCase()}
          </div>
        </div>
        <button
          onClick={() => router.push('/log')}
          style={{
            marginTop: '8px',
            backgroundColor: '#c8f135',
            color: '#0f0f0f',
            border: 'none',
            borderRadius: '12px',
            padding: '14px 32px',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '18px',
            letterSpacing: '1px',
            cursor: 'pointer',
          }}
        >
          BACK TO LOG
        </button>
      </div>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", paddingBottom: '40px' }}>

      {/* Header */}
      <div style={{ padding: '24px 16px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={() => router.push('/log')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#888888', flexShrink: 0, lineHeight: 1 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '28px',
          color: '#f0f0f0',
          letterSpacing: '1px',
          margin: 0,
        }}>
          LOG PAST WORKOUT
        </h1>
      </div>

      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Date + Day Type */}
        <div style={{ backgroundColor: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Date picker */}
          <div>
            <div style={{ fontSize: '11px', color: '#555555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
              DATE
            </div>
            <input
              type="date"
              value={selectedDate}
              max={yesterday}
              onChange={e => {
                setSelectedDate(e.target.value)
                setDuplicateWarning(false)
              }}
              style={{
                width: '100%',
                backgroundColor: '#242424',
                border: '1px solid #2e2e2e',
                borderRadius: '8px',
                padding: '10px 12px',
                color: '#f0f0f0',
                fontSize: '15px',
                fontFamily: "'DM Sans', sans-serif",
                outline: 'none',
                boxSizing: 'border-box',
                colorScheme: 'dark',
              }}
            />
          </div>

          {/* Day type pills */}
          <div>
            <div style={{ fontSize: '11px', color: '#555555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
              DAY TYPE
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {DAY_TYPES.map(type => {
                const active = selectedDayType === type
                return (
                  <button
                    key={type}
                    onClick={() => setSelectedDayType(type)}
                    style={{
                      flex: 1,
                      height: '36px',
                      borderRadius: '9999px',
                      border: active ? 'none' : '1px solid #2e2e2e',
                      backgroundColor: active ? '#c8f135' : '#242424',
                      color: active ? '#0f0f0f' : '#888888',
                      fontSize: '13px',
                      fontFamily: "'Bebas Neue', sans-serif",
                      letterSpacing: '0.5px',
                      cursor: 'pointer',
                      transition: 'background-color 150ms ease, color 150ms ease',
                    }}
                  >
                    {type.toUpperCase()}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Duplicate warning */}
        {duplicateWarning && (
          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}>
            <span style={{ fontSize: '13px', color: '#f87171', lineHeight: 1.4 }}>
              A {selectedDayType} workout already exists for this date.
            </span>
            <button
              onClick={() => { setDuplicateWarning(false); handleSubmit(true) }}
              style={{
                background: 'none',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                borderRadius: '6px',
                padding: '6px 10px',
                color: '#f87171',
                fontSize: '11px',
                fontFamily: "'Bebas Neue', sans-serif",
                letterSpacing: '0.5px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              LOG ANYWAY
            </button>
          </div>
        )}

        {/* Exercises */}
        {selectedDayType && (
          loadingExercises ? (
            <div style={{ color: '#555555', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>
              Loading exercises...
            </div>
          ) : exercises.length === 0 ? (
            <div style={{ color: '#555555', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>
              No exercises found for {selectedDayType}.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {exercises.map(ex => (
                <div
                  key={ex.id}
                  style={{
                    backgroundColor: '#1a1a1a',
                    border: `1px solid ${skippedExercises.has(ex.id) ? 'rgba(239,68,68,0.2)' : '#2e2e2e'}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    opacity: skippedExercises.has(ex.id) ? 0.65 : 1,
                    transition: 'opacity 150ms ease, border-color 150ms ease',
                  }}
                >
                  {/* Exercise header */}
                  <div style={{
                    padding: '12px 16px',
                    borderBottom: skippedExercises.has(ex.id) ? 'none' : '1px solid #2e2e2e',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                      <span style={{
                        fontSize: '15px',
                        color: skippedExercises.has(ex.id) ? '#555555' : '#f0f0f0',
                        fontWeight: 600,
                        textDecoration: skippedExercises.has(ex.id) ? 'line-through' : 'none',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {ex.name}
                      </span>
                      {skippedExercises.has(ex.id) && (
                        <span style={{
                          fontSize: '10px', color: '#ef4444',
                          backgroundColor: 'rgba(239,68,68,0.1)',
                          border: '1px solid rgba(239,68,68,0.25)',
                          borderRadius: '9999px', padding: '1px 6px',
                          fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.5px',
                          flexShrink: 0,
                        }}>
                          SKIPPED
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      {!skippedExercises.has(ex.id) && (
                        <span style={{ fontSize: '12px', color: '#555555' }}>
                          {ex.sets_target} × {ex.reps_target}
                        </span>
                      )}
                      <button
                        onClick={() => setSkippedExercises(prev => {
                          const next = new Set(prev)
                          if (next.has(ex.id)) next.delete(ex.id)
                          else next.add(ex.id)
                          return next
                        })}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '3px',
                          padding: '2px 4px', opacity: 0.6,
                          borderRadius: '4px',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
                      >
                        {skippedExercises.has(ex.id) ? (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.37"/>
                            </svg>
                            <span style={{ fontSize: '10px', color: '#c8f135', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.5px' }}>UNDO</span>
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                            </svg>
                            <span style={{ fontSize: '10px', color: '#888888', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.5px' }}>SKIP</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Set rows */}
                  {!skippedExercises.has(ex.id) && (
                  <div style={{ padding: '8px 0' }}>
                    {(setInputs[ex.id] ?? []).map((s, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 16px',
                        }}
                      >
                        <span style={{
                          fontSize: '12px',
                          color: '#555555',
                          width: '40px',
                          flexShrink: 0,
                          fontFamily: "'Bebas Neue', sans-serif",
                          letterSpacing: '0.5px',
                        }}>
                          SET {idx + 1}
                        </span>

                        {/* Weight input */}
                        <div style={{ flex: 1, position: 'relative' }}>
                          <input
                            type="number"
                            inputMode="decimal"
                            placeholder="—"
                            value={s.weight}
                            onChange={e => updateSet(ex.id, idx, 'weight', e.target.value)}
                            style={{
                              width: '100%',
                              backgroundColor: '#242424',
                              border: '1px solid #2e2e2e',
                              borderRadius: '8px',
                              padding: '8px 36px 8px 10px',
                              color: '#f0f0f0',
                              fontSize: '14px',
                              fontFamily: "'JetBrains Mono', monospace",
                              outline: 'none',
                              boxSizing: 'border-box',
                              textAlign: 'right',
                            }}
                            onFocus={e => (e.currentTarget.style.borderColor = '#c8f135')}
                            onBlur={e => (e.currentTarget.style.borderColor = '#2e2e2e')}
                          />
                          <span style={{
                            position: 'absolute',
                            right: '8px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            fontSize: '11px',
                            color: '#555555',
                            pointerEvents: 'none',
                          }}>
                            lbs
                          </span>
                        </div>

                        {/* Reps input */}
                        <div style={{ width: '68px', flexShrink: 0, position: 'relative' }}>
                          <input
                            type="number"
                            inputMode="numeric"
                            value={s.reps}
                            onChange={e => updateSet(ex.id, idx, 'reps', e.target.value)}
                            style={{
                              width: '100%',
                              backgroundColor: '#242424',
                              border: '1px solid #2e2e2e',
                              borderRadius: '8px',
                              padding: '8px 32px 8px 10px',
                              color: '#f0f0f0',
                              fontSize: '14px',
                              fontFamily: "'JetBrains Mono', monospace",
                              outline: 'none',
                              boxSizing: 'border-box',
                              textAlign: 'right',
                            }}
                            onFocus={e => (e.currentTarget.style.borderColor = '#c8f135')}
                            onBlur={e => (e.currentTarget.style.borderColor = '#2e2e2e')}
                          />
                          <span style={{
                            position: 'absolute',
                            right: '7px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            fontSize: '11px',
                            color: '#555555',
                            pointerEvents: 'none',
                          }}>
                            reps
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* Error */}
        {error && (
          <div style={{ fontSize: '13px', color: '#ef4444', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {/* Submit */}
        {selectedDayType && exercises.length > 0 && !loadingExercises && (
          <button
            onClick={() => handleSubmit(false)}
            disabled={submitting}
            style={{
              width: '100%',
              height: '52px',
              backgroundColor: submitting ? '#555555' : '#c8f135',
              color: '#0f0f0f',
              border: 'none',
              borderRadius: '12px',
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '20px',
              letterSpacing: '1px',
              cursor: submitting ? 'default' : 'pointer',
              transition: 'opacity 150ms ease',
              marginTop: '4px',
            }}
            onMouseDown={e => { if (!submitting) e.currentTarget.style.opacity = '0.85' }}
            onMouseUp={e => { if (!submitting) e.currentTarget.style.opacity = '1' }}
            onTouchStart={e => { if (!submitting) e.currentTarget.style.opacity = '0.85' }}
            onTouchEnd={e => { if (!submitting) e.currentTarget.style.opacity = '1' }}
          >
            {submitting ? 'LOGGING...' : 'LOG WORKOUT'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function LogPastPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: '24px 16px', color: '#555555', fontFamily: "'DM Sans', sans-serif", fontSize: '14px' }}>
        Loading...
      </div>
    }>
      <LogPastContent />
    </Suspense>
  )
}
