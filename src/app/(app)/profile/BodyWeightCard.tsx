'use client'
import { useEffect, useRef, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { useUnit } from '@/lib/contexts/UnitContext'
import { useToast } from '@/lib/contexts/ToastContext'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import { useKeyboardInset } from '@/lib/hooks/useKeyboardInset'
import Dialog from '@/components/ui/Dialog'

interface Row {
  weight: number
  recorded_at: string
}

interface Point {
  /** YYYY-MM-DD key, unique per entry (one weight per day). */
  date: string
  /** Stored value, always canonical lbs. */
  canonical: number
  /** Short axis / list label, e.g. "Jun 30". */
  displayDate: string
  /** Long label for the editor sheet, e.g. "Monday, June 30". */
  longDate: string
  /** Value in the active display unit — what the chart plots. */
  weight: number
}

function todayDateKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function BodyWeightCard() {
  const supabase = createClient()
  const { unitLabel, toDisplay, fromDisplay, fmt } = useUnit()
  const toast = useToast()
  // Recharts' line-draw is a JS (react-smooth) animation, not CSS — the
  // `html.reduce-motion` class in globals.css can't reach it, so it has to be
  // gated explicitly or it keeps playing with the setting on.
  const { reduceMotion } = useMotionPref()
  const keyboardInset = useKeyboardInset()
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
  }, [])

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const since = new Date()
    since.setDate(since.getDate() - 90)
    const sinceKey = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`

    const { data } = await supabase
      .from('body_weights')
      .select('weight, recorded_at')
      .eq('user_id', user.id)
      .gte('recorded_at', sinceKey)
      .order('recorded_at', { ascending: true })

    setRows((data ?? []) as Row[])
    setLoading(false)
  }

  async function handleSave() {
    const w = parseFloat(draft)
    if (!Number.isFinite(w) || w <= 0) return
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
      toast.show('Could not save weight. Try again.')
      return
    }
    await load()
    setDraft('')
    setSaving(false)
    toast.show('Weight logged')
  }

  function openEntry(p: Point) {
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

  /** Chart dot tap: first tap peeks the value, a second tap on the same dot opens it. */
  function handleDotClick(p: Point) {
    if (peeked === p.date) {
      openEntry(p)
    } else {
      setPeeked(p.date)
    }
  }

  async function handleUpdate() {
    if (!selected) return
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
      toast.show('Could not update weight. Try again.')
      return
    }
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
      toast.show('Could not delete entry. Try again.')
      return
    }
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

  // Chart point: a transparent 14px-radius circle sits under the visible dot so
  // the tap target clears the 44px minimum even though the dot itself is 8px.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderDot = (props: any) => {
    const { cx, cy, payload } = props
    if (cx == null || cy == null) return <g key={payload?.date} />
    const isPeeked = payload?.date === peeked
    const active = payload?.date === selected?.date || isPeeked
    const point = chartPoints.find(p => p.date === payload?.date)
    const isFirst = point === chartPoints[0]
    const isLast = point === chartPoints[chartPoints.length - 1]
    const anchor = isFirst ? 'start' : isLast ? 'end' : 'middle'
    const label = point ? `${fmt(point.canonical)} ${unitLabel}` : ''
    const labelBelow = cy < 24
    // Rough width from character count — good enough for a plain monospace pill.
    const pillWidth = label.length * 6.5 + 16
    const pillX = anchor === 'start' ? cx : anchor === 'end' ? cx - pillWidth : cx - pillWidth / 2
    const pillY = labelBelow ? cy + 10 : cy - 30
    return (
      <g
        key={payload.date}
        style={{ cursor: 'pointer' }}
        onClick={() => point && handleDotClick(point)}
      >
        <circle cx={cx} cy={cy} r={14} fill="transparent" />
        {active && <circle cx={cx} cy={cy} r={9} fill="var(--accent)" opacity={0.25} />}
        <circle
          cx={cx}
          cy={cy}
          r={active ? 5 : 4}
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth={2}
        />
        {isPeeked && (
          <g pointerEvents="none">
            <rect
              x={pillX}
              y={pillY}
              width={pillWidth}
              height={18}
              rx={5}
              fill="var(--surface-elevated)"
              stroke="var(--border)"
            />
            <text
              x={anchor === 'start' ? pillX + 8 : anchor === 'end' ? pillX + pillWidth - 8 : cx}
              y={pillY + 13}
              textAnchor={anchor === 'middle' ? 'middle' : anchor}
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="var(--text-primary)"
            >
              {label}
            </text>
          </g>
        )}
      </g>
    )
  }

  return (
    <div
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
          onClick={handleSave}
          disabled={saving || !draft}
          style={{
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
          <div style={{ height: '120px' }} aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartPoints} margin={{ top: 4, right: 20, bottom: 0, left: 4 }}>
                <XAxis
                  dataKey="displayDate"
                  stroke="transparent"
                  tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: "'DM Sans', sans-serif" }}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.max(0, Math.floor(chartPoints.length / 4))}
                />
                <YAxis
                  stroke="transparent"
                  tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: "'DM Sans', sans-serif" }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  domain={['dataMin - 2', 'dataMax + 2']}
                  tickFormatter={(v: number) => String(Math.round(v))}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--surface-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                />
                <Line
                  type="monotone"
                  dataKey="weight"
                  stroke="var(--accent-text)"
                  strokeWidth={2}
                  dot={renderDot}
                  activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 }}
                  isAnimationActive={!reduceMotion}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

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
              <ul
                id="bw-history"
                aria-label="Body weight history, newest first"
                inert={!historyOpen}
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
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
        </>
      )}

      {selected && (
        <Dialog
          open
          onClose={closeEntry}
          title={`Edit body weight for ${selected.longDate}`}
          initialFocusRef={editInputRef}
          panelStyle={{ maxWidth: '480px' }}
          style={{
            // Lift the sheet above the iOS keyboard — the input autofocuses on
            // open (below), so without this the keyboard opens immediately and
            // covers the sheet with no compensation at all.
            paddingBottom: keyboardInset > 0 ? keyboardInset : 0,
            transition: 'padding-bottom 180ms ease',
          }}
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
              maxHeight: keyboardInset > 0 ? `calc(92dvh - ${keyboardInset}px)` : '92dvh',
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
                    onClick={handleDelete}
                    disabled={busy !== null}
                    style={{
                      flex: 1, height: '46px', borderRadius: 'var(--radius-sm)', border: 'none',
                      backgroundColor: 'var(--danger)', color: '#fff',
                      fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 700,
                      letterSpacing: '0.5px',
                      cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy === 'deleting' ? 'DELETING...' : 'DELETE'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={busy !== null}
                    style={{
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
                    onClick={handleUpdate}
                    disabled={busy !== null || !editDraft}
                    style={{
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
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy !== null}
                  style={{
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
