'use client'

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Dialog from '@/components/ui/Dialog'
import { useUnit } from '@/lib/contexts/UnitContext'
import { sheetShouldDismiss } from '@/lib/utils/sheetDismiss'
import { resolveSearchSubmit } from '@/lib/utils/exercisePickerSearch'
import type { Exercise } from '@/lib/types'

/** Matches `.grind-sheet--closing` / backdrop fade. Keep in sync with CSS. */
export const EXERCISE_PICKER_EXIT_MS = 300

function dismissKeyboard() {
  const el = document.activeElement
  if (el instanceof HTMLElement) el.blur()
}

function HighlightName({ name, query }: { name: string; query: string }) {
  if (!query) return name
  const i = name.toLowerCase().indexOf(query.toLowerCase())
  if (i < 0) return name
  return (
    <>
      {name.slice(0, i)}
      <mark style={{
        background: 'transparent',
        color: 'var(--accent-text)',
        fontWeight: 700,
      }}>
        {name.slice(i, i + query.length)}
      </mark>
      {name.slice(i + query.length)}
    </>
  )
}

export default function ExercisePickerSheet({
  intent,
  currentExerciseId,
  day,
  allExercises,
  currentExercises,
  closing = false,
  onSelect,
  onCreate,
  onClose,
}: {
  intent: 'swap' | 'add'
  currentExerciseId: string | null
  day: string
  allExercises: Exercise[]
  currentExercises: Exercise[]
  closing?: boolean
  onSelect: (exercise: Exercise) => void
  onCreate: (name: string, sets: number, reps: string, weightTarget: number | null) => Promise<Exercise | null>
  onClose: () => void
}) {
  const { unitLabel, fromDisplay } = useUnit()
  const titleId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const [closingFromDrag, setClosingFromDrag] = useState(false)
  const dragRef = useRef<{
    pointerId: number
    startY: number
    lastY: number
    lastT: number
    velocity: number
    active: boolean
  } | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'search' | 'create'>('search')
  const [formName, setFormName] = useState('')
  const [formSets, setFormSets] = useState('3')
  const [formReps, setFormReps] = useState('8-12')
  const [formWeight, setFormWeight] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const available = useMemo(() => (
    intent === 'add'
      ? allExercises.filter(ex => !currentExercises.find(ce => ce.id === ex.id))
      : allExercises.filter(
          ex => ex.id === currentExerciseId || !currentExercises.find(ce => ce.id === ex.id),
        )
  ), [intent, allExercises, currentExercises, currentExerciseId])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? available.filter(ex => ex.name.toLowerCase().includes(q)) : available),
    [available, q],
  )
  const alreadyInSession = useMemo(
    () => (intent === 'add' && q
      ? currentExercises.filter(ex => ex.name.toLowerCase().includes(q))
      : []),
    [intent, q, currentExercises],
  )

  const grouped = useMemo(() => {
    const dayTypes = [...new Set(filtered.map(e => e.day_type))].sort()
    const map: Record<string, Exercise[]> = {}
    for (const dt of dayTypes) {
      map[dt] = filtered.filter(e => e.day_type === dt)
    }
    return { dayTypes, map }
  }, [filtered])

  const trimmedQuery = query.trim()
  const exactExists = allExercises.some(
    ex => ex.name.trim().toLowerCase() === trimmedQuery.toLowerCase(),
  )
  const canOfferCreate = trimmedQuery.length > 0 && !exactExists

  function requestClose() {
    if (closing || saving || closingFromDrag) return
    dismissKeyboard()
    onClose()
  }

  function openCreate() {
    dismissKeyboard()
    setFormName(trimmedQuery)
    setFormSets('3')
    setFormReps('8-12')
    setFormWeight('')
    setError('')
    setMode('create')
  }

  function submitSearch() {
    const action = resolveSearchSubmit(query, available, canOfferCreate)
    if (action.type === 'pick') {
      const ex = available.find(e => e.id === action.id)
      if (ex) pick(ex)
      return
    }
    if (action.type === 'create') openCreate()
  }

  function pick(ex: Exercise) {
    if (closing || saving) return
    dismissKeyboard()
    onSelect(ex)
  }

  async function submitCreate() {
    if (saving || closing) return
    const name = formName.trim()
    if (!name) { setError('Exercise name is required.'); return }
    const sets = parseInt(formSets, 10)
    if (!sets || sets < 1 || sets > 20) { setError('Sets must be between 1 and 20.'); return }
    if (!formReps.trim()) { setError('Reps is required.'); return }
    let weightTarget: number | null = null
    if (formWeight.trim()) {
      const parsed = parseFloat(formWeight)
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError(`Default weight must be 0 or more ${unitLabel}.`)
        return
      }
      weightTarget = fromDisplay(parsed)
    }
    const dupInDay = allExercises.some(
      ex => ex.day_type === day && ex.name.trim().toLowerCase() === name.toLowerCase(),
    )
    if (dupInDay) { setError('An exercise with this name already exists for this day.'); return }

    setSaving(true)
    setError('')
    const created = await onCreate(name, sets, formReps.trim(), weightTarget)
    if (!created) {
      setSaving(false)
      setError('Could not create exercise. Check your connection and try again.')
    }
  }

  function onHeaderPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (closing || saving) return
    const t = e.target as HTMLElement
    if (t.closest('button, input, textarea, a')) return
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
      active: true,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onHeaderPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d?.active || e.pointerId !== d.pointerId) return
    const dy = Math.max(0, e.clientY - d.startY)
    const dt = Math.max(1, e.timeStamp - d.lastT)
    d.velocity = (e.clientY - d.lastY) / dt
    d.lastY = e.clientY
    d.lastT = e.timeStamp
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.classList.add('grind-sheet--dragging')
    sheet.style.transform = `translateY(${dy}px)`
  }

  function onHeaderPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d?.active || e.pointerId !== d.pointerId) return
    d.active = false
    const dy = Math.max(0, e.clientY - d.startY)
    const sheet = sheetRef.current
    if (!sheet) return

    if (sheetShouldDismiss(dy, d.velocity)) {
      setClosingFromDrag(true)
      const off = Math.max(window.innerHeight - dy, 160)
      sheet.classList.add('grind-sheet--dragging')
      sheet.style.transition = 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)'
      sheet.style.transform = `translateY(${dy + off}px)`
      dismissKeyboard()
      onClose()
      return
    }

    sheet.style.transition = 'transform 280ms cubic-bezier(0.32, 0.72, 0, 1)'
    sheet.style.transform = 'translateY(0)'
    const clear = () => {
      sheet.classList.remove('grind-sheet--dragging')
      sheet.style.transition = ''
      sheet.style.transform = ''
      sheet.removeEventListener('transitionend', clear)
    }
    sheet.addEventListener('transitionend', clear)
  }

  const [enter, setEnter] = useState(true)
  const title =
    mode === 'create' ? 'NEW EXERCISE' : intent === 'add' ? 'ADD EXERCISE' : 'SWAP EXERCISE'

  useEffect(() => {
    const sheet = sheetRef.current
    const done = () => setEnter(false)
    const t = window.setTimeout(done, 400)
    const onEnd = (e: AnimationEvent) => {
      if (e.animationName !== 'sheet-up') return
      done()
    }
    sheet?.addEventListener('animationend', onEnd)
    return () => {
      window.clearTimeout(t)
      sheet?.removeEventListener('animationend', onEnd)
    }
  }, [])

  return (
    <Dialog
      open
      closing={closing}
      onClose={saving ? undefined : requestClose}
      labelledBy={titleId}
      zIndex={520}
      avoidKeyboard
      focusPanel
      className="grind-sheet-backdrop"
      panelStyle={{ maxWidth: '480px', overflow: 'visible' }}
    >
      <div
        ref={sheetRef}
        className={
          'grind-sheet'
          + (enter && !closing ? ' grind-sheet--enter' : '')
          + (closing && !closingFromDrag ? ' grind-sheet--closing' : '')
          + (closingFromDrag ? ' grind-sheet--dragging' : '')
        }
      >
        <div
          className="grind-sheet__header"
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
        >
          <div className="grind-sheet__grabber" aria-hidden />
          <div style={{
            padding: '12px 16px 14px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
              {mode === 'create' && (
                <button
                  type="button"
                  className="press"
                  data-haptic="light"
                  onClick={() => { setMode('search'); setError('') }}
                  aria-label="Back to search"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    width: '44px', height: '44px', marginLeft: '-10px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              )}
              <h2
                id={titleId}
                style={{
                  fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px',
                  color: 'var(--text-primary)', letterSpacing: '1px', fontWeight: 'normal',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  margin: 0,
                }}
              >
                {title}
              </h2>
            </div>
            <button
              type="button"
              className="press"
              data-haptic="light"
              onClick={requestClose}
              aria-label={intent === 'add' ? 'Close add dialog' : 'Close swap dialog'}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                width: '44px', height: '44px', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {mode === 'search' ? (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
            <div className="grind-sheet__search">
              <div className="grind-sheet__search-field">
                <input
                  ref={searchInputRef}
                  type="text"
                  inputMode="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    submitSearch()
                  }}
                  placeholder="Search or add an exercise..."
                  aria-label="Search exercises"
                  enterKeyHint="go"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="words"
                  spellCheck={false}
                />
                {query.length > 0 && (
                  <button
                    type="button"
                    className="grind-sheet__search-clear press"
                    data-haptic="light"
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery('')
                      searchInputRef.current?.focus()
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="9" />
                      <line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {canOfferCreate && (
              <button
                type="button"
                className="press grind-sheet__create-offer"
                data-haptic="light"
                onClick={openCreate}
              >
                <span style={{
                  width: '28px', height: '28px', borderRadius: '9999px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: 'var(--accent)', color: 'var(--on-accent)',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: '15px', fontWeight: 600, color: 'var(--accent-text)',
                    fontFamily: "'DM Sans', sans-serif",
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    Create “{trimmedQuery}”
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
                    New exercise for this day
                  </div>
                </div>
              </button>
            )}

            <div className="grind-sheet__list">
              {grouped.dayTypes.length === 0 && !canOfferCreate && alreadyInSession.length === 0 && (
                <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', lineHeight: 1.5 }}>
                  {intent === 'add' && !q && available.length === 0
                    ? 'Every exercise is already in this workout. Type a name to create a new one.'
                    : 'No matches.'}
                </div>
              )}

              {alreadyInSession.length > 0 && (
                <div>
                  <div style={{
                    padding: '12px 16px 6px',
                    fontSize: '10px', color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '1.5px',
                  }}>
                    Already in this workout
                  </div>
                  {alreadyInSession.map(ex => (
                    <div
                      key={ex.id}
                      style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: '12px',
                        opacity: 0.7,
                      }}
                    >
                      <div>
                        <div style={{
                          fontSize: '15px', fontWeight: 600,
                          color: 'var(--text-secondary)',
                          fontFamily: "'DM Sans', sans-serif",
                          marginBottom: '2px',
                        }}>
                          <HighlightName name={ex.name} query={q} />
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
                          {ex.sets_target} sets × {ex.reps_target} reps
                        </div>
                      </div>
                      <span style={{
                        fontSize: '10px', color: 'var(--text-muted)',
                        backgroundColor: 'var(--surface-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: '9999px', padding: '2px 8px',
                        fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                        flexShrink: 0,
                      }}>
                        ADDED
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {grouped.dayTypes.map(dayType => {
                const exs = grouped.map[dayType]
                if (!exs || exs.length === 0) return null
                return (
                  <div key={dayType}>
                    <div style={{
                      padding: '12px 16px 6px',
                      fontSize: '10px', color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: '1.5px',
                    }}>
                      {dayType.replace(/-/g, ' ').toUpperCase()}
                    </div>
                    {exs.map(ex => {
                      const isCurrent = intent === 'swap' && ex.id === currentExerciseId
                      return (
                        <button
                          key={ex.id}
                          type="button"
                          className="press grind-sheet__row"
                          data-haptic={isCurrent ? undefined : 'light'}
                          aria-current={isCurrent ? 'true' : undefined}
                          onClick={() => { if (!isCurrent) pick(ex) }}
                        >
                          <div>
                            <div style={{
                              fontSize: '15px', fontWeight: 600,
                              color: isCurrent ? 'var(--accent-text)' : 'var(--text-primary)',
                              fontFamily: "'DM Sans', sans-serif",
                              marginBottom: '2px',
                            }}>
                              <HighlightName name={ex.name} query={q} />
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
                              {ex.sets_target} sets × {ex.reps_target} reps
                            </div>
                          </div>
                          {isCurrent && (
                            <span style={{
                              fontSize: '10px', color: 'var(--accent-text)',
                              backgroundColor: 'var(--accent-wash)',
                              border: '1px solid var(--accent-border)',
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
        ) : (
          <>
            <div className="swap-in grind-sheet__list">
            <div style={{ padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="swap-new-name" style={{
                  fontSize: '10px', letterSpacing: 'var(--tracking-label)',
                  color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500,
                }}>
                  Name
                </label>
                <input
                  id="swap-new-name"
                  type="text"
                  value={formName}
                  onChange={e => { setFormName(e.target.value); if (error) setError('') }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submitCreate() } }}
                  placeholder="e.g. Incline Dumbbell Press"
                  autoComplete="off"
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--surface-elevated)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '16px',
                    padding: '11px 12px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: '0 0 96px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="swap-new-sets" style={{
                    fontSize: '10px', letterSpacing: 'var(--tracking-label)',
                    color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500,
                  }}>
                    Sets
                  </label>
                  <input
                    id="swap-new-sets"
                    type="number"
                    inputMode="numeric"
                    value={formSets}
                    onChange={e => { setFormSets(e.target.value); if (error) setError('') }}
                    onFocus={e => e.target.select()}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('swap-new-reps')?.focus() } }}
                    min={1}
                    max={20}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '16px',
                      padding: '11px 12px',
                      textAlign: 'center',
                      outline: 'none',
                    }}
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="swap-new-reps" style={{
                    fontSize: '10px', letterSpacing: 'var(--tracking-label)',
                    color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500,
                  }}>
                    Reps
                  </label>
                  <input
                    id="swap-new-reps"
                    type="text"
                    inputMode="text"
                    value={formReps}
                    onChange={e => { setFormReps(e.target.value); if (error) setError('') }}
                    onFocus={e => e.target.select()}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submitCreate() } }}
                    placeholder="e.g. 8-12"
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-sans)',
                      fontSize: '16px',
                      padding: '11px 12px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="swap-new-weight" style={{
                  fontSize: '10px', letterSpacing: 'var(--tracking-label)',
                  color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500,
                }}>
                  Default weight ({unitLabel}) — optional
                </label>
                <input
                  id="swap-new-weight"
                  type="number"
                  inputMode="decimal"
                  value={formWeight}
                  onChange={e => { setFormWeight(e.target.value); if (error) setError('') }}
                  onFocus={e => e.target.select()}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submitCreate() } }}
                  placeholder="Prefills a fresh set"
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--surface-elevated)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '16px',
                    padding: '11px 12px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Added to your <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{day.replace(/-/g, ' ')}</span> day
                {intent === 'add' ? ' and appended to this workout.' : ' and swapped in for this workout.'}
              </div>
            </div>
            </div>
            <div className="grind-sheet__footer">
              {error && (
                <div role="alert" style={{ fontSize: '13px', color: 'var(--danger)', marginBottom: '10px' }}>
                  {error}
                </div>
              )}
              <button
                type="button"
                className="press"
                data-haptic="medium"
                onClick={submitCreate}
                disabled={saving}
                style={{
                  position: 'relative',
                  width: '100%', height: '52px',
                  backgroundColor: 'var(--accent)', color: 'var(--on-accent)',
                  border: 'none', borderRadius: 'var(--radius-md)',
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: '20px', letterSpacing: '1px',
                  cursor: saving ? 'default' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                  transition: 'opacity 150ms ease',
                }}
              >
                {saving ? 'CREATING…' : intent === 'add' ? 'CREATE & ADD' : 'CREATE & SWAP IN'}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
