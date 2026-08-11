'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { COACH_MAX_MESSAGE_CHARS } from '@/lib/coach'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import IconButton from '@/components/ui/IconButton'
import CoachFabIcon from './CoachFabIcon'
import { useCoach } from './CoachProvider'

const CHIPS = [
  "How's my streak?",
  'Recent PRs?',
  'What did I do last workout?',
  'Am I progressing?',
] as const

export default function CoachSheet() {
  const {
    open,
    size,
    dock,
    messages,
    streaming,
    error,
    quota,
    configured,
    closeCoach,
    toggleSize,
    sendMessage,
    clearError,
  } = useCoach()
  const { reduceMotion } = useMotionPref()
  const titleId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const stickBottom = useRef(true)
  const [draft, setDraft] = useState('')

  const dailyRemaining = quota?.dailyRemaining
  const capped = dailyRemaining != null && dailyRemaining <= 0
  const sendDisabled =
    !draft.trim() || streaming || capped || configured === false

  // Focus composer on open (after a frame so sheet-up can start).
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(
      () => {
        inputRef.current?.focus()
      },
      reduceMotion ? 0 : 80,
    )
    return () => window.clearTimeout(t)
  }, [open, reduceMotion])

  // Escape closes.
  useEffect(() => {
    if (!open) return
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeCoach()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeCoach])

  // Auto-scroll when near bottom / on stream.
  useEffect(() => {
    if (!open || !listRef.current) return
    if (!stickBottom.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, streaming, open, size])

  if (!open) return null

  function onListScroll() {
    const el = listRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    stickBottom.current = dist < 48
  }

  async function handleSend(text?: string) {
    const value = (text ?? draft).trim()
    if (!value || streaming || capped || configured === false) return
    setDraft('')
    clearError()
    stickBottom.current = true
    await sendMessage(value)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void handleSend()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const empty = messages.length === 0

  return (
    <>
      <button
        type="button"
        className="coach-backdrop"
        aria-label="Close Coach"
        onClick={closeCoach}
      />
      <div
        className={`coach-sheet coach-sheet--${size}`}
        data-dock={dock}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          transition: reduceMotion
            ? 'none'
            : 'height 220ms ease, max-height 220ms ease, width 220ms ease',
        }}
      >
        <header className="coach-sheet__header">
          <div className="coach-sheet__brand">
            <span className="coach-sheet__mark" aria-hidden>
              <CoachFabIcon size={20} />
            </span>
            <h2 id={titleId} className="coach-sheet__title">
              Coach
            </h2>
          </div>
          <div
            className={`coach-sheet__quota${
              capped ? ' coach-sheet__quota--danger' : ''
            }`}
            aria-live="polite"
            title="Coach messages you can send today — resets 24 hours after your first message"
          >
            {dailyRemaining != null
              ? `${dailyRemaining} message${dailyRemaining === 1 ? '' : 's'} left today`
              : quota
                ? '…'
                : '—'}
          </div>
          <div className="coach-sheet__actions">
            <IconButton
              aria-label={size === 'compact' ? 'Expand Coach' : 'Collapse Coach'}
              size="sm"
              variant="surface"
              haptic="light"
              onClick={toggleSize}
              style={{ width: 32, height: 32 }}
            >
              {size === 'compact' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </IconButton>
            <IconButton
              ref={closeRef}
              aria-label="Close Coach"
              size="sm"
              variant="surface"
              haptic="light"
              onClick={closeCoach}
              style={{ width: 32, height: 32 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconButton>
          </div>
        </header>

        <div
          ref={listRef}
          className="coach-sheet__body scrollbar-hide"
          onScroll={onListScroll}
        >
          {empty ? (
            <div className="coach-sheet__empty">
              <p className="coach-sheet__empty-line">
                Ask about streaks, PRs, or recent workouts.
              </p>
              <p className="coach-sheet__disclaimer">
                Not medical advice. Uses your GRIND log.
              </p>
              <div className="coach-sheet__chips">
                {CHIPS.map(chip => (
                  <button
                    key={chip}
                    type="button"
                    className="coach-chip press"
                    data-haptic="light"
                    disabled={streaming || capped || configured === false}
                    onClick={() => void handleSend(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="coach-sheet__messages">
              {messages.map(m => {
                const waiting =
                  m.role === 'assistant' && !m.content && streaming
                return (
                  <li
                    key={m.id}
                    className={`coach-bubble coach-bubble--${m.role}`}
                  >
                    {waiting ? (
                      <span className="coach-bubble__pending" aria-label="Thinking">
                        …
                      </span>
                    ) : (
                      m.content
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {error ? (
            <p className="coach-sheet__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <form className="coach-sheet__composer" onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            className="coach-sheet__input"
            rows={1}
            value={draft}
            maxLength={COACH_MAX_MESSAGE_CHARS}
            placeholder={
              capped
                ? 'Daily limit reached'
                : configured === false
                  ? 'Coach unavailable'
                  : 'Ask Coach…'
            }
            disabled={streaming || configured === false}
            aria-label="Message to Coach"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="submit"
            className="coach-sheet__send press"
            data-haptic="medium"
            disabled={sendDisabled}
            aria-label="Send message"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </>
  )
}
