'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { FeedbackCategory } from '@/lib/types'

const CATEGORIES: { key: FeedbackCategory; label: string }[] = [
  { key: 'bug', label: 'Bug' },
  { key: 'feature', label: 'Feature' },
  { key: 'improvement', label: 'Improvement' },
  { key: 'other', label: 'Other' },
]

const MAX_IMAGES = 3
const MAX_BYTES = 5 * 1024 * 1024 // mirrors the bucket's file_size_limit
const MAX_CHARS = 4000            // mirrors the message CHECK constraint

// Mirrors the `feedback_rate_limit` trigger in docs/sql/09-feedback.sql. These
// are checked client-side only to fail fast — before any image is uploaded and
// with a readable message. The trigger is what actually enforces them.
const BURST_LIMIT = 3
const BURST_MINUTES = 10
const DAILY_LIMIT = 20

/** Turn the trigger's tagged exception into something a stranger can act on. */
function friendlyError(message: string): string {
  if (message.includes('FEEDBACK_RATE_LIMIT_BURST')) {
    return `You've sent ${BURST_LIMIT} messages in the last ${BURST_MINUTES} minutes. Give it a few minutes and try again.`
  }
  if (message.includes('FEEDBACK_RATE_LIMIT_DAILY')) {
    return `You've hit the limit of ${DAILY_LIMIT} messages per day. Try again tomorrow.`
  }
  return message
}

interface Attachment {
  file: File
  /** Object URL for the thumbnail — revoked on remove/unmount. */
  preview: string
  id: string
}

function extensionFor(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName && /^[a-z0-9]{1,5}$/.test(fromName)) return fromName
  return file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp'
    : file.type === 'image/gif' ? 'gif'
    : 'jpg'
}

/**
 * Mounted only while open (the parent renders it conditionally), so every open
 * starts from fresh state — no reset effect, and no chance a previous
 * submission's success screen greets the next reporter.
 */
