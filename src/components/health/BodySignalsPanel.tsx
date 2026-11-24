'use client'
import { useState, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { BodySignals, Signal, SignalLevel } from '@/lib/body'

/**
 * Body signals: last night against your usual nights (src/lib/body/signals.ts).
 * Strain, never a diagnosis. The tags under it record what the morning really
 * was, so the card can say how often its warnings were right for you.
 */

const LEVEL_TEXT: Record<SignalLevel, string> = {
  learning: 'Learning',
  clear: 'Clear',
  mild: 'Strain',
  strong: 'Strong signs',
}

const TAGS: { id: string; label: string }[] = [
  { id: 'sick', label: 'Felt sick' },
  { id: 'alcohol', label: 'Had a drink' },
  { id: 'poor_sleep', label: 'Slept badly' },
  { id: 'hard_training', label: 'Trained hard' },
  { id: 'stress', label: 'Stressed' },
  { id: 'travel', label: 'Travelling' },
  { id: 'fine', label: 'Felt fine' },
]

/** Where a signal sits against usual: the centre is your usual, each side
 *  three spreads. Past two spreads in the bad direction is "off". */
function Deviation({ signal }: { signal: Signal }) {
  const pos = 50 + (Math.max(-3, Math.min(3, signal.z)) / 3) * 50
  return (
    <span
      className={`body-signal-track${signal.off ? ' is-off' : ''}`}
      role="img"
      aria-label={signal.off ? `${signal.label} is outside your usual range` : `${signal.label} is within your usual range`}
    >
      <i className="body-signal-band" aria-hidden="true" />
      <i className="body-signal-dot" style={{ '--x': `${pos}%` } as CSSProperties} aria-hidden="true" />
    </span>
  )
}

function localDateTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function BodySignalsPanel({
  signals,
  record,
  labelsError = false,
}: {
  signals: BodySignals
  record: { flagged: number; labelled: number; sick: number } | null
  /** The saved tags failed to load. They would show as unset, and the next
   *  tap would overwrite the real set, so tagging stays off until a reload. */
  labelsError?: boolean
}) {
  const [tags, setTags] = useState<string[]>(signals.labels)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [onset, setOnset] = useState(() => localDateTime(signals.symptomsOnsetAt))

  async function toggle(id: string) {
    if (saving || labelsError) return
    const next = tags.includes(id) ? tags.filter(t => t !== id) : [...tags.filter(t => !(id === 'fine' || t === 'fine')), id]
    await save(next, next.includes('sick') ? onset : '', new Date())
  }

  async function save(next: string[], noticed: string, submittedAt: Date) {
    if (saving || labelsError) return
    const time = noticed ? new Date(noticed) : null
    if (time && (!Number.isFinite(time.getTime()) || time.getTime() > submittedAt.getTime())) {
      setFailed(true)
      return
    }
    const prev = tags
    setTags(next)
    setSaving(true)
    setFailed(false)
    const supabase = createClient()
    // RLS checks the owner; the id only fills the row.
    const userId = (await supabase.auth.getSession()).data.session?.user.id
    const { error } = !userId
      ? { error: new Error('signed out') }
      : next.length
      ? await supabase
          .from('body_signal_labels')
          .upsert({
            user_id: userId, local_date: signals.date, tags: next, updated_at: submittedAt.toISOString(),
            ...(signals.source === 'garmin_personal' ? { symptoms_onset_at: time?.toISOString() ?? null } : {})
          }, { onConflict: 'user_id,local_date' })
      : await supabase.from('body_signal_labels').delete().eq('user_id', userId).eq('local_date', signals.date)
    setSaving(false)
    if (error) {
      setTags(prev)
      setFailed(true)
    } else if (!next.includes('sick')) {
      setOnset('')
    }
  }

  const shown = signals.signals
  return (
    <div className={`body-signals is-${signals.level}`}>
      <div className="body-signals-head">
        <span className="body-signals-level">{signals.level === 'clear' && shown.some(s => s.off) ? 'Change noted' : LEVEL_TEXT[signals.level]}</span>
        <h3>{signals.headline}</h3>
        <p>{signals.advice}</p>
      </div>

      {shown.length > 0 && (
        <ul className="body-signal-list" aria-label="Last night against your usual">
          {shown.map(s => (
            <li key={s.key} className={s.off ? 'is-off' : undefined}>
              <span className="body-signal-name">{s.label}</span>
              <strong>{s.value}</strong>
              <Deviation signal={s} />
              <small>usual {s.usual}{s.baselineNights ? ` · ${s.baselineNights} nights` : ''}</small>
            </li>
          ))}
        </ul>
      )}

      {(signals.level !== 'learning' || signals.source === 'garmin_personal') && (
        <div className="body-signal-tags">
          <p className="health-eyebrow">How was this morning?</p>
          {labelsError && (
            <p className="body-signal-error" role="alert">Couldn&apos;t load your tags. Reload to change them.</p>
          )}
          <div role="group" aria-label="How was this morning?">
            {TAGS.map(t => (
              <button
                key={t.id}
                type="button"
                className="press"
                aria-pressed={tags.includes(t.id)}
                disabled={saving || labelsError}
                onClick={() => toggle(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {signals.source === 'garmin_personal' && tags.includes('sick') && (
            <form onSubmit={event => { event.preventDefault(); void save(tags, onset, new Date()) }}>
              <label className="garmin-trend-select">First noticed symptoms
                <input type="datetime-local" value={onset} onChange={event => setOnset(event.target.value)}
                  disabled={saving || labelsError} />
              </label>
              <button type="submit" disabled={saving || labelsError} className="press">Save time</button>
            </form>
          )}
          {failed && <p className="body-signal-error" role="alert">Couldn&apos;t save that. Try again.</p>}
        </div>
      )}

      {record && record.flagged > 0 && (
        <p className="health-muted body-signal-record">
          {record.flagged} {record.flagged === 1 ? 'morning' : 'mornings'} flagged in 4 weeks
          {record.labelled > 0 ? ` · you marked ${record.sick} as sickness` : ' · tag them to see how often it was right'}
        </p>
      )}
      <p className="health-muted">A sign of strain from your own usual nights, not a diagnosis.</p>
    </div>
  )
}
