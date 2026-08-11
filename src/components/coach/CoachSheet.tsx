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
import CoachHistory from './CoachHistory'
import CoachMessageContent from './CoachMessageContent'
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
    historyOpen,
    closeCoach,
    expandToPage,
    sendMessage,
    clearError,
    newChat,
    openHistory,
    closeHistory,
  } = useCoach()
  const { reduceMotion } = useMotionPref()
  const titleId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickBottom = useRef(true)
  const [draft, setDraft] = useState('')

  const isPage = size === 'page'
  const dailyRemaining = quota?.dailyRemaining
  const capped =
    !quota?.unlimited && dailyRemaining != null && dailyRemaining <= 0
  const sendDisabled =
    !draft.trim() || streaming || capped || configured === false

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(
      () => {
        inputRef.current?.focus()
      },
      reduceMotion ? 0 : 80,
    )
    return () => window.clearTimeout(t)
  }, [open, reduceMotion, size])

  useEffect(() => {
    if (!open) return
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (historyOpen) {
        closeHistory()
        return
      }
      closeCoach()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, historyOpen, closeCoach, closeHistory])

  useEffect(() => {
    if (!open || !listRef.current) return
    if (!stickBottom.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, streaming, open, size])

  // Lock body scroll while the full Coach page is open (iOS PWA).
  useEffect(() => {
    if (!open || !isPage) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open, isPage])

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
  const origin =
    dock === 'tl' || dock === 'bl' ? 'bottom left' : 'bottom right'

  return (
    <>
      {!isPage ? (
        <button
          type="button"
          className="coach-backdrop"
          aria-label="Close Coach"
          onClick={closeCoach}
        />
      ) : null}
      <div
        className={`coach-sheet coach-sheet--${size}`}
        data-dock={dock}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          transformOrigin: origin,
          transition: reduceMotion
            ? 'none'
            : 'inset 320ms cubic-bezier(0.22, 1, 0.36, 1), height 320ms cubic-bezier(0.22, 1, 0.36, 1), max-height 320ms cubic-bezier(0.22, 1, 0.36, 1), width 320ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 320ms cubic-bezier(0.22, 1, 0.36, 1), left 320ms cubic-bezier(0.22, 1, 0.36, 1), right 320ms cubic-bezier(0.22, 1, 0.36, 1), top 320ms cubic-bezier(0.22, 1, 0.36, 1), bottom 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <header className="coach-sheet__header">
          <div className="coach-sheet__brand">
            <span className="coach-sheet__mark" aria-hidden>
              <CoachFabIcon size={22} />
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
            title={
              quota?.unlimited
                ? 'Dev toggle is on — the app’s 15/day limit is bypassed until you hit Gemini’s own free-tier quota'
                : 'Coach messages you can send today — resets 24 hours after your first message'
            }
          >
            {quota?.unlimited
              ? 'Unlimited (dev)'
              : dailyRemaining != null
                ? `${dailyRemaining} left`
                : quota
                  ? '…'
                  : '—'}
          </div>
          <div className="coach-sheet__actions">
            {isPage ? (
              <>
                <IconButton
                  aria-label="Chat history"
                  size="sm"
                  variant="surface"
                  haptic="light"
                  onClick={openHistory}
                  style={{ width: 32, height: 32 }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 7 12 12 15 14" />
                  </svg>
                </IconButton>
                <IconButton
                  aria-label="New chat"
                  size="sm"
                  variant="surface"
                  haptic="light"
                  disabled={streaming}
                  onClick={newChat}
                  style={{ width: 32, height: 32 }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </IconButton>
              </>
            ) : (
              <IconButton
                aria-label="Open full Coach"
                size="sm"
                variant="surface"
                haptic="light"
                onClick={expandToPage}
                style={{ width: 32, height: 32 }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </IconButton>
            )}
            <IconButton
              aria-label="Close Coach"
              size="sm"
              variant="surface"
              haptic="light"
              onClick={closeCoach}
              style={{ width: 32, height: 32 }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconButton>
          </div>
        </header>

        <div className="coach-sheet__main">
          {isPage ? <CoachHistory /> : null}

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
                        <span
                          className="coach-bubble__pending"
                          aria-label="Thinking"
                        >
                          …
                        </span>
                      ) : m.role === 'assistant' ? (
                        <CoachMessageContent content={m.content} />
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
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </>
  )
}
