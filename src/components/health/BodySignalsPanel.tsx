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

export function BodySignalsPanel({
  signals,
  record,
}: {
  signals: BodySignals
  record: { flagged: number; labelled: number; sick: number } | null
}) {
  const [tags, setTags] = useState<string[]>(signals.labels)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  async function toggle(id: string) {
    if (saving) return
    const next = tags.includes(id) ? tags.filter(t => t !== id) : [...tags.filter(t => !(id === 'fine' || t === 'fine')), id]
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
          .upsert({ user_id: userId, local_date: signals.date, tags: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id,local_date' })
      : await supabase.from('body_signal_labels').delete().eq('user_id', userId).eq('local_date', signals.date)
    setSaving(false)
    if (error) {
      setTags(prev)
      setFailed(true)
    }
  }

  const shown = signals.signals
  return (
    <div className={`body-signals is-${signals.level}`}>
      <div className="body-signals-head">
        <span className="body-signals-level">{LEVEL_TEXT[signals.level]}</span>
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
              <small>usual {s.usual}</small>
            </li>
          ))}
        </ul>
      )}

      {signals.level !== 'learning' && (
        <div className="body-signal-tags">
          <p className="health-eyebrow">How was this morning?</p>
          <div role="group" aria-label="How was this morning?">
            {TAGS.map(t => (
              <button
                key={t.id}
                type="button"
                className="press"
                aria-pressed={tags.includes(t.id)}
                disabled={saving}
                onClick={() => toggle(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {failed && <p className="body-signal-error" role="alert">Couldn&apos;t save that. Try again.</p>}
        </div>
      )}

      {record && record.flagged > 0 && (
        <p className="health-muted body-signal-record">
          {record.flagged} {record.flagged === 1 ? 'morning' : 'mornings'} flagged in 90 days
          {record.labelled > 0 ? ` · you marked ${record.sick} as sickness` : ' · tag them to see how often it was right'}
        </p>
      )}
      <p className="health-muted">A sign of strain from your own usual nights, not a diagnosis.</p>
    </div>
  )
}
