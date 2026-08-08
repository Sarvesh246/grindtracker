'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Exercise, DayCategory, UserRotation } from '@/lib/types'
import { autoSequence, effectiveSequence, orderedDayKeys } from '@/lib/utils/rotation'
import { useKeyboardInset } from '@/lib/hooks/useKeyboardInset'
import { useToast } from '@/lib/contexts/ToastContext'
import { useUnit } from '@/lib/contexts/UnitContext'

interface WorkoutManagerProps {
  onClose: () => void
  onChanged: () => void
  /** Open straight into the "new day" form (used by first-run entry points). */
  initialNewDay?: boolean
}

type Screen =
  | { id: 'days' }
  | { id: 'day'; dayKey: string }
  | { id: 'exercise-form'; dayKey: string; exercise?: Exercise }
  | { id: 'setup-choice' }
  | { id: 'new-day' }
  | { id: 'category-picker'; dayKey: string }
  | { id: 'rotation' }

type DeleteTarget =
  | { type: 'day'; key: string; label: string }
  | { type: 'exercise'; id: string; name: string; dayKey: string }

/** The blank-slate "Use Push / Pull / Legs" option — a fully worked 3-day split
 *  a new user can start training immediately, editable afterward like any other
 *  day. `active: false` marks an optional variant pre-disabled (kept for history
 *  if the user ever turns it on), matching the per-day active flag elsewhere. */
const PPL_TEMPLATE: Record<string, { category: DayCategory; exercises: { name: string; sets: number; reps: string; active?: boolean }[] }> = {
  push: {
    category: 'push',
    exercises: [
      { name: 'Barbell Bench Press', sets: 4, reps: '6-8' },
      { name: 'Incline Dumbbell Press', sets: 3, reps: '8-10' },
      { name: 'Overhead Press', sets: 3, reps: '8-10' },
      { name: 'Cable Lateral Raises', sets: 3, reps: '12-15' },
      { name: 'Tricep Rope Pushdown', sets: 3, reps: '12' },
    ],
  },
  pull: {
    category: 'pull',
    exercises: [
      { name: 'Chest-Supported Dumbbell Row', sets: 4, reps: '8-10' },
      { name: 'Pull-Ups', sets: 4, reps: '6-10', active: false },
      { name: 'Barbell or Cable Row', sets: 3, reps: '8-10' },
      { name: 'Lat Pulldown', sets: 3, reps: '10-12' },
      { name: 'Face Pulls', sets: 3, reps: '15' },
      { name: 'Dumbbell Curl', sets: 3, reps: '10-12' },
    ],
  },
  legs: {
    category: 'legs',
    exercises: [
      { name: 'Barbell Squat', sets: 4, reps: '6-8' },
      { name: 'Dumbbell RDL', sets: 3, reps: '8-10' },
      { name: 'Leg Press', sets: 3, reps: '10-12' },
      { name: 'Walking Lunges', sets: 3, reps: '10 each' },
      { name: 'Leg Curl', sets: 3, reps: '12' },
      { name: 'Calf Raises', sets: 4, reps: '15-20' },
    ],
  },
}

