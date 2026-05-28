'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Exercise } from '@/lib/types'

interface WorkoutManagerProps {
  onClose: () => void
  onChanged: () => void
}

type Screen =
  | { id: 'days' }
  | { id: 'day'; dayKey: string }
  | { id: 'exercise-form'; dayKey: string; exercise?: Exercise }
  | { id: 'new-day' }

type DeleteTarget =
  | { type: 'day'; key: string; label: string }
  | { type: 'exercise'; id: string; name: string; dayKey: string }

export default function WorkoutManager({ onClose, onChanged }: WorkoutManagerProps) {
  const supabase = createClient()
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [loading, setLoading] = useState(true)
  const [screen, setScreen] = useState<Screen>({ id: 'days' })
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  // new-day form
  const [newDayInput, setNewDayInput] = useState('')
  // exercise form
  const [formName, setFormName] = useState('')
  const [formSets, setFormSets] = useState('3')
  const [formReps, setFormReps] = useState('8')
  const [formError, setFormError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .order('day_type', { ascending: true })
      .order('sort_order', { ascending: true })
    setExercises(data ?? [])
    setLoading(false)
  }

  const grouped: Record<string, Exercise[]> = {}
  for (const ex of exercises) {
    if (!grouped[ex.day_type]) grouped[ex.day_type] = []
    grouped[ex.day_type].push(ex)
  }
  const dayKeys = Object.keys(grouped).sort()

  function openExerciseForm(dayKey: string, exercise?: Exercise) {
    setFormName(exercise?.name ?? '')
    setFormSets(String(exercise?.sets_target ?? 3))
    setFormReps(String(exercise?.reps_target ?? '8'))
    setFormError('')
    setScreen({ id: 'exercise-form', dayKey, exercise })
  }

  async function saveExercise() {
    const currentScreen = screen
    if (currentScreen.id !== 'exercise-form') return
    const trimmedName = formName.trim()
    if (!trimmedName) { setFormError('Exercise name is required.'); return }
    const sets = parseInt(formSets)
    if (!sets || sets < 1 || sets > 20) { setFormError('Sets must be between 1 and 20.'); return }
    if (!formReps.trim()) { setFormError('Reps is required.'); return }

    const { dayKey, exercise } = currentScreen

    // Prevent duplicate names within the same day
    const duplicate = (grouped[dayKey] ?? []).some(
      e => e.id !== exercise?.id && e.name.trim().toLowerCase() === trimmedName.toLowerCase()
    )
    if (duplicate) {
      setFormError('An exercise with this name already exists for this day.')
      return
    }

    setSaving(true)
    setFormError('')

    if (exercise) {
      await supabase.from('exercises').update({
        name: trimmedName,
        sets_target: sets,
        reps_target: formReps.trim(),
      }).eq('id', exercise.id)
    } else {
      const maxOrder = (grouped[dayKey] ?? []).reduce((m, e) => Math.max(m, e.sort_order), 0)
      await supabase.from('exercises').insert({
        name: trimmedName,
        day_type: dayKey,
        sets_target: sets,
        reps_target: formReps.trim(),
        sort_order: maxOrder + 1,
      })
    }

    await load()
    setSaving(false)
    onChanged()
    setScreen({ id: 'day', dayKey })
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setSaving(true)
    if (deleteTarget.type === 'day') {
      await supabase.from('exercises').delete().eq('day_type', deleteTarget.key)
      await load()
      setSaving(false)
      onChanged()
      setDeleteTarget(null)
      setScreen({ id: 'days' })
    } else {
      await supabase.from('exercises').delete().eq('id', deleteTarget.id)
      await load()
      setSaving(false)
      onChanged()
      setDeleteTarget(null)
    }
  }

  function submitNewDay() {
    const key = newDayInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (!key) return
    if (grouped[key]) {
      // day already exists, just navigate to it
      setNewDayInput('')
      setScreen({ id: 'day', dayKey: key })
      return
    }
    setNewDayInput('')
    openExerciseForm(key)
  }

  function goBack() {
    if (screen.id === 'days' || screen.id === 'new-day') {
      onClose()
    } else if (screen.id === 'day') {
      setScreen({ id: 'days' })
    } else if (screen.id === 'exercise-form') {
      const dayKey = screen.dayKey
      const dayExists = !!grouped[dayKey]
      setScreen(dayExists ? { id: 'day', dayKey } : { id: 'days' })
    }
  }

  const title =
    screen.id === 'days' ? 'MANAGE WORKOUTS' :
    screen.id === 'new-day' ? 'NEW DAY' :
    screen.id === 'day' ? screen.dayKey.replace(/-/g, ' ').toUpperCase() :
    screen.exercise ? 'EDIT EXERCISE' : 'ADD EXERCISE'

  return (
    <>
      {/* Backdrop */}
      <div className="wm-backdrop" onClick={onClose}>
        {/* Sheet */}
        <div className="wm-sheet" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div style={{
            padding: '20px 16px 14px',
            borderBottom: '1px solid #2e2e2e',
            display: 'flex', alignItems: 'center', gap: '12px',
            flexShrink: 0,
          }}>
            {screen.id !== 'days' && (
              <button
                onClick={goBack}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            <span style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px',
              color: '#f0f0f0', letterSpacing: '1px', flex: 1,
            }}>
              {title}
            </span>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                width: '32px', height: '32px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="wm-scroll scrollbar-hide">

            {/* ── Days List ── */}
            {screen.id === 'days' && (
              <>
                {loading ? (
                  <div style={{ padding: '24px 16px', color: '#555555', fontSize: '14px', fontFamily: "'DM Sans', sans-serif" }}>
                    Loading...
                  </div>
                ) : dayKeys.length === 0 ? (
                  <div style={{ padding: '24px 16px', color: '#555555', fontSize: '14px', fontFamily: "'DM Sans', sans-serif" }}>
                    No workout days yet. Add one below.
                  </div>
                ) : (
                  dayKeys.map(key => {
                    const exs = grouped[key]
                    return (
                      <div key={key} style={{ borderBottom: '1px solid #2e2e2e' }}>
                        <div style={{
                          display: 'flex', alignItems: 'center',
                          padding: '16px',
                          gap: '12px',
                        }}>
                          <button
                            onClick={() => setScreen({ id: 'day', dayKey: key })}
                            style={{
                              flex: 1, textAlign: 'left', background: 'none', border: 'none',
                              cursor: 'pointer', padding: 0,
                            }}
                          >
                            <div style={{
                              fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px',
                              color: '#f0f0f0', letterSpacing: '1px', marginBottom: '2px',
                            }}>
                              {key.replace(/-/g, ' ').toUpperCase()}
                            </div>
                            <div style={{ fontSize: '12px', color: '#555555', fontFamily: "'DM Sans', sans-serif" }}>
                              {exs.length} exercise{exs.length !== 1 ? 's' : ''}
                            </div>
                          </button>
                          <button
                            onClick={() => setScreen({ id: 'day', dayKey: key })}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              padding: '8px', opacity: 0.5,
                              display: 'flex', alignItems: 'center',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ type: 'day', key, label: key.replace(/-/g, ' ').toUpperCase() })}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              padding: '8px', opacity: 0.4,
                              display: 'flex', alignItems: 'center',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
                          >
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}

                {/* Add Day */}
                <button
                  onClick={() => { setNewDayInput(''); setScreen({ id: 'new-day' }) }}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: 'none', border: 'none',
                    padding: '18px 16px',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '10px',
                    borderBottom: '1px solid #2e2e2e',
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  <span style={{
                    fontFamily: "'DM Sans', sans-serif", fontSize: '15px',
                    fontWeight: 600, color: '#c8f135',
                  }}>
                    ADD NEW DAY
                  </span>
                </button>
              </>
            )}

            {/* ── New Day ── */}
            {screen.id === 'new-day' && (
              <div style={{ padding: '20px 16px' }}>
                <div style={{ fontSize: '13px', color: '#888888', fontFamily: "'DM Sans', sans-serif", marginBottom: '8px' }}>
                  Day name (e.g. "Abs", "Cardio", "Upper Body")
                </div>
                <input
                  autoFocus
                  value={newDayInput}
                  onChange={e => setNewDayInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submitNewDay()}
                  placeholder="Day name"
                  style={{
                    width: '100%', height: '48px',
                    backgroundColor: '#242424',
                    border: '1px solid #3a3a3a', borderRadius: '8px',
                    color: '#f0f0f0', fontFamily: "'DM Sans', sans-serif",
                    fontSize: '16px', padding: '0 14px',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={submitNewDay}
                  disabled={!newDayInput.trim()}
                  style={{
                    marginTop: '14px', width: '100%', height: '48px',
                    backgroundColor: newDayInput.trim() ? '#c8f135' : '#2e2e2e',
                    color: newDayInput.trim() ? '#0f0f0f' : '#555555',
                    border: 'none', borderRadius: '8px',
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: '18px',
                    letterSpacing: '1px', cursor: newDayInput.trim() ? 'pointer' : 'default',
                    transition: 'background-color 150ms ease, color 150ms ease',
                  }}
                >
                  NEXT — ADD EXERCISES
                </button>
              </div>
            )}

            {/* ── Day Exercises ── */}
            {screen.id === 'day' && (() => {
              const dayKey = screen.dayKey
              const exs = grouped[dayKey] ?? []
              return (
                <>
                  {exs.length === 0 ? (
                    <div style={{ padding: '24px 16px', color: '#555555', fontSize: '14px', fontFamily: "'DM Sans', sans-serif" }}>
                      No exercises yet. Add one below.
                    </div>
                  ) : (
                    exs.map(ex => (
                      <div
                        key={ex.id}
                        style={{
                          display: 'flex', alignItems: 'center',
                          padding: '14px 16px', gap: '12px',
                          borderBottom: '1px solid #2e2e2e',
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '15px', fontWeight: 600, color: '#f0f0f0', marginBottom: '2px' }}>
                            {ex.name}
                          </div>
                          <div style={{ fontSize: '12px', color: '#555555', fontFamily: "'DM Sans', sans-serif" }}>
                            {ex.sets_target} sets × {ex.reps_target} reps
                          </div>
                        </div>
                        <button
                          onClick={() => openExerciseForm(dayKey, ex)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: '8px', opacity: 0.5,
                            display: 'flex', alignItems: 'center',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                          onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => setDeleteTarget({ type: 'exercise', id: ex.id, name: ex.name, dayKey })}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: '8px', opacity: 0.4,
                            display: 'flex', alignItems: 'center',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                          onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      </div>
                    ))
                  )}

                  <button
                    onClick={() => openExerciseForm(dayKey)}
                    style={{
                      width: '100%', textAlign: 'left',
                      background: 'none', border: 'none',
                      padding: '18px 16px',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '10px',
                      borderBottom: '1px solid #2e2e2e',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    <span style={{
                      fontFamily: "'DM Sans', sans-serif", fontSize: '15px',
                      fontWeight: 600, color: '#c8f135',
                    }}>
                      ADD EXERCISE
                    </span>
                  </button>
                </>
              )
            })()}

            {/* ── Exercise Form ── */}
            {screen.id === 'exercise-form' && (
              <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#888888', fontFamily: "'DM Sans', sans-serif", marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Exercise Name
                  </label>
                  <input
                    autoFocus
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g. Bench Press"
                    style={{
                      width: '100%', height: '48px',
                      backgroundColor: '#242424',
                      border: '1px solid #3a3a3a', borderRadius: '8px',
                      color: '#f0f0f0', fontFamily: "'DM Sans', sans-serif",
                      fontSize: '16px', padding: '0 14px',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#888888', fontFamily: "'DM Sans', sans-serif", marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Sets
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={formSets}
                      onChange={e => setFormSets(e.target.value)}
                      onFocus={e => e.target.select()}
                      min={1} max={20}
                      style={{
                        width: '100%', height: '48px',
                        backgroundColor: '#242424',
                        border: '1px solid #3a3a3a', borderRadius: '8px',
                        color: '#f0f0f0', fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '20px', textAlign: 'center',
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#888888', fontFamily: "'DM Sans', sans-serif", marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Reps / Target
                    </label>
                    <input
                      value={formReps}
                      onChange={e => setFormReps(e.target.value)}
                      onFocus={e => e.target.select()}
                      placeholder="8 or 8-12"
                      style={{
                        width: '100%', height: '48px',
                        backgroundColor: '#242424',
                        border: '1px solid #3a3a3a', borderRadius: '8px',
                        color: '#f0f0f0', fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '20px', textAlign: 'center',
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>

                {formError && (
                  <div style={{ fontSize: '13px', color: '#ef4444', fontFamily: "'DM Sans', sans-serif" }}>
                    {formError}
                  </div>
                )}

                <button
                  onClick={saveExercise}
                  disabled={saving}
                  style={{
                    height: '52px',
                    backgroundColor: saving ? '#2e2e2e' : '#c8f135',
                    color: saving ? '#555555' : '#0f0f0f',
                    border: 'none', borderRadius: '10px',
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px',
                    letterSpacing: '1px', cursor: saving ? 'default' : 'pointer',
                    transition: 'background-color 150ms ease, color 150ms ease',
                  }}
                >
                  {saving ? 'SAVING...' : screen.exercise ? 'SAVE CHANGES' : 'ADD EXERCISE'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="wm-confirm-overlay">
          <div style={{
            backgroundColor: '#1a1a1a', borderRadius: '12px',
            border: '1px solid #2e2e2e', padding: '24px',
            width: '100%', maxWidth: '320px',
          }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px', color: '#f0f0f0', marginBottom: '8px' }}>
              {deleteTarget.type === 'day' ? 'DELETE DAY?' : 'DELETE EXERCISE?'}
            </div>
            <div style={{ fontSize: '14px', color: '#888888', fontFamily: "'DM Sans', sans-serif", marginBottom: '20px' }}>
              {deleteTarget.type === 'day'
                ? `Remove "${deleteTarget.label}" and all its exercises? This cannot be undone.`
                : `Remove "${deleteTarget.name}" from this day?`}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setDeleteTarget(null)}
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
                onClick={confirmDelete}
                disabled={saving}
                style={{
                  flex: 1, height: '44px', backgroundColor: 'rgba(239,68,68,0.15)',
                  border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
                  color: '#ef4444', fontFamily: "'DM Sans', sans-serif",
                  fontSize: '14px', fontWeight: 600, cursor: saving ? 'default' : 'pointer',
                }}
              >
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
