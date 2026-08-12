'use client'

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { COACH_MAX_MESSAGE_CHARS } from '@/lib/coach'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import { useExitingValue } from '@/lib/hooks/useExitingValue'
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

/** Matches `.coach-sheet--closing` / backdrop fade duration */
const EXIT_MS = 480
const SIZE_MS = 500
const SETTLE_MS = 420
const PULL_AXIS_LOCK = 8
const FLICK_VY = 900
const VEL_EMA = 0.78

function rubberY(y: number): number {
  if (y < 0) return y * 0.28
  // Soft resistance past ~240px so dismiss still reaches threshold.
  if (y <= 240) return y
  const extra = y - 240
  return 240 + extra * 0.35
}

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
    setSize,
    sendMessage,
    clearError,
    newChat,
    openHistory,
    closeHistory,
  } = useCoach()
  const { reduceMotion } = useMotionPref()
  const titleId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickBottom = useRef(true)
  const [draft, setDraft] = useState('')

  const exit = useExitingValue(open ? true : null, EXIT_MS)
  const mounted = exit.data != null
  const closing = exit.closing

  type PullPhase = 'idle' | 'dragging' | 'settling'
  const [pullY, setPullY] = useState(0)
  const [pullPhase, setPullPhase] = useState<PullPhase>('idle')
  const pointerId = useRef<number | null>(null)
  const pullStart = useRef<{ x: number; y: number } | null>(null)
  const axis = useRef<'y' | 'x' | null>(null)
  const lastY = useRef(0)
  const lastTs = useRef(0)
  const velY = useRef(0)
  const pullYRef = useRef(0)
  const sheetH = useRef(0)
  const settleTimer = useRef<number | null>(null)
  /** Keep drag offset through exit so the sheet doesn't jump before fade-out. */
  const [gestureDismissY, setGestureDismissY] = useState(0)
  /** Backdrop opacity at gesture-dismiss commit — fade from here, not from 1. */
  const [dismissBackdropOpacity, setDismissBackdropOpacity] = useState<
    number | null
  >(null)
  const [backdropOut, setBackdropOut] = useState(false)

  // Freeze size for the exit window — closeCoach resets to compact immediately,
  // which would otherwise snap a full-page sheet mid-fade.
  const [visualSize, setVisualSize] = useState(size)
  if (open && !closing && visualSize !== size) {
    setVisualSize(size)
  }
  const isPage = visualSize === 'page'
  const dailyRemaining = quota?.dailyRemaining
  const capped =
    !quota?.unlimited && dailyRemaining != null && dailyRemaining <= 0
  const sendDisabled =
    !draft.trim() || streaming || capped || configured === false

  // Clear gesture-dismiss offset whenever a fresh open starts.
  if (
    open &&
    !closing &&
    (gestureDismissY !== 0 || dismissBackdropOpacity != null || backdropOut)
  ) {
    setGestureDismissY(0)
    setDismissBackdropOpacity(null)
    setBackdropOut(false)
  }

  // After a pull-to-close, fade the scrim from the drag-dimmed opacity → 0
  // (CSS keyframes would restart at 1 and flash).
  useEffect(() => {
    if (!closing || dismissBackdropOpacity == null || reduceMotion) return
    const id = requestAnimationFrame(() => setBackdropOut(true))
    return () => cancelAnimationFrame(id)
  }, [closing, dismissBackdropOpacity, reduceMotion])

  useEffect(() => {
    if (!open || closing) return
    const t = window.setTimeout(
      () => {
        inputRef.current?.focus()
      },
      reduceMotion ? 0 : 80,
    )
    return () => window.clearTimeout(t)
  }, [open, closing, reduceMotion, size])

  useEffect(() => {
    if (!open || closing) return
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
  }, [open, closing, historyOpen, closeCoach, closeHistory])

  useEffect(() => {
    if (!open || closing || !listRef.current) return
    if (!stickBottom.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, streaming, open, closing, size])

  // Lock body scroll while the full Coach page is open (iOS PWA).
  useEffect(() => {
    if (!open || closing || !isPage) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
      // Heal any residual visual-viewport pan from the focused composer when
      // the page sheet unmounts (close, or collapse back to compact).
      try {
        window.scrollTo(window.scrollX, window.scrollY)
      } catch {
        // ignore
      }
    }
  }, [open, closing, isPage])

  useEffect(
    () => () => {
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current)
    },
    [],
  )

  const beginPull = useCallback(
    (e: ReactPointerEvent, fromBody: boolean) => {
      if (closing || pullPhase === 'settling' || historyOpen) return
      if (fromBody) {
        const el = listRef.current
        if (el && el.scrollTop > 0) return
      }
      // Don't steal clicks from header action buttons / links.
      const t = e.target as HTMLElement | null
      if (t?.closest('button, a, textarea, input')) return

      pointerId.current = e.pointerId
      pullStart.current = { x: e.clientX, y: e.clientY }
      axis.current = null
      lastY.current = e.clientY
      lastTs.current = performance.now()
      velY.current = 0
      sheetH.current = sheetRef.current?.offsetHeight ?? 400
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      } catch {
        // ignore
      }
    },
    [closing, historyOpen, pullPhase],
  )

  const onPullMove = useCallback((e: ReactPointerEvent) => {
    if (pointerId.current !== e.pointerId || !pullStart.current) return
    const dx = e.clientX - pullStart.current.x
    const dy = e.clientY - pullStart.current.y

    if (!axis.current) {
      if (Math.abs(dx) < PULL_AXIS_LOCK && Math.abs(dy) < PULL_AXIS_LOCK) {
        return
      }
      axis.current = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x'
      if (axis.current === 'y') {
        setPullPhase('dragging')
      }
    }
    if (axis.current !== 'y') return

    e.preventDefault()
    const now = performance.now()
    const dt = Math.max(1, now - lastTs.current)
    const ivy = ((e.clientY - lastY.current) / dt) * 1000
    velY.current = velY.current * VEL_EMA + ivy * (1 - VEL_EMA)
    lastY.current = e.clientY
    lastTs.current = now
    const next = rubberY(dy)
    pullYRef.current = next
    setPullY(next)
  }, [])

  const endPull = useCallback(
    (e: ReactPointerEvent) => {
      if (pointerId.current !== e.pointerId) return
      pointerId.current = null
      const start = pullStart.current
      pullStart.current = null
      const locked = axis.current
      axis.current = null
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
      } catch {
        // ignore
      }

      if (locked !== 'y' || start == null) {
        setPullPhase('idle')
        pullYRef.current = 0
        setPullY(0)
        return
      }

      const y = pullYRef.current
      const vy = velY.current
      const h = sheetH.current || 400
      const collapseThreshold = Math.max(56, h * 0.22)
      const closeThreshold = Math.max(110, h * 0.32)
      const flicked = vy > FLICK_VY

      let shouldClose = false
      let shouldCollapse = false

      // page → compact; compact (or a hard flick from page) → close
      if (size === 'page') {
        if (y > closeThreshold || vy > FLICK_VY * 1.25) {
          shouldClose = true
        } else if (y > collapseThreshold || flicked) {
          shouldCollapse = true
        }
      } else if (y > closeThreshold || flicked) {
        shouldClose = true
      }

      if (shouldClose) {
        const closeAt = Math.max(110, h * 0.32)
        const progress = Math.min(1, Math.max(0, y) / closeAt)
        setDismissBackdropOpacity(0.45 * (1 - progress * 0.85))
        setGestureDismissY(y)
        setBackdropOut(false)
        setPullPhase('idle')
        closeCoach()
        return
      }

      setGestureDismissY(0)
      setDismissBackdropOpacity(null)
      if (shouldCollapse) {
        setSize('compact')
      }

      // Spring settle transform back to 0
      setPullPhase('settling')
      pullYRef.current = 0
      setPullY(0)
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(
        () => {
          setPullPhase('idle')
          settleTimer.current = null
        },
        reduceMotion ? 0 : SETTLE_MS,
      )
    },
    [closeCoach, reduceMotion, setSize, size],
  )

  if (!mounted) return null

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
  const dragging = pullPhase === 'dragging'
  const exitDismissY = closing ? gestureDismissY : 0
  const origin =
    dock === 'tl' || dock === 'bl' ? 'bottom left' : 'bottom right'

  const sheetTransition = (() => {
    if (reduceMotion || dragging) return 'none'
    const curve = 'cubic-bezier(0.22, 1, 0.36, 1)'
    const parts: string[] = [
      `inset ${SIZE_MS}ms ${curve}`,
      `height ${SIZE_MS}ms ${curve}`,
      `max-height ${SIZE_MS}ms ${curve}`,
      `width ${SIZE_MS}ms ${curve}`,
      `border-radius ${SIZE_MS}ms ${curve}`,
      `left ${SIZE_MS}ms ${curve}`,
      `right ${SIZE_MS}ms ${curve}`,
      `top ${SIZE_MS}ms ${curve}`,
      `bottom ${SIZE_MS}ms ${curve}`,
    ]
    if (pullPhase === 'settling') {
      parts.push(`transform ${SETTLE_MS}ms ${curve}`)
    }
    return parts.join(', ')
  })()

  // Backdrop fades with drag progress toward dismiss; CSS owns exit fade.
  // Use the compact close threshold (110px) so we don't read sheetH during render.
  const dismissProgress =
    dragging && pullY > 0 ? Math.min(1, pullY / 110) : 0
  const backdropOpacity = 0.45 * (1 - dismissProgress * 0.85)

  const sheetTransform = (() => {
    if (exitDismissY > 0) {
      return `translate3d(0, ${exitDismissY}px, 0)`
    }
    // Button-close exit uses CSS keyframes for translate; don't fight them.
    if (closing) return undefined
    if (pullY) return `translate3d(0, ${pullY}px, 0)`
    if (pullPhase === 'settling') return 'translate3d(0, 0, 0)'
    return undefined
  })()

  // Compact sheet always has a scrim; full page does not (except gesture-dismiss
  // from compact, which keeps the dimmed scrim through the exit).
  const showBackdrop = !isPage || exitDismissY > 0

  return (
    <>
      {showBackdrop ? (
        <button
          type="button"
          className={`coach-backdrop${closing ? ' coach-backdrop--closing' : ''}${
            closing && exitDismissY > 0
              ? ' coach-backdrop--closing-from-drag'
              : ''
          }`}
          aria-label="Close Coach"
          onClick={closeCoach}
          style={
            !reduceMotion && dragging && pullY > 0
              ? { opacity: backdropOpacity, transition: 'none' }
              : !reduceMotion && closing && dismissBackdropOpacity != null
                ? {
                    opacity: backdropOut ? 0 : dismissBackdropOpacity,
                    transition: backdropOut
                      ? 'opacity 420ms cubic-bezier(0.22, 1, 0.36, 1)'
                      : 'none',
                  }
                : undefined
          }
          tabIndex={closing ? -1 : 0}
          disabled={closing}
        />
      ) : null}
      <div
        ref={sheetRef}
        className={`coach-sheet coach-sheet--${visualSize}${
          closing ? ' coach-sheet--closing' : ''
        }${exitDismissY > 0 ? ' coach-sheet--closing-from-drag' : ''}${
          dragging ? ' coach-sheet--pulling' : ''
        }`}
        data-dock={dock}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          transformOrigin: origin,
          transition: sheetTransition,
          transform: sheetTransform,
        }}
      >
        <header
          className="coach-sheet__header"
          onPointerDown={e => beginPull(e, false)}
          onPointerMove={onPullMove}
          onPointerUp={endPull}
          onPointerCancel={endPull}
        >
          <div className="coach-sheet__grabber" aria-hidden />
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
            onPointerDown={e => beginPull(e, true)}
            onPointerMove={onPullMove}
            onPointerUp={endPull}
            onPointerCancel={endPull}
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
