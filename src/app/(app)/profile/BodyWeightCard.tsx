'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { useUnit, LBS_PER_KG } from '@/lib/contexts/UnitContext'
import { useToast } from '@/lib/contexts/ToastContext'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { demoSafeClient } from '@/lib/demoMode/demoSafeSupabase'
import { demoBodyWeightRows } from '@/lib/demoMode/fakeData'
import Dialog from '@/components/ui/Dialog'
import { CACHE_KEYS, getCached, isFresh, markAppDataStale, setCached } from '@/lib/cache/appDataCache'
import { reportError } from '@/lib/utils/reportError'
import type { BodyWeightPoint } from './BodyWeightChart'

const BodyWeightChart = dynamic(() => import('./BodyWeightChart'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '120px', width: '100%' }} aria-hidden="true" />
  ),
})

interface Row {
  weight: number
  recorded_at: string
}

type Point = BodyWeightPoint

function todayDateKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function BodyWeightCard() {
  const { demoMode } = useDemoMode()
  // Writes (save/update/delete) become local no-ops in Demo Mode — see
  // src/lib/demoMode/demoSafeSupabase.ts — and load() below sources a fake
  // 90-day trend instead of the real body_weights table.
  const supabase = demoMode ? demoSafeClient(createClient()) : createClient()
  const { unitLabel, toDisplay, fromDisplay, fmt } = useUnit()
  const toast = useToast()
  const [rows, setRows] = useState<Row[]>([])
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  // The entry currently open in the edit sheet — picked by tapping its dot on
  // the chart or its row in the history list.
  const [selected, setSelected] = useState<Point | null>(null)
  // First tap on a dot just reveals its value inline (nothing about a plotted
  // point reads as tappable on its own, so this doubles as a confirmation);
  // tapping the SAME, already-peeked dot again is what opens the edit sheet.
  const [peeked, setPeeked] = useState<string | null>(null)
  // Keep peek in a ref so chart/dot handlers always see the latest value even
  // if Recharts reuses a stale closure from a previous render.
  const peekedRef = useRef<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)

  // History is collapsed by default: after months of daily logging the full
  // list dwarfs the rest of the card, and the chart already carries the trend.
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode])

  // Drafts are display-unit strings. On unit toggle, re-express any open draft
  // from its canonical lbs so save doesn't interpret "80" kg as 80 lbs.
  const prevUnitRef = useRef(unitLabel)
  useEffect(() => {
    if (prevUnitRef.current === unitLabel) return
    const wasMetric = prevUnitRef.current === 'kg'
    prevUnitRef.current = unitLabel
    const convertDraft = (raw: string) => {
      const n = parseFloat(raw)
      if (!Number.isFinite(n) || n <= 0) return raw
      // Interpret under the previous unit, then fmt under the new one.
      const canonical = wasMetric ? n * LBS_PER_KG : n
      return fmt(canonical)
    }
    setDraft(d => (d ? convertDraft(d) : d))
    setEditDraft(d => (d ? convertDraft(d) : d))
  }, [unitLabel, fmt])

  async function load() {
    if (demoMode) {
      setRows(demoBodyWeightRows())
      setLoading(false)
      return
    }

    const cached = getCached<Row[]>(CACHE_KEYS.bodyWeights)
    if (cached) {
      setRows(cached)
      setLoading(false)
      if (isFresh(CACHE_KEYS.bodyWeights)) return
    } else {
      setLoading(true)
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const since = new Date()
      since.setDate(since.getDate() - 90)
      const sinceKey = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`

      const { data, error } = await supabase
        .from('body_weights')
        .select('weight, recorded_at')
        .eq('user_id', user.id)
        .gte('recorded_at', sinceKey)
        .order('recorded_at', { ascending: true })

      if (error) {
        reportError(error, { operation: 'body-weight-load' })
        return
      }

      const next = (data ?? []) as Row[]
      setCached(CACHE_KEYS.bodyWeights, next)
      setRows(next)
    } catch (err) {
      reportError(err, { operation: 'body-weight-load' })
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    const w = parseFloat(draft)
    if (!Number.isFinite(w) || w <= 0 || saving) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    const { error } = await supabase.from('body_weights').upsert(
      { user_id: user.id, weight: fromDisplay(w), recorded_at: todayDateKey() },
      { onConflict: 'user_id,recorded_at' },
    )
    if (error) {
      setSaving(false)
      // Keep the draft so the user doesn't lose a typed value.
      toast.show('Could not save weight. Try again.', 'error')
      return
    }
    markAppDataStale()
    await load()
    setDraft('')
    setSaving(false)
    toast.show('Weight logged')
  }

  function openEntry(p: Point) {
    peekedRef.current = null
    setPeeked(null)
    setSelected(p)
    setEditDraft(fmt(p.canonical))
    setConfirmDelete(false)
  }

  function closeEntry() {
    if (busy) return
    setSelected(null)
    setEditDraft('')
    setConfirmDelete(false)
  }

  /** Chart tap: first tap peeks the value, a second tap on the same point opens it. */
  function handleDotClick(p: Point) {
    if (peekedRef.current === p.date) {
      openEntry(p)
    } else {
      peekedRef.current = p.date
      setPeeked(p.date)
    }
  }

  async function handleUpdate() {
    if (!selected || busy) return
    const w = parseFloat(editDraft)
    if (!Number.isFinite(w) || w <= 0) return
    setBusy('saving')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusy(null); return }

    const { error } = await supabase.from('body_weights').upsert(
      { user_id: user.id, weight: fromDisplay(w), recorded_at: selected.date },
      { onConflict: 'user_id,recorded_at' },
    )
    if (error) {
      setBusy(null)
      // Sheet stays open with the typed value intact so it can be retried.
      toast.show('Could not update weight. Try again.', 'error')
      return
    }
    markAppDataStale()
    await load()
    setBusy(null)
    setSelected(null)
    setEditDraft('')
    toast.show('Weight updated')
  }

  async function handleDelete() {
    if (!selected) return
    setBusy('deleting')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusy(null); return }

    const { error } = await supabase
      .from('body_weights')
      .delete()
      .eq('user_id', user.id)
      .eq('recorded_at', selected.date)

    if (error) {
      setBusy(null)
      setConfirmDelete(false)
      toast.show('Could not delete entry. Try again.', 'error')
      return
    }
    markAppDataStale()
    await load()
    setBusy(null)
    setSelected(null)
    setEditDraft('')
    setConfirmDelete(false)
    toast.show('Entry deleted')
  }

  const latest = rows.length > 0 ? rows[rows.length - 1] : null
  const earliest = rows.length > 0 ? rows[0] : null
  const change = latest && earliest && latest.recorded_at !== earliest.recorded_at
    ? toDisplay(latest.weight) - toDisplay(earliest.weight)
    : 0

  const chartPoints: Point[] = rows.map(r => {
    const d = new Date(r.recorded_at + 'T00:00:00')
    return {
      date: r.recorded_at,
      canonical: r.weight,
      displayDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      longDate: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      weight: toDisplay(r.weight),
    }
  })

  const pointsNewestFirst = [...chartPoints].reverse()

  return (
    <div
      data-onboard="profile-weight"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--card-md)',
        marginBottom: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '18px',
            color: 'var(--text-primary)',
            letterSpacing: '1px',
            fontWeight: 'normal',
          }}
        >
          BODY WEIGHT
        </h2>
        {latest && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '22px',
                color: 'var(--text-primary)',
              }}
            >
              {fmt(latest.weight)}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{unitLabel}</span>
            {change !== 0 && (
              <span
                style={{
                  fontSize: '11px',
                  color: change > 0 ? 'var(--accent-text)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {change > 0 ? '+' : ''}
                {change.toFixed(1)}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Log today"
          aria-label="Today's body weight"
          style={{
            flex: 1,
            minWidth: 0,
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '16px',
            padding: '10px 12px',
            height: '44px',
          }}
        />
        <button
          data-haptic="heavy"
          onClick={handleSave}
          disabled={saving || !draft}
          style={{
            position: 'relative',
            height: '44px',
            padding: '0 18px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            backgroundColor: saving || !draft ? 'var(--surface-elevated)' : 'var(--accent)',
            color: saving || !draft ? 'var(--text-muted)' : 'var(--on-accent)',
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            fontWeight: 700,
            letterSpacing: '0.5px',
            cursor: saving || !draft ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? '...' : 'LOG'}
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Loading...</div>
      ) : chartPoints.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '12px 0' }}>
          No body weight data yet. Log your first reading above.
        </div>
      ) : (
        <>
          <BodyWeightChart
            chartPoints={chartPoints}
            peeked={peeked}
            selectedDate={selected?.date}
            onDotClick={handleDotClick}
            fmt={fmt}
            unitLabel={unitLabel}
          />

                    {/* The dots are the primary edit affordance, so say so — nothing about a
              plotted point reads as tappable on its own. Two-step because a bare
              tap-to-edit made it too easy to open the sheet by accident while
              scrubbing across the chart to read values. */}
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
            Tap a point for its value, tap again to edit or delete
          </div>

          {/* History: collapsed by default. It doubles as the keyboard- and
              screen-reader-accessible equivalent of the aria-hidden chart, so
              every entry stays reachable — just not always on screen. */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '4px' }}>
            <button
              type="button"
              className="press"
              onClick={() => setHistoryOpen(o => !o)}
              aria-expanded={historyOpen}
              aria-controls="bw-history"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                minHeight: '40px',
                padding: '0 2px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-sans)',
                fontSize: '12px',
              }}
            >
              <span style={{ letterSpacing: '1px', textTransform: 'uppercase' }}>
                History
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {chartPoints.length} {chartPoints.length === 1 ? 'entry' : 'entries'}
                </span>
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"
                  style={{
                    transform: historyOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 150ms ease',
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>

            {/* Always mounted so the drawer animates to its natural height —
                see .drawer in globals.css — and `inert` keeps the collapsed
                rows out of the tab order and the accessibility tree. */}
            <div className="drawer" data-open={historyOpen}>
              {/* Padding-free clip wrapper — pad the inner list so focus rings
                  aren't cropped (outline-offset 2px + 2px ring needs 4px). */}
              <div>
              <ul
                id="bw-history"
                aria-label="Body weight history, newest first"
                inert={!historyOpen}
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: '4px 0 0',
                  // Cap the list so a year of daily logs can't stretch the card
                  // off the screen — it scrolls inside the card instead.
                  maxHeight: '240px',
                  overflowY: 'auto',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {pointsNewestFirst.map(p => (
                  <li key={p.date}>
                    <button
                      type="button"
                      className="press"
                      onClick={() => openEntry(p)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        minHeight: '40px',
                        padding: '0 2px',
                        background: 'none',
                        border: 'none',
                        borderTop: '1px solid var(--border)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'var(--font-sans)',
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span>{p.displayDate}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                          {fmt(p.canonical)} {unitLabel}
                        </span>
                        <span className="sr-only">— edit or delete</span>
                        <svg
                          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          aria-hidden="true" style={{ color: 'var(--text-muted)' }}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              </div>
            </div>
          </div>
        </>
      )}

      {selected && (
        <Dialog
          open
          onClose={closeEntry}
          title={`Edit body weight for ${selected.longDate}`}
          initialFocusRef={editInputRef}
          panelStyle={{ maxWidth: '480px' }}
          // Lifts the sheet above the iOS keyboard — the input autofocuses on
          // open (below), so without this the keyboard opens immediately and
          // covers the sheet with no compensation at all.
          avoidKeyboard
        >
          <div
            style={{
              width: '100%',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderBottom: 'none',
              borderRadius: '20px 20px 0 0',
              padding: '20px 20px calc(28px + env(safe-area-inset-bottom))',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              // Cap against the keyboard-adjusted viewport and scroll internally —
              // without this, paddingBottom above can push content taller than the
              // remaining space clean off the top of the screen (see PlateCalculator).
              maxHeight: 'calc(92dvh - var(--grind-keyboard-inset, 0px))',
              overflowY: 'auto',
              // CSS keyframe (not state-driven) so reduce-motion zeroes it for free.
              animation: 'sheet-up 220ms ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <div style={{
                  fontFamily: 'var(--font-display)', fontSize: '18px',
                  color: 'var(--text-primary)', letterSpacing: '1px',
                }}>
                  {selected.longDate.toUpperCase()}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Logged at {fmt(selected.canonical)} {unitLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={closeEntry}
                aria-label="Close"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: '4px', margin: '-4px',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {confirmDelete ? (
              <>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                  Delete this entry? Your weight for {selected.displayDate} will be removed from the chart.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    data-haptic="heavy"
                    onClick={handleDelete}
                    disabled={busy !== null}
                    style={{
                      position: 'relative',
                      flex: 1, height: '46px', borderRadius: 'var(--radius-sm)', border: 'none',
                      backgroundColor: 'var(--danger)', color: '#fff',
                      fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 700,
                      letterSpacing: '0.5px',
                      cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy === 'deleting' ? 'DELETING…' : 'DELETE'}
                  </button>
                  <button
                    type="button"
                    data-haptic="light"
                    onClick={() => setConfirmDelete(false)}
                    disabled={busy !== null}
                    style={{
                      position: 'relative',
                      flex: 1, height: '46px', borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)', backgroundColor: 'var(--surface-elevated)',
                      color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
                      fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    KEEP
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    ref={editInputRef}
                    type="number"
                    inputMode="decimal"
                    value={editDraft}
                    onChange={e => setEditDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleUpdate() }}
                    aria-label={`Body weight for ${selected.longDate} in ${unitLabel}`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '16px',
                      padding: '10px 12px',
                      height: '46px',
                    }}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{unitLabel}</span>
                  <button
                    type="button"
                    data-haptic="medium"
                    onClick={handleUpdate}
                    disabled={busy !== null || !editDraft}
                    style={{
                      position: 'relative',
                      height: '46px', padding: '0 20px', borderRadius: 'var(--radius-sm)', border: 'none',
                      backgroundColor: busy || !editDraft ? 'var(--surface-elevated)' : 'var(--accent)',
                      color: busy || !editDraft ? 'var(--text-muted)' : 'var(--on-accent)',
                      fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 700,
                      letterSpacing: '0.5px',
                      cursor: busy || !editDraft ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {busy === 'saving' ? '...' : 'SAVE'}
                  </button>
                </div>

                <button
                  type="button"
                  data-haptic="light"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy !== null}
                  style={{
                    position: 'relative',
                    alignSelf: 'center',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    minHeight: '44px', padding: '0 12px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--danger)', fontFamily: 'var(--font-sans)', fontSize: '13px',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                  Delete this entry
                </button>
              </>
            )}
          </div>
        </Dialog>
      )}
    </div>
  )
}