export default function WorkoutManager({ onClose, onChanged, initialNewDay = false }: WorkoutManagerProps) {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  // Height hidden behind the iOS keyboard, so the bottom-sheet can ride above it
  // instead of leaving the day-name / exercise-form inputs pinned underneath.
  const keyboardInset = useKeyboardInset()
  const { unitLabel, fmt, fromDisplay } = useUnit()
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [dayCategories, setDayCategories] = useState<Record<string, DayCategory>>({})
  const [flexDays, setFlexDays] = useState<Set<string>>(new Set())
  const [rotation, setRotation] = useState<UserRotation | null>(null)
  const [rotationError, setRotationError] = useState('')
  const [savingRotation, setSavingRotation] = useState(false)
  const [addingSlot, setAddingSlot] = useState(false)
  const [loading, setLoading] = useState(true)
  const [screen, setScreen] = useState<Screen>(initialNewDay ? { id: 'setup-choice' } : { id: 'days' })
  const [saving, setSaving] = useState(false)
  const [savingCategory, setSavingCategory] = useState(false)
  const [categoryError, setCategoryError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [applyingTemplate, setApplyingTemplate] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const [movingExerciseId, setMovingExerciseId] = useState<string | null>(null)

  // new-day form
  const [newDayInput, setNewDayInput] = useState('')
  // exercise form
  const [formName, setFormName] = useState('')
  const [formSets, setFormSets] = useState('3')
  const [formReps, setFormReps] = useState('8')
  // Optional — the weight to prefill a fresh set with (docs/sql/25). Empty
  // string means "no target set", not zero.
  const [formWeight, setFormWeight] = useState('')
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      setUserId(user?.id ?? null)
      const [exRes, catRes, flexRes, rotRes] = await Promise.all([
        supabase.from('exercises').select('*')
          .order('day_type', { ascending: true })
          .order('sort_order', { ascending: true }),
        user
          ? supabase.from('user_day_categories').select('day_key, category').eq('user_id', user.id)
          : Promise.resolve({ data: [] as { day_key: string; category: string }[] }),
        user
          ? supabase.from('user_flex_days').select('day_key').eq('user_id', user.id)
          : Promise.resolve({ data: [] as { day_key: string }[] }),
        user
          ? supabase.from('user_rotation').select('*').eq('user_id', user.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      setExercises(exRes.data ?? [])
      const map: Record<string, DayCategory> = {}
      for (const r of (catRes.data ?? [])) map[r.day_key] = r.category as DayCategory
      setDayCategories(map)
      setFlexDays(new Set((flexRes.data ?? []).map(r => r.day_key)))
      setRotation((rotRes.data as UserRotation | null) ?? null)
    } catch {
      // Network/auth failure — keep whatever we have rather than wedging the UI.
      // The spinner is cleared in finally so the modal stays usable.
    } finally {
      setLoading(false)
    }
  }, [supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const grouped: Record<string, Exercise[]> = {}
  for (const ex of exercises) {
    if (!grouped[ex.day_type]) grouped[ex.day_type] = []
    grouped[ex.day_type].push(ex)
  }
  // Keep each day's exercises in sort_order, not fetch-array order — moveExercise
  // below swaps sort_order values in place, and this re-sort is what makes that
  // swap show up immediately instead of only after the next reload.
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => a.sort_order - b.sort_order)
  }
  // Displayed in the user's chosen "workout order" (see the rotation section
  // below), not alphabetically — otherwise a manual order is invisible outside
  // the rotation editor itself, including here and on the log day-select grid.
  const effectiveSeq = effectiveSequence(rotation, Object.keys(grouped), flexDays)
  const dayKeys = orderedDayKeys(Object.keys(grouped), effectiveSeq)

  function openExerciseForm(dayKey: string, exercise?: Exercise) {
    setFormName(exercise?.name ?? '')
    setFormSets(String(exercise?.sets_target ?? 3))
    setFormReps(String(exercise?.reps_target ?? '8'))
    setFormWeight(exercise?.weight_target != null ? fmt(exercise.weight_target) : '')
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
    let weightTarget: number | null = null
    if (formWeight.trim()) {
      const parsed = parseFloat(formWeight)
      if (!Number.isFinite(parsed) || parsed < 0) { setFormError('Default weight must be a positive number.'); return }
      weightTarget = fromDisplay(parsed)
    }

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
      // Exercises are per-user (RLS-owned); stamp the owner on insert. Updates are
      // already constrained to the user's own rows by the RLS policy.
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setFormError('You are signed out. Sign in and try again.'); setSaving(false); return }

      const { error } = exercise
        ? await supabase.from('exercises').update({
            name: trimmedName,
            sets_target: sets,
            reps_target: formReps.trim(),
            weight_target: weightTarget,
          }).eq('id', exercise.id)
        : await supabase.from('exercises').insert({
            user_id: user.id,
            name: trimmedName,
            day_type: dayKey,
            sets_target: sets,
            reps_target: formReps.trim(),
            weight_target: weightTarget,
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
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setDeleteError('Session expired. Sign in again and retry.')
        return
      }

      const { error } = deleteTarget.type === 'day'
        // Scope the day-wide delete to the owner explicitly. RLS ("own
        // exercises") already constrains this, but a delete whose only filter
        // is `day_type` is one policy regression away from wiping every user's
        // "push" day. Defense in depth: never send an unscoped destructive
        // filter over the wire.
        ? await supabase.from('exercises').delete().eq('user_id', user.id).eq('day_type', deleteTarget.key)
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
    // Go straight to adding exercises. The leaderboard category is deferred —
    // it's a concept a brand-new user hasn't met yet, so forcing it before the
    // very first exercise front-loads friction. It's set later, non-blocking,
    // via the "leaderboard category" row on the day screen and the amber nudge
    // on the days list. Until then the day still counts toward Overall XP; it
    // just doesn't map to a push/pull/legs tab.
    openExerciseForm(key)
  }

  // Blank-slate shortcut: bulk-create the Push/Pull/Legs split (PPL_TEMPLATE)
  // instead of building days one exercise at a time. Also sets each day's
  // leaderboard category and a manual push→pull→legs rotation — the auto
  // rotation would otherwise sort those three keys alphabetically (legs,
  // pull, push), which isn't the order anyone trains a PPL split in.
  async function applyTemplate() {
    if (applyingTemplate) return
    setApplyingTemplate(true)
    setTemplateError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setTemplateError('You are signed out. Sign in and try again.'); return }

      const exerciseRows = Object.entries(PPL_TEMPLATE).flatMap(([dayKey, day]) =>
        day.exercises.map((ex, i) => ({
          user_id: user.id,
          name: ex.name,
          day_type: dayKey,
          sets_target: ex.sets,
          reps_target: ex.reps,
          sort_order: i + 1,
          active: ex.active ?? true,
        }))
      )
      const categoryRows = Object.entries(PPL_TEMPLATE).map(([dayKey, day]) => ({
        user_id: user.id, day_key: dayKey, category: day.category,
      }))

      const [{ error: exError }, { error: catError }, { error: rotError }] = await Promise.all([
        supabase.from('exercises').insert(exerciseRows),
        supabase.from('user_day_categories').upsert(categoryRows, { onConflict: 'user_id,day_key' }),
        supabase.from('user_rotation').upsert(
          { user_id: user.id, mode: 'manual', sequence: ['push', 'pull', 'legs'], current_index: 0, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        ),
      ])

      if (exError || catError || rotError) {
        setTemplateError('Could not set up your template. Check your connection and try again.')
        return
      }

      await load()
      onChanged()
      toast.show('Push / Pull / Legs added')
      onClose()
    } catch {
      setTemplateError('Could not set up your template. Check your connection and try again.')
    } finally {
      setApplyingTemplate(false)
    }
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

  async function toggleFlex(dayKey: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const isFlex = flexDays.has(dayKey)
    if (isFlex) {
      await supabase.from('user_flex_days').delete().eq('user_id', user.id).eq('day_key', dayKey)
      setFlexDays(prev => { const next = new Set(prev); next.delete(dayKey); return next })
    } else {
      await supabase.from('user_flex_days').insert({ user_id: user.id, day_key: dayKey })
      setFlexDays(prev => new Set([...prev, dayKey]))
    }
    onChanged()
  }

  const [togglingExerciseId, setTogglingExerciseId] = useState<string | null>(null)

  // Disable/re-enable an exercise for its day (see 17-exercise-active-flag.sql)
  // without deleting it — keeps its logged history and PR bar intact.
  // Optimistic with revert-on-failure, matching the rest-day toggle pattern.
  async function toggleExerciseActive(ex: Exercise) {
    if (togglingExerciseId !== null) return
    const nextActive = !ex.active
    setTogglingExerciseId(ex.id)
    setExercises(prev => prev.map(e => e.id === ex.id ? { ...e, active: nextActive } : e))

    const { error } = await supabase.from('exercises').update({ active: nextActive }).eq('id', ex.id)

    setTogglingExerciseId(null)
    if (error) {
      setExercises(prev => prev.map(e => e.id === ex.id ? { ...e, active: !nextActive } : e))
      toast.show("Couldn't save exercise", 'error')
      return
    }
    toast.show(nextActive ? 'Exercise enabled' : 'Exercise disabled')
    onChanged()
  }

  // Reorder an exercise within its day by swapping sort_order with its
  // neighbor. Optimistic — the swap shows immediately (grouped[] above
  // re-sorts by sort_order every render, so mutating the field alone is
  // enough) — with revert-on-failure and a save-confirmation toast, matching
  // the rotation reorder pattern above.
  async function moveExercise(dayKey: string, index: number, dir: -1 | 1) {
    if (movingExerciseId !== null) return
    const list = grouped[dayKey] ?? []
    const target = index + dir
    if (target < 0 || target >= list.length) return
    const a = list[index]
    const b = list[target]
    const aOrder = a.sort_order
    const bOrder = b.sort_order

    setMovingExerciseId(a.id)
    setExercises(prev => prev.map(e => {
      if (e.id === a.id) return { ...e, sort_order: bOrder }
      if (e.id === b.id) return { ...e, sort_order: aOrder }
      return e
    }))

    const [{ error: err1 }, { error: err2 }] = await Promise.all([
      supabase.from('exercises').update({ sort_order: bOrder }).eq('id', a.id),
      supabase.from('exercises').update({ sort_order: aOrder }).eq('id', b.id),
    ])

    setMovingExerciseId(null)
    if (err1 || err2) {
      setExercises(prev => prev.map(e => {
        if (e.id === a.id) return { ...e, sort_order: aOrder }
        if (e.id === b.id) return { ...e, sort_order: bOrder }
        return e
      }))
      toast.show("Couldn't reorder", 'error')
      return
    }
    toast.show('Order saved')
    onChanged()
  }

  // ── Rotation (workout order) ───────────────────────────────────────────────
  // Persist the rotation row and keep local state in sync. Sequence + mode are
  // the source of truth in manual mode; current_index is left untouched here
  // (the read path wraps it with modulo, so a stale value is harmless).
  //
  // Optimistic: local state (and therefore the day order everywhere it's
  // derived — this screen's day list, DaySelect's grid) updates immediately so
  // a reorder feels instant, with the network write following in the
  // background. A success toast is the only "saved" signal in this flow —
  // there's no dedicated save button — so it has to fire here, and a failure
  // reverts the optimistic change rather than leaving the UI showing an order
  // that didn't actually persist.
  async function persistRotation(mode: 'auto' | 'manual', sequence: string[]) {
    if (!userId) { setRotationError('You must be signed in.'); return }
    setRotationError('')
    const previous = rotation
    const updatedAt = new Date().toISOString()
    setRotation({ user_id: userId, mode, sequence, current_index: previous?.current_index ?? 0, updated_at: updatedAt })
    setSavingRotation(true)
    try {
      const { error } = await supabase.from('user_rotation').upsert(
        { user_id: userId, mode, sequence, current_index: previous?.current_index ?? 0, updated_at: updatedAt },
        { onConflict: 'user_id' },
      )
      if (error) {
        setRotation(previous)
        setRotationError('Could not save. Check your connection and try again.')
        toast.show("Couldn't save order", 'error')
        return
      }
      toast.show('Order saved')
    } catch {
      setRotation(previous)
      setRotationError('Could not save. Check your connection and try again.')
      toast.show("Couldn't save order", 'error')
    } finally {
      setSavingRotation(false)
    }
  }

  // effectiveSeq (above) is also what seeds the manual editor and auto chips.
  const isManual = rotation?.mode === 'manual'
  const manualSeq = isManual ? effectiveSeq : []

  function customizeOrder() {
    setAddingSlot(false)
    persistRotation('manual', autoSequence(dayKeys, flexDays))
  }
  function resetToAuto() {
    setAddingSlot(false)
    persistRotation('auto', rotation?.sequence ?? [])
  }
  function moveSlot(index: number, dir: -1 | 1) {
    const next = [...manualSeq]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    persistRotation('manual', next)
  }
  function removeSlot(index: number) {
    persistRotation('manual', manualSeq.filter((_, i) => i !== index))
  }
  function addSlot(dayKey: string) {
    setAddingSlot(false)
    persistRotation('manual', [...manualSeq, dayKey])
  }

  function goBack() {
    if (screen.id === 'days' || screen.id === 'setup-choice') {
      onClose()
    } else if (screen.id === 'new-day') {
      // Reachable from the days list ("ADD NEW DAY") or from setup-choice
      // ("Build my own") — the latter only when there are no days yet, since
      // setup-choice itself only shows on the blank slate.
      setScreen(dayKeys.length === 0 ? { id: 'setup-choice' } : { id: 'days' })
    } else if (screen.id === 'category-picker') {
      // The picker is now reached from the day screen (or the days-list nudge),
      // never as a forced step before the first exercise — so return to the day
      // when it exists, falling back to the list otherwise.
      setScreen(grouped[screen.dayKey] ? { id: 'day', dayKey: screen.dayKey } : { id: 'days' })
    } else if (screen.id === 'day') {
      setScreen({ id: 'days' })
    } else if (screen.id === 'exercise-form') {
      const dayKey = screen.dayKey
      const dayExists = !!grouped[dayKey]
      setScreen(dayExists ? { id: 'day', dayKey } : { id: 'days' })
    } else if (screen.id === 'rotation') {
      setAddingSlot(false)
      setScreen({ id: 'days' })
    }
  }

  const title =
    screen.id === 'days' ? 'MANAGE WORKOUTS' :
    screen.id === 'setup-choice' ? 'GET STARTED' :
    screen.id === 'new-day' ? 'NEW DAY' :
    screen.id === 'category-picker' ? 'SELECT CATEGORY' :
    screen.id === 'rotation' ? 'WORKOUT ORDER' :
    screen.id === 'day' ? screen.dayKey.replace(/-/g, ' ').toUpperCase() :
    screen.exercise ? 'EDIT EXERCISE' : 'ADD EXERCISE'

  return (
    <>
      {/* Backdrop */}
      <div
        className="wm-backdrop"
        onClick={onClose}
        style={keyboardInset > 0 ? { paddingBottom: keyboardInset, transition: 'padding-bottom 180ms ease' } : undefined}
      >
        {/* Sheet — cap its height to what's left above the keyboard so the whole
            form stays reachable; the backdrop padding lifts it clear. */}
        <div
          className="wm-sheet"
          onClick={e => e.stopPropagation()}
          style={keyboardInset > 0 ? { maxHeight: `calc(92dvh - ${keyboardInset}px)` } : undefined}
        >
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                              <span style={{
                                fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px',
                                color: 'var(--text-primary)', letterSpacing: '1px',
                              }}>
                                {key.replace(/-/g, ' ').toUpperCase()}
                              </span>
                              {flexDays.has(key) && (
                                <span style={{
                                  fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
                                  color: 'var(--text-secondary)',
                                  backgroundColor: 'var(--surface-elevated)',
                                  border: '1px solid var(--border)',
                                  padding: '2px 6px', borderRadius: '9999px',
                                  fontFamily: "'DM Sans', sans-serif",
                                }}>
                                  FLEX
                                </span>
                              )}
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
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
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
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  <span style={{
                    fontFamily: "'DM Sans', sans-serif", fontSize: '15px',
                    fontWeight: 600, color: 'var(--accent-text)',
                  }}>
                    ADD NEW DAY
                  </span>
                </button>

                {/* Advanced: edit the suggested workout order. Kept low-key —
                    the default auto rotation needs no attention. */}
                {dayKeys.length > 0 && (
                  <button
                    onClick={() => { setRotationError(''); setAddingSlot(false); setScreen({ id: 'rotation' }) }}
                    style={{
                      width: '100%', textAlign: 'left',
                      background: 'none', border: 'none',
                      borderTop: '1px solid var(--border)',
                      padding: '16px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '10px',
                    }}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                      <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="10" y2="18"/>
                    </svg>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Edit workout order
                    </span>
                    {isManual && (
                      <span style={{
                        marginLeft: 'auto', fontSize: '10px', fontWeight: 700,
                        color: 'var(--accent)', letterSpacing: '0.5px',
                        backgroundColor: 'rgba(200,241,53,0.12)',
                        padding: '2px 7px', borderRadius: '9999px',
                      }}>
                        CUSTOM
                      </span>
                    )}
                  </button>
                )}
              </>
            )}

            {/* ── Rotation (Workout Order) ── */}
            {screen.id === 'rotation' && (
              <div style={{ padding: '20px 16px' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5, marginBottom: '18px' }}>
                  Your workout order. After each session, GRIND suggests the next day in this loop — a day can appear more than once (e.g. abs after every other day).
                </div>

                {!isManual ? (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
                      {effectiveSeq.length === 0 ? (
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
                          Add a workout day to set up your order.
                        </div>
                      ) : effectiveSeq.map((key, i) => (
                        <span key={i} style={{
                          fontFamily: "'Bebas Neue', sans-serif", fontSize: '15px',
                          letterSpacing: '0.5px', color: 'var(--text-primary)',
                          backgroundColor: 'var(--surface-elevated)',
                          border: '1px solid var(--border)', borderRadius: '8px',
                          padding: '6px 12px',
                        }}>
                          {key.replace(/-/g, ' ').toUpperCase()}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", marginBottom: '14px' }}>
                      Automatic — every day once, in order. Want abs twice or a custom loop?
                    </div>
                    <button
                      onClick={customizeOrder}
                      disabled={savingRotation || effectiveSeq.length === 0}
                      style={{
                        width: '100%', height: '48px',
                        backgroundColor: (savingRotation || effectiveSeq.length === 0) ? 'var(--border)' : 'var(--accent)',
                        color: (savingRotation || effectiveSeq.length === 0) ? 'var(--text-muted)' : 'var(--bg)',
                        border: 'none', borderRadius: '10px',
                        fontFamily: "'Bebas Neue', sans-serif", fontSize: '18px',
                        letterSpacing: '1px', cursor: (savingRotation || effectiveSeq.length === 0) ? 'default' : 'pointer',
                      }}
                    >
                      CUSTOMIZE ORDER
                    </button>
                  </>
                ) : (
                  <>
                    {manualSeq.length === 0 ? (
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", marginBottom: '14px' }}>
                        No slots yet. Add one below.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                        {manualSeq.map((key, i) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            backgroundColor: 'var(--surface-elevated)',
                            border: '1px solid var(--border)', borderRadius: '10px',
                            padding: '10px 12px',
                          }}>
                            <span style={{
                              fontFamily: "'JetBrains Mono', monospace", fontSize: '12px',
                              color: 'var(--text-muted)', width: '20px', textAlign: 'center', flexShrink: 0,
                            }}>
                              {i + 1}
                            </span>
                            <span style={{
                              flex: 1, fontFamily: "'Bebas Neue', sans-serif", fontSize: '18px',
                              letterSpacing: '0.5px', color: 'var(--text-primary)',
                            }}>
                              {key.replace(/-/g, ' ').toUpperCase()}
                            </span>
                            <button
                              onClick={() => moveSlot(i, -1)}
                              disabled={savingRotation || i === 0}
                              aria-label="Move up"
                              style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', padding: '6px', opacity: i === 0 ? 0.25 : 0.7, display: 'flex' }}
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                                <polyline points="18 15 12 9 6 15" />
                              </svg>
                            </button>
                            <button
                              onClick={() => moveSlot(i, 1)}
                              disabled={savingRotation || i === manualSeq.length - 1}
                              aria-label="Move down"
                              style={{ background: 'none', border: 'none', cursor: i === manualSeq.length - 1 ? 'default' : 'pointer', padding: '6px', opacity: i === manualSeq.length - 1 ? 0.25 : 0.7, display: 'flex' }}
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>
                            <button
                              onClick={() => removeSlot(i)}
                              disabled={savingRotation}
                              aria-label="Remove slot"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', opacity: 0.5, display: 'flex' }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--danger)' }}>
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add slot */}
                    {addingSlot ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Add a day to the loop
                        </div>
                        {dayKeys.map(key => (
                          <button
                            key={key}
                            onClick={() => addSlot(key)}
                            disabled={savingRotation}
                            style={{
                              width: '100%', textAlign: 'left',
                              backgroundColor: 'var(--surface-elevated)',
                              border: '1px solid var(--border)', borderRadius: '8px',
                              padding: '12px 14px', cursor: 'pointer',
                              fontFamily: "'Bebas Neue', sans-serif", fontSize: '16px',
                              letterSpacing: '0.5px', color: 'var(--text-primary)',
                            }}
                          >
                            {key.replace(/-/g, ' ').toUpperCase()}
                          </button>
                        ))}
                        <button
                          onClick={() => setAddingSlot(false)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px', fontFamily: "'DM Sans', sans-serif", fontSize: '13px', color: 'var(--text-muted)' }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingSlot(true)}
                        disabled={savingRotation}
                        style={{
                          width: '100%', padding: '14px',
                          background: 'none', border: '1px dashed var(--border-strong)',
                          borderRadius: '10px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                          marginBottom: '14px',
                        }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', fontWeight: 600, color: 'var(--accent)' }}>
                          Add slot
                        </span>
                      </button>
                    )}

                    <button
                      onClick={resetToAuto}
                      disabled={savingRotation}
                      style={{
                        width: '100%', height: '44px', background: 'none',
                        border: 'none', cursor: 'pointer',
                        fontFamily: "'DM Sans', sans-serif", fontSize: '13px',
                        color: 'var(--text-muted)', textDecoration: 'underline',
                        textUnderlineOffset: '3px',
                      }}
                    >
                      Reset to automatic
                    </button>
                  </>
                )}

                {rotationError && (
                  <div style={{ marginTop: '14px', fontSize: '13px', color: 'var(--danger)', fontFamily: "'DM Sans', sans-serif" }}>
                    {rotationError}
                  </div>
                )}
              </div>
            )}

            {/* ── Setup Choice (blank slate) ── */}
            {screen.id === 'setup-choice' && (
              <div style={{ padding: '20px 16px' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", marginBottom: '18px', lineHeight: 1.5 }}>
                  Start with a ready-made split, or build your own days and exercises from scratch.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button
                    className="press"
                    onClick={applyTemplate}
                    disabled={applyingTemplate}
                    style={{
                      width: '100%', textAlign: 'left',
                      backgroundColor: 'var(--accent-wash)',
                      border: '1px solid var(--accent)', borderRadius: '10px',
                      padding: '16px',
                      cursor: applyingTemplate ? 'default' : 'pointer',
                      opacity: applyingTemplate ? 0.7 : 1,
                      display: 'flex', flexDirection: 'column', gap: '4px',
                    }}
                  >
                    <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px', color: 'var(--accent-text)', letterSpacing: '1px' }}>
                      {applyingTemplate ? 'SETTING UP...' : 'USE PUSH / PULL / LEGS'}
                    </span>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: 'var(--text-secondary)' }}>
                      A proven 3-day split, pre-loaded with exercises, sets &amp; reps. Edit anything after.
                    </span>
                  </button>
                  <button
                    className="press"
                    onClick={() => setScreen({ id: 'new-day' })}
                    disabled={applyingTemplate}
                    style={{
                      width: '100%', textAlign: 'left',
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border)', borderRadius: '10px',
                      padding: '16px',
                      cursor: applyingTemplate ? 'default' : 'pointer',
                      opacity: applyingTemplate ? 0.7 : 1,
                      display: 'flex', flexDirection: 'column', gap: '4px',
                    }}
                  >
                    <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px', color: 'var(--text-primary)', letterSpacing: '1px' }}>
                      BUILD MY OWN
                    </span>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: 'var(--text-muted)' }}>
                      Create your own days and add exercises one at a time.
                    </span>
                  </button>
                </div>
                {templateError && (
                  <div style={{ marginTop: '14px', fontSize: '13px', color: 'var(--danger)', fontFamily: "'DM Sans', sans-serif" }}>
                    {templateError}
                  </div>
                )}
              </div>
            )}

            {/* ── New Day ── */}
            {screen.id === 'new-day' && (
              <div style={{ padding: '20px 16px' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", marginBottom: '8px' }}>
                  Day name (e.g. &ldquo;Abs&rdquo;, &ldquo;Cardio&rdquo;, &ldquo;Upper Body&rdquo;)
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
                    color: newDayInput.trim() ? 'var(--on-accent)' : 'var(--text-muted)',
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
                      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px', color: 'var(--accent-text)', letterSpacing: '1px' }}>
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
                    exs.map((ex, idx) => (
                      <div
                        key={ex.id}
                        style={{
                          display: 'flex', alignItems: 'center',
                          padding: '14px 16px', gap: '10px',
                          borderBottom: '1px solid var(--border)',
                          opacity: ex.active ? 1 : 0.55,
                          transition: 'opacity 150ms ease',
                        }}
                      >
                        {/* Reorder within the day — swaps sort_order with the
                            neighbor above/below. Same chevron language as the
                            workout-order editor below. */}
                        <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                          <button
                            className="press"
                            onClick={() => moveExercise(dayKey, idx, -1)}
                            disabled={movingExerciseId !== null || idx === 0}
                            aria-label={`Move ${ex.name} up`}
                            style={{
                              background: 'none', border: 'none', padding: '4px',
                              cursor: (movingExerciseId !== null || idx === 0) ? 'default' : 'pointer',
                              opacity: idx === 0 ? 0.25 : 0.7, display: 'flex',
                            }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                              <polyline points="18 15 12 9 6 15" />
                            </svg>
                          </button>
                          <button
                            className="press"
                            onClick={() => moveExercise(dayKey, idx, 1)}
                            disabled={movingExerciseId !== null || idx === exs.length - 1}
                            aria-label={`Move ${ex.name} down`}
                            style={{
                              background: 'none', border: 'none', padding: '4px',
                              cursor: (movingExerciseId !== null || idx === exs.length - 1) ? 'default' : 'pointer',
                              opacity: idx === exs.length - 1 ? 0.25 : 0.7, display: 'flex',
                            }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {ex.name}
                            </span>
                            {!ex.active && (
                              <span style={{
                                fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
                                color: 'var(--text-secondary)',
                                backgroundColor: 'var(--surface-elevated)',
                                border: '1px solid var(--border)',
                                padding: '2px 6px', borderRadius: '9999px',
                                fontFamily: "'DM Sans', sans-serif",
                              }}>
                                OFF
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
                            {ex.sets_target} sets × {ex.reps_target} reps
                            {ex.weight_target != null && ` @ ${fmt(ex.weight_target)} ${unitLabel}`}
                          </div>
                        </div>
                        {/* Active toggle — disables the exercise for this day without
                            deleting it (keeps history/PR bar), so it stops showing up
                            in a new live workout or past-log entry until re-enabled. */}
                        <button
                          onClick={() => toggleExerciseActive(ex)}
                          disabled={togglingExerciseId !== null}
                          aria-label={ex.active ? `Disable ${ex.name} for this day` : `Enable ${ex.name} for this day`}
                          title={ex.active ? 'Disable for this day' : 'Enable for this day'}
                          style={{
                            background: 'none', border: 'none', padding: 0, flexShrink: 0,
                            cursor: togglingExerciseId !== null ? 'default' : 'pointer',
                            width: '38px', height: '22px', borderRadius: '9999px',
                            backgroundColor: ex.active ? 'var(--accent)' : 'var(--border)',
                            position: 'relative', transition: 'background-color 150ms ease',
                          }}
                        >
                          <span style={{
                            position: 'absolute', top: '3px',
                            left: ex.active ? '19px' : '3px',
                            width: '16px', height: '16px', borderRadius: '50%',
                            backgroundColor: ex.active ? 'var(--bg)' : 'var(--text-muted)',
                            transition: 'left 150ms ease',
                          }} />
                        </button>
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
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
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
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    <span style={{
                      fontFamily: "'DM Sans', sans-serif", fontSize: '15px',
                      fontWeight: 600, color: 'var(--accent-text)',
                    }}>
                      ADD EXERCISE
                    </span>
                  </button>

                  {/* Leaderboard category — deferred, not forced. Shows the
                      current mapping (or an amber "not set" prompt) and opens
                      the picker on tap. Set once, it decides which competitive
                      tab this day feeds. */}
                  <button
                    onClick={() => { setCategoryError(''); setScreen({ id: 'category-picker', dayKey }) }}
                    style={{
                      width: '100%', textAlign: 'left',
                      background: 'none', border: 'none',
                      padding: '16px',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                    }}
                  >
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                        Leaderboard category
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: dayCategories[dayKey] ? 'var(--text-muted)' : '#F59E0B' }}>
                        {dayCategories[dayKey]
                          ? `Counts toward ${dayCategories[dayKey]!.toUpperCase()}`
                          : 'Not set — tap to choose (optional)'}
                      </div>
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>

                  {/* Flex day toggle */}
                  <button
                    onClick={() => toggleFlex(dayKey)}
                    style={{
                      width: '100%', textAlign: 'left',
                      background: 'none', border: 'none',
                      padding: '16px',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                        Flex day
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: 'var(--text-muted)' }}>
                        Skip in rotation — do it whenever you want
                      </div>
                    </div>
                    {/* Toggle pill */}
                    <div style={{
                      width: '44px', height: '26px', borderRadius: '9999px', flexShrink: 0,
                      backgroundColor: flexDays.has(dayKey) ? 'var(--accent)' : 'var(--border)',
                      position: 'relative', transition: 'background-color 150ms ease',
                    }}>
                      <div style={{
                        position: 'absolute', top: '3px',
                        left: flexDays.has(dayKey) ? '21px' : '3px',
                        width: '20px', height: '20px', borderRadius: '50%',
                        backgroundColor: flexDays.has(dayKey) ? 'var(--bg)' : 'var(--text-muted)',
                        transition: 'left 150ms ease',
                      }} />
                    </div>
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

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif", marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Default Weight ({unitLabel}) — optional
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={formWeight}
                    onChange={e => setFormWeight(e.target.value)}
                    onFocus={e => e.target.select()}
                    placeholder="Prefills a fresh set, e.g. 135"
                    style={{
                      width: '100%', height: '48px',
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border-strong)', borderRadius: '8px',
                      color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '18px', padding: '0 14px',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", marginTop: '6px', lineHeight: 1.4 }}>
                    A fresh set starts with this weight instead of blank. Leave empty to fall back to what you lifted last session.
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
                    color: saving ? 'var(--text-muted)' : 'var(--on-accent)',
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