export default function FeedbackModal({ onClose }: { onClose: () => void }) {
  const supabase = useMemo(() => createClient(), [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [category, setCategory] = useState<FeedbackCategory>('bug')
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [anonymous, setAnonymous] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  // Mirror of `attachments` for the unmount cleanup below — reading state
  // directly there would close over the initial (empty) array and leak every
  // preview URL the user actually added.
  const attachmentsRef = useRef<Attachment[]>([])
  useEffect(() => { attachmentsRef.current = attachments }, [attachments])

  // Revoke any outstanding object URLs when the modal closes.
  useEffect(() => () => {
    attachmentsRef.current.forEach(a => URL.revokeObjectURL(a.preview))
  }, [])

  // Escape closes, and the page behind must not scroll under the sheet.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [submitting, onClose])

  function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list)
    const room = MAX_IMAGES - attachments.length
    if (room <= 0) {
      setError(`You can attach up to ${MAX_IMAGES} images.`)
      return
    }
    const accepted: Attachment[] = []
    for (const file of incoming.slice(0, room)) {
      if (!file.type.startsWith('image/')) {
        setError('Only image files can be attached.')
        continue
      }
      if (file.size > MAX_BYTES) {
        setError(`"${file.name}" is over 5 MB.`)
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
    if (incoming.length > room) {
      setError(`Only the first ${room} image${room === 1 ? '' : 's'} could be added (max ${MAX_IMAGES}).`)
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
    const trimmed = message.trim()
    if (!trimmed) {
      setError('Please write a little about what you have in mind.')
      textareaRef.current?.focus()
      return
    }

    setSubmitting(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Your session expired — please sign in again.')
      setSubmitting(false)
      return
    }

    // Pre-flight the rate limit. Users can select their own rows, so these
    // counts are cheap and honest — and running them BEFORE the uploads means a
    // rate-limited submission doesn't strand images in the bucket.
    const now = Date.now()
    const [burst, daily] = await Promise.all([
      supabase.from('feedback')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gt('created_at', new Date(now - BURST_MINUTES * 60_000).toISOString()),
      supabase.from('feedback')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gt('created_at', new Date(now - 24 * 60 * 60_000).toISOString()),
    ])

    if ((burst.count ?? 0) >= BURST_LIMIT) {
      setError(friendlyError('FEEDBACK_RATE_LIMIT_BURST'))
      setSubmitting(false)
      return
    }
    if ((daily.count ?? 0) >= DAILY_LIMIT) {
      setError(friendlyError('FEEDBACK_RATE_LIMIT_DAILY'))
      setSubmitting(false)
      return
    }

    // Upload attachments first: the row stores their paths, so it can only be
    // written once every object is safely in the bucket.
    const paths: string[] = []
    for (const a of attachments) {
      const path = `${user.id}/${crypto.randomUUID()}.${extensionFor(a.file)}`
      const { error: uploadError } = await supabase
        .storage
        .from('feedback-images')
        .upload(path, a.file, { contentType: a.file.type, upsert: false })
      if (uploadError) {
        setError(`Couldn't upload "${a.file.name}". ${uploadError.message}`)
        setSubmitting(false)
        return
      }
      paths.push(path)
    }

    // Identity snapshot. Recorded even when anonymous — user_id is kept for
    // abuse control and the inbox simply hides it (see 09-feedback.sql).
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle()

    const { error: insertError } = await supabase.from('feedback').insert({
      user_id: user.id,
      username: profile?.username ?? null,
      email: user.email ?? null,
      category,
      message: trimmed,
      image_paths: paths,
      is_anonymous: anonymous,
    })

    if (insertError) {
      // The trigger fires here if the pre-flight raced or was bypassed.
      setError(friendlyError(insertError.message))
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    setSent(true)
  }

  const remaining = MAX_CHARS - message.length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
      onClick={e => { if (e.target === e.currentTarget && !submitting) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          maxHeight: '100%',
          overflowY: 'auto',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.45)',
          padding: '20px',
        }}
      >
        {sent ? (
          <div style={{ textAlign: 'center', padding: '18px 4px 6px' }}>
            <div style={{
              width: '56px', height: '56px', margin: '0 auto 16px',
              borderRadius: '9999px', backgroundColor: 'var(--accent-wash)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)"
                strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: '26px',
              color: 'var(--text-primary)', letterSpacing: '0.5px', marginBottom: '6px',
            }}>
              FEEDBACK SENT
            </div>
            <div style={{
              fontSize: '13px', color: 'var(--text-secondary)',
              lineHeight: 1.5, marginBottom: '20px',
            }}>
              Thanks — it went straight to the developer. Every note actually gets read.
            </div>
            <button
              onClick={onClose}
              style={{
                width: '100%', height: 'var(--btn-md)',
                backgroundColor: 'var(--accent)', color: 'var(--on-accent)',
                border: 'none', borderRadius: 'var(--radius-md)',
                fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 700,
                letterSpacing: '0.5px', cursor: 'pointer',
              }}
            >
              DONE
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '4px' }}>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: '26px',
                color: 'var(--text-primary)', letterSpacing: '0.5px', lineHeight: 1.1,
              }}>
                SEND FEEDBACK
              </div>
              <button
                onClick={onClose}
                disabled={submitting}
                aria-label="Close"
                style={{
                  background: 'transparent', border: 'none', padding: '2px',
                  cursor: submitting ? 'not-allowed' : 'pointer', lineHeight: 0,
                  color: 'var(--text-muted)', flexShrink: 0,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '18px' }}>
              Found a bug, want something added, or think something could be better? Tell me.
            </div>

            {/* Category */}
            <div style={{
              fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-label)', marginBottom: '8px',
            }}>
              TYPE
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' }}>
              {CATEGORIES.map(c => {
                const active = category === c.key
                return (
                  <button
                    key={c.key}
                    onClick={() => setCategory(c.key)}
                    style={{
                      height: '34px', padding: '0 14px',
                      borderRadius: 'var(--radius-pill)',
                      backgroundColor: active ? 'var(--accent)' : 'var(--surface-elevated)',
                      color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      fontFamily: 'var(--font-sans)', fontSize: '13px',
                      fontWeight: active ? 700 : 500,
                      cursor: 'pointer', transition: 'all 150ms ease',
                    }}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>

            {/* Message */}
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '8px',
            }}>
              <span style={{
                fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-label)',
              }}>
                MESSAGE
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '11px',
                color: remaining < 100 ? 'var(--danger)' : 'var(--text-disabled)',
              }}>
                {remaining}
              </span>
            </div>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, MAX_CHARS))}
              placeholder="What's on your mind? The more specific, the better."
              rows={5}
              style={{
                width: '100%',
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)',
                fontSize: '16px', // ≥16px prevents iOS auto-zoom on focus
                lineHeight: 1.5,
                padding: '12px',
                boxSizing: 'border-box',
                resize: 'vertical',
                minHeight: '120px',
                outline: 'none',
                transition: 'border-color 150ms ease',
                marginBottom: '18px',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-dim)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            />

            {/* Attachments */}
            <div style={{
              fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-label)', marginBottom: '8px',
            }}>
              SCREENSHOTS <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
              {attachments.map(a => (
                <div
                  key={a.id}
                  style={{
                    position: 'relative', width: '72px', height: '72px',
                    borderRadius: 'var(--radius-sm)', overflow: 'hidden',
                    border: '1px solid var(--border)', backgroundColor: 'var(--surface-elevated)',
                  }}
                >
                  {/* Local object URL preview — next/image adds nothing here. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.preview}
                    alt={a.file.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  <button
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`Remove ${a.file.name}`}
                    style={{
                      position: 'absolute', top: '3px', right: '3px',
                      width: '20px', height: '20px', borderRadius: '9999px',
                      backgroundColor: 'rgba(0, 0, 0, 0.68)', border: 'none',
                      color: '#f0f0f0', cursor: 'pointer', lineHeight: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="3" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}

              {attachments.length < MAX_IMAGES && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: '72px', height: '72px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-elevated)',
                    border: '1px dashed var(--border-strong)',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: '4px',
                    transition: 'border-color 150ms ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-dim)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-sans)' }}>ADD</span>
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={e => { addFiles(e.target.files); e.target.value = '' }}
              style={{ display: 'none' }}
            />

            {/* Anonymous */}
            <button
              onClick={() => setAnonymous(v => !v)}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', gap: '10px',
                backgroundColor: 'transparent', border: 'none',
                padding: '0 0 18px', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{
                width: '18px', height: '18px', flexShrink: 0,
                borderRadius: '5px',
                backgroundColor: anonymous ? 'var(--accent)' : 'var(--surface-elevated)',
                border: `1px solid ${anonymous ? 'var(--accent)' : 'var(--border-strong)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 150ms ease',
              }}>
                {anonymous && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)"
                    strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Send anonymously — hide my name from the developer
              </span>
            </button>

            {error && (
              <div style={{
                fontSize: '12px', color: 'var(--danger)',
                backgroundColor: 'var(--danger-bg)',
                border: '1px solid var(--danger-bg-hover)',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 11px', marginBottom: '12px', lineHeight: 1.4,
              }}>
                {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={onClose}
                disabled={submitting}
                style={{
                  flex: '0 0 auto', height: 'var(--btn-md)', padding: '0 18px',
                  backgroundColor: 'var(--surface-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 500,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !message.trim()}
                style={{
                  flex: 1, height: 'var(--btn-md)',
                  backgroundColor: submitting || !message.trim() ? 'var(--surface-elevated)' : 'var(--accent)',
                  color: submitting || !message.trim() ? 'var(--text-disabled)' : 'var(--on-accent)',
                  border: `1px solid ${submitting || !message.trim() ? 'var(--border)' : 'var(--accent)'}`,
                  borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 700,
                  letterSpacing: '0.5px',
                  cursor: submitting || !message.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 150ms ease',
                }}
              >
                {submitting ? 'SENDING…' : 'SEND FEEDBACK'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
