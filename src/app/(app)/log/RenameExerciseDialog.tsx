'use client'
import { useRef, useState } from 'react'
import Dialog from '@/components/ui/Dialog'
import type { Exercise } from '@/lib/types'

const MAX_NAME_LENGTH = 60

interface Props {
  exercise: Exercise
  closing: boolean
  /** Resolves to an error message to show inline, or null once saved. */
  onSave: (name: string) => Promise<string | null>
  onClose: () => void
}

/**
 * In-workout rename. Keeps the exercise row (and therefore every logged set,
 * PR bar and stats-page history) and only changes the label it's shown under —
 * the right tool when the lift is the same one with a better name (e.g. "DB
 * Curl" → "DB Curl (per arm)"). Replacing it with a different lift is Swap.
 */
export default function RenameExerciseDialog({ exercise, closing, onSave, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(exercise.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (saving || closing) return
    setSaving(true)
    setError('')
    const err = await onSave(name)
    if (err) {
      setError(err)
      setSaving(false)
    }
    // On success the parent closes the dialog.
  }

  const disabled = saving || !name.trim()

  return (
    <Dialog
      open
      closing={closing}
      onClose={saving ? undefined : onClose}
      title={`Rename ${exercise.name}`}
      initialFocusRef={inputRef}
      panelStyle={{ maxWidth: '480px' }}
      avoidKeyboard
    >
      <form className="dlg-sheet-surface"
        onSubmit={e => { e.preventDefault(); void submit() }}
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
          maxHeight: 'calc(92dvh - var(--grind-keyboard-inset, 0px))',
          overflowY: 'auto',
          animation: 'sheet-up 220ms ease',
        }}
      >
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: '18px',
          color: 'var(--text-primary)', letterSpacing: '1px',
        }}>
          RENAME EXERCISE
        </div>

        <input
          ref={inputRef}
          type="text"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={e => { setName(e.target.value); setError('') }}
          onFocus={e => e.currentTarget.select()}
          aria-label="Exercise name"
          aria-invalid={!!error}
          autoComplete="off"
          enterKeyHint="done"
          style={{
            height: '46px',
            padding: '0 14px',
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
            backgroundColor: 'var(--surface-elevated)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)',
            fontSize: '16px',
          }}
        />

        {error ? (
          <p role="alert" style={{ margin: 0, fontSize: '13px', color: 'var(--danger)' }}>{error}</p>
        ) : (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Your sets, PRs and progress history stay with this exercise and show
            under the new name everywhere. To switch to a different lift and
            keep this one&apos;s history separate, use Swap instead.
          </p>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            data-haptic="light"
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1, height: '46px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)', backgroundColor: 'var(--surface-elevated)',
              color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            CANCEL
          </button>
          <button
            type="submit"
            data-haptic="medium"
            disabled={disabled}
            style={{
              flex: 1, height: '46px', borderRadius: 'var(--radius-sm)', border: 'none',
              backgroundColor: 'var(--accent)', color: '#0f0f0f',
              fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 700,
              letterSpacing: '0.5px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
