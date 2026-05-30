'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Exercise, DayCategory } from '@/lib/types'

interface WorkoutManagerProps {
  onClose: () => void
  onChanged: () => void
}

type Screen =
  | { id: 'days' }
  | { id: 'day'; dayKey: string }
  | { id: 'exercise-form'; dayKey: string; exercise?: Exercise }
  | { id: 'new-day' }
  | { id: 'category-picker'; dayKey: string }

type DeleteTarget =
  | { type: 'day'; key: string; label: string }
  | { type: 'exercise'; id: string; name: string; dayKey: string }

export default function WorkoutManager({ onClose, onChanged }: WorkoutManagerProps) {
  const supabase = createClient()
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [dayCategories, setDayCategories] = useState<Record<string, DayCategory>>({})
  const [loading, setLoading] = useState(true)
  const [screen, setScreen] = useState<Screen>({ id: 'days' })
  const [saving, setSaving] = useState(false)
  const [savingCategory, setSavingCategory] = useState(false)
  const [categoryError, setCategoryError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleteError, setDeleteError] = useState('')

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
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const [exRes, catRes] = await Promise.all([
        supabase.from('exercises').select('*')
          .order('day_type', { ascending: true })
          .order('sort_order', { ascending: true }),
        user
          ? supabase.from('user_day_categories').select('day_key, category').eq('user_id', user.id)
          : Promise.resolve({ data: [] as { day_key: string; category: string }[] }),
      ])
      setExercises(exRes.data ?? [])
      const map: Record<string, DayCategory> = {}
      for (const r of (catRes.data ?? [])) map[r.day_key] = r.category as DayCategory
      setDayCategories(map)
    } catch {
      // Network/auth failure — keep whatever we have rather than wedging the UI.
      // The spinner is cleared in finally so the modal stays usable.
    } finally {
      setLoading(false)
    }
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

    try {
      const { error } = exercise
        ? await supabase.from('exercises').update({
            name: trimmedName,
            sets_target: sets,
            reps_target: formReps.trim(),
          }).eq('id', exercise.id)
        : await supabase.from('exercises').insert({
            name: trimmedName,
            day_type: dayKey,
            sets_target: sets,
            reps_target: formReps.trim(),
            sort_order: (grouped[dayKey] ?? []).reduce((m, e) => Math.max(m, e.sort_order), 0) + 1,
          })

      if (error) {
        setFormError('Could not save exercise. Check your connection and try again.')
        return
      }

      await load()
      onChanged()
      setScreen({ id: 'day', dayKey })
    } catch {
      setFormError('Could not save exercise. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || saving) return
    setSaving(true)
    setDeleteError('')
    try {
      const { error } = deleteTarget.type === 'day'
        ? await supabase.from('exercises').delete().eq('day_type', deleteTarget.key)
        : await supabase.from('exercises').delete().eq('id', deleteTarget.id)

      if (error) {
        setDeleteError('Could not delete. Check your connection and try again.')
        return
      }

      await load()
      onChanged()
      if (deleteTarget.type === 'day') setScreen({ id: 'days' })
      setDeleteTarget(null)
    } catch {
      setDeleteError('Could not delete. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  function submitNewDay() {
    const key = newDayInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (!key) return
    if (grouped[key]) {
      setNewDayInput('')
      setScreen({ id: 'day', dayKey: key })
      return
    }
    setNewDayInput('')
    setCategoryError('')
    setScreen({ id: 'category-picker', dayKey: key })
  }

  async function saveCategory(dayKey: string, category: DayCategory) {
    if (savingCategory) return // guard against rapid double-taps firing concurrent upserts
    setSavingCategory(true)
    setCategoryError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setCategoryError('You must be signed in to save a category.')
        return
      }
      const { error } = await supabase.from('user_day_categories').upsert(
        { user_id: user.id, day_key: dayKey, category },
        { onConflict: 'user_id,day_key' }
      )
      if (error) {
        // Surface the failure and stay on the picker — never navigate away as if it saved.
        setCategoryError('Could not save category. Check your connection and try again.')
        return
      }
      setDayCategories(prev => ({ ...prev, [dayKey]: category }))
      if (grouped[dayKey]) {
        setScreen({ id: 'day', dayKey })
      } else {
        openExerciseForm(dayKey)
      }
    } catch {
      setCategoryError('Could not save category. Check your connection and try again.')
    } finally {
      setSavingCategory(false)
    }
  }

  function goBack() {
    if (screen.id === 'days' || screen.id === 'new-day') {
      onClose()
    } else if (screen.id === 'category-picker') {
      setScreen(grouped[screen.dayKey] ? { id: 'days' } : { id: 'new-day' })
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
    screen.id === 'category-picker' ? 'SELECT CATEGORY' :
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
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: '12px',
            flexShrink: 0,
          }}>
            {screen.id !== 'days' && (
              <button
                onClick={goBack}
                aria-label="Back"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  width: '44px', height: '44px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            <h2 style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px',
              color: 'var(--text-primary)', letterSpacing: '1px', flex: 1,
              fontWeight: 'normal',
            }}>
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close workout manager"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                width: '44px', height: '44px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
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
                  <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontSize: '14px', fontFamily: "'DM Sans', sans-serif" }}>
                    Loading...
                  </div>
                ) : dayKeys.length === 0 ? (
                  <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontSize: '14px', fontFamily: "'DM Sans', sans-serif" }}>
                    No workout days yet. Add one below.
                  </div>
                ) : (
                  dayKeys.map(key => {
                    const exs = grouped[key]
                    return (
                      <div key={key} style={{ borderBottom: '1px solid var(--border)' }}>
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
                              color: 'var(--text-primary)', letterSpacing: '1px', marginBottom: '2px',
                            }}>
                              {key.replace(/-/g, ' ').toUpperCase()}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
                              {exs.length} exercise{exs.length !== 1 ? 's' : ''}
                            </div>
                            {!dayCategories[key] && (
                              <div
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '4px',
                                  marginTop: '4px', fontSize: '11px',
                                  color: '#F59E0B', fontFamily: "'DM Sans', sans-serif",
                                }}
                                onClick={e => { e.stopPropagation(); setCategoryError(''); setScreen({ id: 'category-picker', dayKey: key }) }}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                                </svg>
                                No leaderboard category — tap to set
                              </div>
                            )}
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
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </button>
                          <button
                            onClick={() => { setDeleteError(''); setDeleteTarget({ type: 'day', key, label: key.replace(/-/g, ' ').toUpperCase() }) }}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              padding: '8px', opacity: 0.4,
                              display: 'flex', alignItems: 'center',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
                          >
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--danger)' }}>
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
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  <span style={{
                    fontFamily: "'DM Sans', sans-serif", fontSize: '15px',
                    fontWeight: 600, color: 'var(--accent)',
                  }}>
                    ADD NEW DAY
                  </span>
                </button>
              </>
            )}

            {/* ── New Day ── */}
            {screen.id === 'new-day' && (
              <div style={{ padding: '20px 16px' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", marginBottom: '8px' }}>
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
                    backgroundColor: 'var(--surface-elevated)',
                    border: '1px solid var(--border-strong)', borderRadius: '8px',
                    color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif",
                    fontSize: '16px', padding: '0 14px',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={submitNewDay}
                  disabled={!newDayInput.trim()}
                  style={{
                    marginTop: '14px', width: '100%', height: '48px',
                    backgroundColor: newDayInput.trim() ? 'var(--accent)' : 'var(--border)',
                    color: newDayInput.trim() ? 'var(--bg)' : 'var(--text-muted)',
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

            {/* ── Category Picker ── */}
            {screen.id === 'category-picker' && (
              <div style={{ padding: '20px 16px' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", marginBottom: '16px' }}>
                  Which leaderboard tab should{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {screen.dayKey.replace(/-/g, ' ').toUpperCase()}
                  </strong>{' '}
                  count toward?
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {([
                    { key: 'push' as DayCategory,  label: 'PUSH',  sub: 'Chest, shoulders, triceps' },
                    { key: 'pull' as DayCategory,  label: 'PULL',  sub: 'Back, biceps, rear delts' },
                    { key: 'legs' as DayCategory,  label: 'LEGS',  sub: 'Quads, hamstrings, glutes' },
                    { key: 'other' as DayCategory, label: 'OTHER', sub: 'Cardio, abs, full-body, etc.' },
                  ] as const).map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => saveCategory(screen.dayKey, opt.key)}
                      disabled={savingCategory}
                      style={{
                        width: '100%', textAlign: 'left',
                        backgroundColor: 'var(--surface-elevated)',
                        border: '1px solid var(--border)', borderRadius: '10px',
                        padding: '14px 16px',
                        cursor: savingCategory ? 'default' : 'pointer',
                        opacity: savingCategory ? 0.6 : 1,
                        display: 'flex', flexDirection: 'column', gap: '3px',
                      }}
                      onMouseEnter={e => { if (!savingCategory) e.currentTarget.style.borderColor = 'var(--accent)' }}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                    >
                      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px', color: 'var(--accent)', letterSpacing: '1px' }}>
                        {opt.label}
                      </span>
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: 'var(--text-muted)' }}>
                        {opt.sub}
                      </span>
                    </button>
                  ))}
                </div>
                {categoryError && (
                  <div style={{ marginTop: '14px', fontSize: '13px', color: 'var(--danger)', fontFamily: "'DM Sans', sans-serif" }}>
                    {categoryError}
                  </div>
                )}
              </div>
            )}

            {/* ── Day Exercises ── */}
            {screen.id === 'day' && (() => {
              const dayKey = screen.dayKey
              const exs = grouped[dayKey] ?? []
              return (
                <>
                  {exs.length === 0 ? (
                    <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontSize: '14px', fontFamily: "'DM Sans', sans-serif" }}>
                      No exercises yet. Add one below.
                    </div>
                  ) : (
                    exs.map(ex => (
                      <div
                        key={ex.id}
                        style={{
                          display: 'flex', alignItems: 'center',
                          padding: '14px 16px', gap: '12px',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                            {ex.name}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
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
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => { setDeleteError(''); setDeleteTarget({ type: 'exercise', id: ex.id, name: ex.name, dayKey }) }}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: '8px', opacity: 0.4,
                            display: 'flex', alignItems: 'center',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                          onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--danger)' }}>
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
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    <span style={{
                      fontFamily: "'DM Sans', sans-serif", fontSize: '15px',
                      fontWeight: 600, color: 'var(--accent)',
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
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Exercise Name
                  </label>
                  <input
                    autoFocus
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g. Bench Press"
                    style={{
                      width: '100%', height: '48px',
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)', borderRadius: '8px',
                      color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif",
                      fontSize: '16px', padding: '0 14px',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                        backgroundColor: 'var(--surface-elevated)',
                        border: '1px solid var(--border-strong)', borderRadius: '8px',
                        color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '20px', textAlign: 'center',
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Reps / Target
                    </label>
                    <input
                      value={formReps}
                      onChange={e => setFormReps(e.target.value)}
                      onFocus={e => e.target.select()}
                      placeholder="8 or 8-12"
                      style={{
                        width: '100%', height: '48px',
                        backgroundColor: 'var(--surface-elevated)',
                        border: '1px solid var(--border-strong)', borderRadius: '8px',
                        color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '20px', textAlign: 'center',
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>

                {formError && (
                  <div style={{ fontSize: '13px', color: 'var(--danger)', fontFamily: "'DM Sans', sans-serif" }}>
                    {formError}
                  </div>
                )}

                <button
                  onClick={saveExercise}
                  disabled={saving}
                  style={{
                    height: '52px',
                    backgroundColor: saving ? 'var(--border)' : 'var(--accent)',
                    color: saving ? 'var(--text-muted)' : 'var(--bg)',
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
            backgroundColor: 'var(--surface)', borderRadius: '12px',
            border: '1px solid var(--border)', padding: '24px',
            width: '100%', maxWidth: '320px',
          }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px', color: 'var(--text-primary)', marginBottom: '8px' }}>
              {deleteTarget.type === 'day' ? 'DELETE DAY?' : 'DELETE EXERCISE?'}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", marginBottom: '20px' }}>
              {deleteTarget.type === 'day'
                ? `Remove "${deleteTarget.label}" and all its exercises? This cannot be undone.`
                : `Remove "${deleteTarget.name}" from this day?`}
            </div>
            {deleteError && (
              <div style={{ fontSize: '13px', color: 'var(--danger)', fontFamily: "'DM Sans', sans-serif", marginBottom: '16px' }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => { setDeleteTarget(null); setDeleteError('') }}
                disabled={saving}
                style={{
                  flex: 1, height: '44px', backgroundColor: 'var(--surface-elevated)',
                  border: '1px solid var(--border)', borderRadius: '8px',
                  color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif",
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
                  color: 'var(--danger)', fontFamily: "'DM Sans', sans-serif",
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
