'use client'

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { COACH_MAX_MESSAGE_CHARS } from '@/lib/coach'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import {
  THEME_COLOR,
  refreshThemeColor,
  useTheme,
} from '@/lib/contexts/ThemeContext'
import { useExitingValue } from '@/lib/hooks/useExitingValue'
import { useKeyboardInset } from '@/lib/hooks/useKeyboardInset'
import IconButton from '@/components/ui/IconButton'
import CoachFabIcon from './CoachFabIcon'
import CoachHistory from './CoachHistory'
import CoachMessageContent from './CoachMessageContent'
import {
  RUBBER_FACTOR,
  SHEET_DISMISS_FLICK_VY,
  SHEET_FLICK_VY,
  SHEET_SETTLE_POS,
  SHEET_SETTLE_VEL,
  SHEET_SPRING_C,
  SHEET_SPRING_K,
  readTranslateY,
  sheetDismissThreshold,
  sheetExpandThreshold,
  sheetMinimizeThreshold,
} from './coachMotion'
import { useCoach } from './CoachProvider'

const CHIPS = [
  "How's my streak?",
  'Recent PRs?',
  'What did I do last workout?',
  'Am I progressing?',
] as const

/** Matches `.coach-sheet--closing` / backdrop fade duration */
const EXIT_MS = 560
const SIZE_MS = 640
const ENTER_MS = 640
const PULL_AXIS_LOCK = 8
const VEL_EMA = 0.78
/** 1:1 upward travel while expandable before light rubber-band. */
const EXPAND_RUBBER_AT = 160
/** Gravity-ish assist while flinging the sheet off-screen (px/s²). */
const FLING_GRAVITY = 2800

/**
 * Compact reset label for the header (fits beside actions).
 * Examples: `soon`, `12m`, `3h`, `3h20m`, `Aug 12`.
 */
