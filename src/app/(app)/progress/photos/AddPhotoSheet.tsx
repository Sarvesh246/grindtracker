'use client'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Dialog from '@/components/ui/Dialog'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { useProgressPhotos } from '@/lib/hooks/useProgressPhotos'
import { formatDayType, localDateKey } from '@/lib/utils/formatting'

// Generous relative to the 40/day server-side cap (docs/sql/21-progress-photos.sql)
// — just keeps a single picker selection sane, the trigger is the real limit.
const MAX_FILES = 20
const MAX_NOTE_CHARS = 500

interface Attachment {
  file: File
  preview: string
  id: string
}

/**
 * Bottom sheet for logging a day's progress photos. Mount conditionally
 * (`{open && <AddPhotoSheet .../>}`) so every open starts fresh, matching
 * FeedbackModal's convention.
 */
export default function AddPhotoSheet({
  dayTypeOptions,
  initialDayType,
  onClose,
  onSaved,
}: {
  /** The user's configured workout days, prefetched by the feed page so
   * these buttons render instantly instead of popping in a beat after the
   * sheet itself. */
  dayTypeOptions: string[]
  /** Today's already-suggested tag (also prefetched), used as the initial
   * selection so the correct button is highlighted on first paint rather
   * than flashing "None" until the per-date lookup below resolves. */
  initialDayType: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { getGroupForDate, getSuggestedDayTypes, upsertGroup, addPhotos } = useProgressPhotos()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const today = useMemo(() => localDateKey(), [])
  const [date, setDate] = useState(today)
  const [dayType, setDayType] = useState<string | null>(initialDayType)
  const [note, setNote] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [existingCount, setExistingCount] = useState(0)
  const [loadingDate, setLoadingDate] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const attachmentsRef = useRef<Attachment[]>([])
  useEffect(() => { attachmentsRef.current = attachments }, [attachments])
  useEffect(() => () => {
    attachmentsRef.current.forEach(a => URL.revokeObjectURL(a.preview))
  }, [])

  // Every date change re-checks for an existing entry so re-opening "today"
  // prefills its caption/tag instead of the upsert silently blanking them,
  // and pulls that date's completed workout to default the tag selection.
  useEffect(() => {
    let cancelled = false
    async function loadForDate() {
      setLoadingDate(true)
      const [existing, sugg] = await Promise.all([getGroupForDate(date), getSuggestedDayTypes(date)])
      if (cancelled) return
      if (existing) {
        setDayType(existing.group.day_type)
        setNote(existing.group.note ?? '')
        setExistingCount(existing.photos.length)
      } else {
        setDayType(sugg[0] ?? null)
        setNote('')
        setExistingCount(0)
      }
      setLoadingDate(false)
    }
    loadForDate()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list)
    const room = MAX_FILES - attachments.length
    if (room <= 0) {
      setError(`You can add up to ${MAX_FILES} photos at once.`)
      return
    }
    const accepted: Attachment[] = []
    for (const file of incoming.slice(0, room)) {
      if (!file.type.startsWith('image/')) {
        setError('Only image files can be added.')
        continue
      }
      accepted.push({
        file,
        preview: URL.createObjectURL(file),
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      })
    }
    if (accepted.length) {
      setError(null)
      setAttachments(prev => [...prev, ...accepted])
    }
  }

  function removeAttachment(id: string) {
    setAttachments(prev => {
      const target = prev.find(a => a.id === id)
      if (target) URL.revokeObjectURL(target.preview)
      return prev.filter(a => a.id !== id)
    })
  }

  async function handleSubmit() {
    if (attachments.length === 0) {
      setError('Add at least one photo.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const group = await upsertGroup({
        taken_date: date,
        day_type: dayType,
        note: note.trim() || null,
      })
      setProgress({ done: 0, total: attachments.length })
      await addPhotos(group.id, attachments.map(a => a.file), (done, total) => setProgress({ done, total }))
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.')
      setSubmitting(false)
      setProgress(null)
    }
  }

  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      labelledBy="add-photo-sheet-title"
      zIndex={330}
      // Lifts the whole panel above the keyboard — padding the panel's OWN
      // bottom (below) only adds trailing space inside it, it doesn't move
      // the panel itself, so without this the keyboard can still cover the
      // Save button with nothing but a scroll (and no visual cue) to find it.
      avoidKeyboard
      panelStyle={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderTopLeftRadius: 'var(--radius-lg)',
        borderTopRightRadius: 'var(--radius-lg)',
        // Shrink the cap by the keyboard inset too — dvh doesn't reliably
        // account for an open on-screen keyboard, so an uncapped 90dvh panel
        // can still be taller than what's actually left above the keyboard.
        maxHeight: 'calc(90dvh - var(--grind-keyboard-inset, 0px))',
        overflowY: 'auto',
        padding: '20px',
        boxSizing: 'border-box',
        paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '18px' }}>
        <span
          id="add-photo-sheet-title"
          style={{ fontFamily: 'var(--font-display)', fontSize: '24px', letterSpacing: '0.5px', color: 'var(--text-primary)' }}
        >
          ADD PROGRESS PHOTOS
        </span>
        <button
          onClick={onClose}
          disabled={submitting}
          aria-label="Close"
          style={{ background: 'transparent', border: 'none', padding: '2px', cursor: submitting ? 'not-allowed' : 'pointer', color: 'var(--text-muted)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Date. Native `<input type="date">` can render its internal
          segments/calendar-icon a few px past a CSS width in some browsers
          (the bug that was causing page-wide horizontal scroll) — clipping it
          with an overflow:hidden wrapper guarantees it ends exactly flush
          with the note/buttons below instead of bleeding past them. */}
      <FieldLabel>DATE</FieldLabel>
      <div style={{ width: '100%', overflow: 'hidden', borderRadius: 'var(--radius-sm)', marginBottom: existingCount > 0 ? '6px' : '16px' }}>
        <Input
          type="date"
          value={date}
          max={today}
          onChange={e => e.target.value && setDate(e.target.value)}
          style={{ width: '100%', display: 'block' }}
          disabled={submitting}
        />
      </div>
      {existingCount > 0 && (
        <div style={{ fontSize: '12px', color: 'var(--accent-text)', marginBottom: '16px' }}>
          Adding to {existingCount} existing photo{existingCount === 1 ? '' : 's'} from this day.
        </div>
      )}

      {/* Workout tag — the user's configured workout days, in their usual
          order, with None always last. */}
      <FieldLabel>WORKOUT</FieldLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
        {dayTypeOptions.map(dt => (
          <TagPill key={dt} active={dayType === dt} onClick={() => setDayType(dt)} disabled={submitting || loadingDate}>
            {formatDayType(dt)}
          </TagPill>
        ))}
        <TagPill active={dayType === null} onClick={() => setDayType(null)} disabled={submitting || loadingDate}>
          None
        </TagPill>
      </div>

      {/* Note */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '8px' }}>
        <FieldLabelInline>NOTE <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span></FieldLabelInline>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-disabled)' }}>
          {MAX_NOTE_CHARS - note.length}
        </span>
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value.slice(0, MAX_NOTE_CHARS))}
        placeholder="How's it going? Anything to remember about today."
        rows={3}
        disabled={submitting}
        style={{
          width: '100%', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
          fontSize: '16px', lineHeight: 1.5, padding: '12px', boxSizing: 'border-box', resize: 'vertical',
          outline: 'none', marginBottom: '18px',
        }}
      />

      {/* Photos */}
      <FieldLabel>PHOTOS</FieldLabel>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
        {attachments.map(a => (
          <div key={a.id} style={{ position: 'relative', width: '72px', height: '72px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border)', backgroundColor: 'var(--surface-elevated)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.preview} alt={a.file.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            {!submitting && (
              <button
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.file.name}`}
                style={{
                  position: 'absolute', top: '3px', right: '3px', width: '20px', height: '20px', borderRadius: '9999px',
                  backgroundColor: 'rgba(0,0,0,0.68)', border: 'none', color: '#f0f0f0', cursor: 'pointer', lineHeight: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        ))}
        {attachments.length < MAX_FILES && !submitting && (
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '72px', height: '72px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-elevated)',
              border: '1px dashed var(--border-strong)', color: 'var(--text-muted)', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
            </svg>
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-sans)' }}>ADD</span>
          </button>
        )}
      </div>
      {/* No `capture` attribute — forcing camera-only hides the library picker
          on some Android browsers, and an existing photo is picked just as
          often as a fresh one for this feature. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={e => { addFiles(e.target.files); e.target.value = '' }}
        style={{ display: 'none' }}
      />

      {progress && (
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Uploading {progress.done}/{progress.total}…
        </div>
      )}

      {error && (
        <div style={{
          fontSize: '12px', color: 'var(--danger)', backgroundColor: 'var(--danger-bg)',
          border: '1px solid var(--danger-bg-hover)', borderRadius: 'var(--radius-sm)',
          padding: '9px 11px', marginBottom: '12px', lineHeight: 1.4,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <Button variant="secondary" haptic="light" onClick={onClose} disabled={submitting} style={{ flex: '0 0 auto', padding: '0 18px' }}>
          Cancel
        </Button>
        {/* flex + minWidth:0 (not `fullWidth`, which sets a literal width:100%
            that fights the Cancel button's own min-content width and pushes
            this row a few px past the panel — the classic flex-item
            min-width:auto overflow trap) so this shrinks to share the row. */}
        <Button
          variant="primary"
          haptic="medium"
          onClick={handleSubmit}
          disabled={submitting || attachments.length === 0}
          style={{ flex: 1, minWidth: 0 }}
        >
          {submitting ? 'SAVING…' : 'SAVE'}
        </Button>
      </div>
    </Dialog>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)', marginBottom: '8px' }}>
      {children}
    </div>
  )
}

function FieldLabelInline({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)' }}>
      {children}
    </span>
  )
}

function TagPill({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      data-haptic="light"
      onClick={onClick}
      disabled={disabled}
      style={{
        position: 'relative',
        height: '34px', padding: '0 14px', borderRadius: 'var(--radius-pill, 9999px)',
        backgroundColor: active ? 'var(--accent)' : 'var(--surface-elevated)',
        color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: active ? 700 : 500,
        cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 150ms ease',
      }}
    >
      {children}
    </button>
  )
}