function formatQuotaReset(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const ms = at.getTime() - Date.now()
  if (ms <= 0) return 'soon'
  const mins = Math.max(1, Math.ceil(ms / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 48) {
    // Drop minutes once we're past a few hours — header is tight.
    if (rem === 0 || hours >= 4) return `${hours}h`
    return `${hours}h${rem}m`
  }
  return at.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** Longer reset phrasing for banners / title tooltips. */
function formatQuotaResetLong(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const ms = at.getTime() - Date.now()
  if (ms <= 0) return 'soon'
  const mins = Math.max(1, Math.ceil(ms / 60_000))
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 48) {
    return rem === 0 ? `in ${hours}h` : `in ${hours}h ${rem}m`
  }
  return at.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatQuotaResetClock(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return at.toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Soft rubber at the top only. Downward travel stays 1:1 so the sheet can
 * slide past minimize and fully off-screen under the finger — no mid-drag
 * quantization.
 */
function rubberY(y: number, canExpand: boolean): number {
  if (y >= 0) return y
  // Already full-page — only a light upward rubber-band.
  if (!canExpand) return y * RUBBER_FACTOR
  const up = -y
  if (up <= EXPAND_RUBBER_AT) return y
  const extra = up - EXPAND_RUBBER_AT
  return -(EXPAND_RUBBER_AT + extra * RUBBER_FACTOR)
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
  const { theme } = useTheme()
  const keyboardInset = useKeyboardInset()
  const titleId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  /** Owns translateY for pull + gesture dismiss (independent of size classes). */
  const motionRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickBottom = useRef(true)
  const [draft, setDraft] = useState('')

  const exit = useExitingValue(open ? true : null, EXIT_MS)
  const mounted = exit.data != null
  // useExitingValue flips `closing` in an effect — one frame too late for
  // gesture dismiss, where clearing pullY before this flag lands snaps the
  // sheet back to translateY(0) (middle flash). Derive synchronously.
  const closing = mounted && !open
  const activelyOpen = open && !closing

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
  const settleRaf = useRef<number | null>(null)
  /** Keep drag offset through exit so the sheet doesn't jump before fade-out. */
  const [gestureDismissY, setGestureDismissY] = useState(0)
  /**
   * Latched for the whole gesture-dismiss → unmount window. Never derive
   * solely from Y>0 — clearing Y for one frame used to drop
   * `closing-from-drag` and replay coach-sheet-out from translateY(0).
   */
  const [gestureDismissActive, setGestureDismissActive] = useState(false)
  const gestureDismissActiveRef = useRef(false)
  /** Backdrop opacity at gesture-dismiss commit — fade from here, not from 1. */
  const [dismissBackdropOpacity, setDismissBackdropOpacity] = useState<
    number | null
  >(null)
  const [backdropOut, setBackdropOut] = useState(false)
  /** Opacity fade on the motion shell after drag-off (no transform keyframes). */
  const [dragFadeOut, setDragFadeOut] = useState(false)
  /** Page sheet has no scrim until a pull-to-close fling starts. */
  const [pullDismissing, setPullDismissing] = useState(false)

  // Freeze size for the exit window — closeCoach resets to compact immediately,
  // which would otherwise snap a full-page sheet mid-fade.
  const [visualSize, setVisualSize] = useState(size)
  if (activelyOpen && visualSize !== size) {
    setVisualSize(size)
  }

  const isPage = visualSize === 'page'
  // Do NOT push --surface into theme-color while the page sheet is open.
  // The safe-area band is already painted --bg; overriding chrome to surface
  // is what left iOS PWAs stuck on olive/gray after close. Heal on page exit
  // so WebKit re-samples app --bg once the sheet is gone.
  useEffect(() => {
    if (!closing || !isPage) return
    refreshThemeColor()
  }, [closing, isPage])
  const dailyRemaining = quota?.dailyRemaining
  const dailyLimit = quota?.dailyLimit
  const resetRelative = formatQuotaReset(quota?.dailyResetsAt)
  const resetLong = formatQuotaResetLong(quota?.dailyResetsAt)
  const resetClock = formatQuotaResetClock(quota?.dailyResetsAt)
  const capped =
    !quota?.unlimited && dailyRemaining != null && dailyRemaining <= 0
  const sendDisabled =
    !draft.trim() || streaming || capped || configured === false

  // Header is tight beside actions — keep copy short; full detail in title.
  // Unlimited/dev: never show N/limit (denominator is meaningless when bypassed).
  const quotaLabel = (() => {
    if (!quota) return '—'
    const resetBit = resetRelative ? ` · ${resetRelative}` : ''
    if (quota.unlimited) {
      // Short "Dev · N left" — "Unlimited (dev) · N left · reset" overflowed.
      // Once past the normal window, remaining clamps at 0; don't show "0 left".
      if (dailyRemaining != null && dailyRemaining > 0) {
        return `Dev · ${dailyRemaining} left`
      }
      return `Dev · uncapped`
    }
    if (dailyRemaining != null) {
      // Prefer "N left" over "N/15" — fits better next to header actions.
      return `${dailyRemaining} left${resetBit}`
    }
    if (dailyLimit != null) return `—/${dailyLimit}`
    return '…'
  })()

  const quotaTitle = quota?.unlimited
    ? 'Dev toggle is on — the app’s 15/day limit is bypassed until you hit Gemini’s own free-tier quota. Remaining count is informational.'
    : resetClock
      ? `Coach messages left in the rolling 24h window — next slot frees around ${resetClock}`
      : 'Coach messages left in the rolling 24h window'
  const cancelSettle = useCallback(() => {
    if (settleRaf.current != null) {
      cancelAnimationFrame(settleRaf.current)
      settleRaf.current = null
    }
  }, [])

  // Clear dismiss leftovers on the rising edge of `open` only — never while a
  // fling is in progress (open is still true then, and wiping the latch
  // re-enabled coach-sheet-out → middle flash).
  const wasOpenRef = useRef(open)
  if (open && !wasOpenRef.current) {
    gestureDismissActiveRef.current = false
    if (gestureDismissActive) setGestureDismissActive(false)
    if (gestureDismissY !== 0) setGestureDismissY(0)
    if (dismissBackdropOpacity != null) setDismissBackdropOpacity(null)
    if (backdropOut) setBackdropOut(false)
    if (pullDismissing) setPullDismissing(false)
    if (dragFadeOut) setDragFadeOut(false)
    if (pullPhase === 'idle' && pullY !== 0) setPullY(0)
  }
  wasOpenRef.current = open
  // Idle reopen leftovers (e.g. interrupted non-gesture close).
  if (
    activelyOpen &&
    pullPhase === 'idle' &&
    !gestureDismissActive &&
    (gestureDismissY !== 0 ||
      dismissBackdropOpacity != null ||
      backdropOut ||
      pullDismissing ||
      dragFadeOut)
  ) {
    setGestureDismissY(0)
    setDismissBackdropOpacity(null)
    setBackdropOut(false)
    setPullDismissing(false)
    setDragFadeOut(false)
  }
  if (
    activelyOpen &&
    pullPhase === 'idle' &&
    !gestureDismissActive &&
    pullY !== 0
  ) {
    setPullY(0)
  }

  // After a pull-to-close, fade the scrim from the drag-dimmed opacity → 0
  // (CSS keyframes would restart at 1 and flash).
  useEffect(() => {
    if (!closing || dismissBackdropOpacity == null || reduceMotion) return
    const id = requestAnimationFrame(() => setBackdropOut(true))
    return () => cancelAnimationFrame(id)
  }, [closing, dismissBackdropOpacity, reduceMotion])

  // Gesture dismiss: opacity-only fade on the motion shell — never run
  // coach-sheet-out (its from{translateY(0)} is the middle flash).
  useEffect(() => {
    if (!closing || !gestureDismissActive || reduceMotion) return
    const id = requestAnimationFrame(() => setDragFadeOut(true))
    return () => cancelAnimationFrame(id)
  }, [closing, gestureDismissActive, reduceMotion])

  // Focus after the enter spring settles so iOS keyboard + visualViewport pan
  // can't fight the open animation (or strand the composer under the keyboard).
  useEffect(() => {
    if (!open || closing) return
    const t = window.setTimeout(
      () => {
        inputRef.current?.focus()
      },
      reduceMotion ? 0 : ENTER_MS,
    )
    return () => window.clearTimeout(t)
  }, [open, closing, reduceMotion])

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

  useEffect(() => () => cancelSettle(), [cancelSettle])

  const springPullToZero = useCallback(
    (fromY: number, fromVy: number) => {
      cancelSettle()
      if (reduceMotion || Math.abs(fromY) < 0.5) {
        pullYRef.current = 0
        setPullY(0)
        setPullPhase('idle')
        return
      }
      setPullPhase('settling')
      let y = fromY
      let v = fromVy * 0.25
      const tick = () => {
        const dt = 1 / 60
        const a = -SHEET_SPRING_K * y - SHEET_SPRING_C * v
        v += a * dt
        y += v * dt
        pullYRef.current = y
        setPullY(y)
        if (Math.abs(y) < SHEET_SETTLE_POS && Math.abs(v) < SHEET_SETTLE_VEL) {
          pullYRef.current = 0
          setPullY(0)
          setPullPhase('idle')
          settleRaf.current = null
          return
        }
        settleRaf.current = requestAnimationFrame(tick)
      }
      settleRaf.current = requestAnimationFrame(tick)
    },
    [cancelSettle, reduceMotion],
  )

  /**
   * Continue the pull motion off-screen, then close — same physical sheet,
   * not a snappy cut/fade in place. Never reset translateY to 0 before exit.
   * Gesture dismiss owns Y on the motion shell until unmount; CSS transform
   * exit keyframes are banned for this path (middle flash).
   */
  const flingOffAndClose = useCallback(
    (fromY: number, fromVy: number) => {
      cancelSettle()
      const h = sheetH.current || sheetRef.current?.offsetHeight || 400
      sheetH.current = h
      const offY = Math.max(fromY + 48, h + 24)
      const dismissAt = sheetDismissThreshold(h)
      const progress = Math.min(1, Math.max(0, fromY) / dismissAt)
      setDismissBackdropOpacity(0.45 * (1 - progress * 0.85))
      setBackdropOut(false)
      setDragFadeOut(false)
      setPullDismissing(true)
      // Latch before closeCoach so the first closing render already has
      // closing-from-drag / held Y — no frame of coach-sheet-out at rest.
      gestureDismissActiveRef.current = true
      setGestureDismissActive(true)

      if (reduceMotion) {
        // Jump-unmount from the finger offset — no settle-to-0 flash.
        const holdY = Math.max(fromY, 1)
        setGestureDismissY(holdY)
        pullYRef.current = holdY
        setPullY(holdY)
        setPullPhase('idle')
        closeCoach()
        return
      }

      setPullPhase('settling')
      let y = fromY
      // Keep downward momentum; never reverse into a bounce on dismiss.
      let v = Math.max(fromVy, 520)
      const tick = () => {
        const dt = 1 / 60
        v += FLING_GRAVITY * dt
        y += v * dt
        pullYRef.current = y
        setPullY(y)
        if (y >= offY) {
          // Hold the off-screen offset through closeCoach → exit. Clearing
          // pullY here used to flash the sheet at rest for one frame.
          const holdY = y
          setGestureDismissY(holdY)
          pullYRef.current = holdY
          setPullY(holdY)
          setPullPhase('idle')
          settleRaf.current = null
          closeCoach()
          // Keep sliding a bit further during the exit fade (Y only goes down).
          requestAnimationFrame(() => {
            const extra = holdY + Math.min(v * 0.18, 120)
            setGestureDismissY(prev => Math.max(prev, extra))
            pullYRef.current = Math.max(pullYRef.current, extra)
            setPullY(prev => Math.max(prev, extra))
          })
          return
        }
        settleRaf.current = requestAnimationFrame(tick)
      }
      settleRaf.current = requestAnimationFrame(tick)
    },
    [cancelSettle, closeCoach, reduceMotion],
  )

  /**
   * X / backdrop — cancel any in-flight settle so CSS exit doesn't fight a
   * leftover translateY (or flash through rest on settle→0). Escape uses a
   * history-first path separately.
   */
  const requestClose = useCallback(() => {
    if (closing || gestureDismissActiveRef.current) return
    cancelSettle()
    const y = pullYRef.current
    // Mid-pull / mid-settle with meaningful offset → continue as gesture dismiss
    // so Y never snaps to 0 under coach-sheet-out.
    if (
      (pullPhase === 'dragging' || pullPhase === 'settling') &&
      y > 24
    ) {
      flingOffAndClose(y, Math.max(velY.current, 520))
      return
    }
    pullYRef.current = 0
    setPullY(0)
    setPullPhase('idle')
    setPullDismissing(false)
    setGestureDismissY(0)
    closeCoach()
  }, [cancelSettle, closeCoach, closing, flingOffAndClose, pullPhase])

  useEffect(() => {
    if (!open || closing) return
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (historyOpen) {
        closeHistory()
        return
      }
      requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closing, historyOpen, closeHistory, requestClose])

  const beginPull = useCallback(
    (e: ReactPointerEvent, fromBody: boolean) => {
      // Interruptible: allow grab during settle / enter (not while closing).
      if (closing || historyOpen || gestureDismissActiveRef.current) return
      if (fromBody) {
        const el = listRef.current
        if (el && el.scrollTop > 0) return
      }
      // Don't steal clicks from header action buttons / links.
      const t = e.target as HTMLElement | null
      if (t?.closest('button, a, textarea, input')) return

      // Capture live offset before killing enter/settle motion (motion shell
      // owns Y during pull; fall back to sheet for enter-keyframe interrupts).
      const liveY =
        pullPhase === 'dragging' || pullPhase === 'settling'
          ? pullYRef.current
          : readTranslateY(motionRef.current) ||
            readTranslateY(sheetRef.current)
      cancelSettle()
      setPullDismissing(false)
      setDismissBackdropOpacity(null)

      pointerId.current = e.pointerId
      // Map finger so dy continues from the interrupted visual offset.
      pullStart.current = { x: e.clientX, y: e.clientY - liveY }
      axis.current = null
      lastY.current = e.clientY
      lastTs.current = performance.now()
      velY.current = 0
      pullYRef.current = liveY
      setPullY(liveY)
      if (liveY !== 0) setPullPhase('dragging')
      sheetH.current = sheetRef.current?.offsetHeight ?? 400
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      } catch {
        // ignore
      }
    },
    [cancelSettle, closing, historyOpen, pullPhase],
  )

  const onPullMove = useCallback(
    (e: ReactPointerEvent) => {
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
      const next = rubberY(dy, size !== 'page')
      pullYRef.current = next
      setPullY(next)
    },
    [size],
  )

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
      const minimizeAt = sheetMinimizeThreshold(h)
      const dismissAt = sheetDismissThreshold(h)
      const expandAt = sheetExpandThreshold(h)
      const flickedDown = vy > SHEET_FLICK_VY
      const flickedUp = vy < -SHEET_FLICK_VY
      const hardFlickDown = vy > SHEET_DISMISS_FLICK_VY

      let shouldClose = false
      let shouldCollapse = false
      let shouldExpand = false

      // Three resting ends: page (expanded), compact (mini), off-screen (closed).
      // Finger tracks 1:1 while down; release springs to the chosen end.
      // From page: anything in the minimize↔dismiss band → compact. Close only
      // past dismissAt OR a hard flick (soft flick alone never skips minimize).
      // From compact: further pull / soft flick closes; pull up expands.
      if (y < 0 || flickedUp) {
        if (size !== 'page' && (y < -expandAt || flickedUp)) {
          shouldExpand = true
        }
      } else if (size === 'page') {
        if (hardFlickDown || y > dismissAt) {
          shouldClose = true
        } else if (y > minimizeAt || flickedDown) {
          shouldCollapse = true
        }
      } else if (y > dismissAt || flickedDown) {
        shouldClose = true
      }

      if (shouldClose) {
        flingOffAndClose(y, vy)
        return
      }

      setGestureDismissY(0)
      setDismissBackdropOpacity(null)
      setPullDismissing(false)
      if (shouldExpand) {
        expandToPage()
      } else if (shouldCollapse) {
        setSize('compact')
      }

      // Critically damped settle back to rest (interruptible via beginPull).
      springPullToZero(y, vy)
    },
    [expandToPage, flingOffAndClose, setSize, size, springPullToZero],
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
  const settling = pullPhase === 'settling'
  // Latched for the entire dismiss→unmount window — never drop mid-exit.
  const fromDragDismiss =
    gestureDismissActive || gestureDismissActiveRef.current
  const motionY = (() => {
    if (dragging || settling || pullDismissing || fromDragDismiss) {
      // Never let Y collapse to 0 while dismissing — that's the middle flash.
      const y = Math.max(pullY, gestureDismissY, fromDragDismiss ? 1 : 0)
      return y
    }
    return 0
  })()

  const origin =
    dock === 'tl' || dock === 'bl' ? 'bottom left' : 'bottom right'

  // Size morph only — Y lives on the motion shell, never on CSS exit keyframes
  // for gesture dismiss (coach-sheet-out from{translateY(0)} = middle flash).
  const sheetTransition = (() => {
    if (reduceMotion || dragging || settling || fromDragDismiss) return 'none'
    if (closing) return 'none'
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
    return parts.join(', ')
  })()

  // Backdrop fades with drag progress toward dismiss; CSS owns exit fade.
  const dismissProgress =
    (dragging || settling || pullDismissing) && pullY > 0
      ? Math.min(1, pullY / sheetDismissThreshold(sheetH.current || 400))
      : 0
  const backdropOpacity = 0.45 * (1 - dismissProgress * 0.85)

  // Compact sheet always has a scrim; full page does not (except gesture-dismiss
  // from compact, which keeps the dimmed scrim through the exit).
  const showBackdrop = !isPage || fromDragDismiss || pullDismissing

  // Lift fixed sheet above the iOS keyboard so autofocus can't bury the composer.
  // Top-docked desktop cards use `top`/`bottom:auto` — don't override bottom there.
  const topDocked = dock === 'tl' || dock === 'tr'
  const sheetKeyboardStyle =
    !closing && keyboardInset > 0
      ? isPage
        ? ({ paddingBottom: keyboardInset } as const)
        : !topDocked
          ? ({ bottom: keyboardInset + 12 } as const)
          : undefined
      : undefined

  const motionStyle: CSSProperties = {
    transform:
      motionY !== 0 ? `translate3d(0, ${motionY}px, 0)` : undefined,
    // Hold Y with no transform transition — a transition to identity was a
    // second flash path when the class/Y handoff glitched for one frame.
    transition:
      !reduceMotion && closing && fromDragDismiss
        ? `opacity 480ms cubic-bezier(0.22, 1, 0.36, 1)`
        : 'none',
    opacity:
      closing && fromDragDismiss
        ? reduceMotion || dragFadeOut
          ? 0
          : 1
        : undefined,
    pointerEvents: closing ? 'none' : undefined,
  }

  return (
    <>
      {/* Fixed --bg band under the status bar while the page sheet (incl. exit)
          is mounted. Stops iOS from sampling --surface / accent wash into the
          chrome after the sheet slides/fades away. */}
      {mounted && isPage ? (
        <div
          className="coach-status-bar-heal"
          style={{ backgroundColor: THEME_COLOR[theme] }}
          aria-hidden
        />
      ) : null}
      {showBackdrop ? (
        <button
          type="button"
          className={`coach-backdrop${closing ? ' coach-backdrop--closing' : ''}${
            closing && fromDragDismiss
              ? ' coach-backdrop--closing-from-drag'
              : ''
          }`}
          aria-label="Close Coach"
          onClick={requestClose}
          style={
            !reduceMotion &&
            (dragging || settling || pullDismissing) &&
            pullY > 0
              ? { opacity: backdropOpacity, transition: 'none' }
              : !reduceMotion && closing && dismissBackdropOpacity != null
                ? {
                    opacity: backdropOut ? 0 : dismissBackdropOpacity,
                    transition: backdropOut
                      ? 'opacity 480ms cubic-bezier(0.22, 1, 0.36, 1)'
                      : 'none',
                  }
                : undefined
          }
          tabIndex={closing ? -1 : 0}
          disabled={closing}
        />
      ) : null}
      <div
        ref={motionRef}
        className={`coach-sheet-motion${
          fromDragDismiss ? ' coach-sheet-motion--drag-dismiss' : ''
        }`}
        style={motionStyle}
      >
      <div
        ref={sheetRef}
        className={`coach-sheet coach-sheet--${visualSize}${
          closing ? ' coach-sheet--closing' : ''
        }${fromDragDismiss ? ' coach-sheet--closing-from-drag' : ''}${
          dragging ? ' coach-sheet--pulling' : ''
        }`}
        data-dock={dock}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          transformOrigin: origin,
          transition: sheetTransition,
          ...sheetKeyboardStyle,
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
            title={quotaTitle}
          >
            {quotaLabel}
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
              onClick={requestClose}
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
                {capped ? (
                  <div className="coach-sheet__quota-banner" role="status">
                    <p className="coach-sheet__quota-banner-title">
                      Daily Coach limit reached
                    </p>
                    <p className="coach-sheet__quota-banner-body">
                      You’ve used all {quota?.dailyLimit ?? 15} messages in the
                      current window.
                      {resetLong
                        ? ` Chat with GRIND Coach again ${resetLong}${
                            resetClock ? ` (around ${resetClock})` : ''
                          }.`
                        : ' Chat again after the rolling 24-hour window resets.'}
                    </p>
                  </div>
                ) : (
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
                )}
              </div>
            ) : (
              <ul className="coach-sheet__messages">
                {messages.map((m, i) => {
                  const waiting =
                    m.role === 'assistant' && !m.content && streaming
                  return (
                    <li
                      key={m.id}
                      className={`coach-bubble coach-bubble--${m.role}${
                        m.role === 'assistant' ? ' coach-bubble--enter' : ''
                      }`}
                      style={
                        {
                          '--i': Math.min(i, 8),
                        } as CSSProperties
                      }
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
                {capped ? (
                  <li className="coach-sheet__quota-banner" role="status">
                    <p className="coach-sheet__quota-banner-title">
                      Daily Coach limit reached
                    </p>
                    <p className="coach-sheet__quota-banner-body">
                      You’ve used all {quota?.dailyLimit ?? 15} messages in the
                      current window.
                      {resetLong
                        ? ` Chat with GRIND Coach again ${resetLong}${
                            resetClock ? ` (around ${resetClock})` : ''
                          }.`
                        : ' Chat again after the rolling 24-hour window resets.'}
                    </p>
                  </li>
                ) : null}
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
            disabled={streaming || capped || configured === false}
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
      </div>
    </>
  )
}
