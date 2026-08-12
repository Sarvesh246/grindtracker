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

function safeInsetPx(side: 'top' | 'bottom'): number {
  if (typeof document === 'undefined') return 0
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);' +
    'padding-bottom:env(safe-area-inset-bottom);'
  document.documentElement.appendChild(probe)
  const cs = getComputedStyle(probe)
  const n = parseFloat(side === 'top' ? cs.paddingTop : cs.paddingBottom)
  probe.remove()
  return Number.isFinite(n) ? n : 0
}

/** Compact sheet resting box — mirrors `.coach-sheet` / desktop dock rules. */
function compactRestRect(dock: 'tl' | 'tr' | 'bl' | 'br'): {
  top: number
  left: number
  width: number
  height: number
} {
  const w = window.innerWidth
  const h = window.innerHeight
  const safeTop = safeInsetPx('top')
  const safeBottom = safeInsetPx('bottom')
  let desktop = false
  try {
    desktop = window.matchMedia('(min-width: 768px)').matches
  } catch {
    desktop = false
  }

  if (desktop) {
    const width = 380
    const height = 440
    const left = dock === 'bl' || dock === 'tl' ? 16 : w - 16 - width
    if (dock === 'tl' || dock === 'tr') {
      return {
        top: 72 + safeTop + 16,
        left,
        width,
        height,
      }
    }
    return {
      top: h - (16 + safeBottom) - height,
      left,
      width,
      height,
    }
  }

  const left = 12
  const width = Math.max(0, w - 24)
  const height = Math.min(h * 0.52, 420)
  const bottom = 12 + safeBottom
  return {
    top: h - bottom - height,
    left,
    width,
    height,
  }
}

/** Full-page sheet resting box — mirrors `.coach-sheet--page` (inset 0). */
function pageRestRect(): {
  top: number
  left: number
  width: number
  height: number
} {
  return {
    top: 0,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

type SheetRect = {
  top: number
  left: number
  width: number
  height: number
}

/** Upward pull (px) from compact rest height to full-page rest height. */
function expandSpanPx(dock: 'tl' | 'tr' | 'bl' | 'br'): number {
  const rest = compactRestRect(dock)
  const page = pageRestRect()
  return Math.max(1, page.height - rest.height)
}

/**
 * Live compact→page drag preview. Grows the sheet upward from the compact
 * bottom edge so the grabber tracks the finger (translate-only looked like
 * the card sliding off-screen, and never changed height). Once the top hits
 * the page edge, further pull expands the bottom until full page height —
 * rubber only applies past that span.
 */
function expandPreviewRect(
  dock: 'tl' | 'tr' | 'bl' | 'br',
  pullY: number,
): SheetRect {
  const rest = compactRestRect(dock)
  const page = pageRestRect()
  const up = Math.max(0, -pullY)
  const span = Math.max(1, page.height - rest.height)
  const p = Math.min(1, up / span)

  // 1:1 height growth with upward pull. Top follows until page.top, then
  // stays pinned while the bottom expands to reach page.height.
  let height = Math.min(page.height, rest.height + up)
  let top = rest.top + rest.height - height
  if (top < page.top) {
    top = page.top
    height = Math.min(page.height, rest.height + up)
  }
  if (height >= page.height) {
    height = page.height
    top = page.top
  }

  let left = rest.left + (page.left - rest.left) * p
  let width = rest.width + (page.width - rest.width) * p

  if (width > page.width) {
    width = page.width
    left = page.left
  } else {
    left = Math.min(
      Math.max(left, page.left),
      page.left + page.width - width,
    )
  }

  return { top, left, width, height }
}

/**
 * Soft rubber past extents only. Downward travel stays 1:1 so the sheet can
 * slide past minimize and fully off-screen under the finger. While expandable,
 * upward travel is 1:1 through `expandLimit` (compact→page span); light rubber
 * only past full page — never before the grabber can reach the top.
 */
function rubberY(y: number, canExpand: boolean, expandLimit: number): number {
  if (y >= 0) return y
  // Already full-page — only a light upward rubber-band.
  if (!canExpand) return y * RUBBER_FACTOR
  const up = -y
  const limit = Math.max(1, expandLimit)
  if (up <= limit) return y
  const extra = up - limit
  return -(limit + extra * RUBBER_FACTOR)
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
  /** True while a pull-to-close fling owns the scrim fade. */
  const [pullDismissing, setPullDismissing] = useState(false)
  /**
   * Opt-in enter keyframes for sheet + backdrop. Latched off after the first
   * open spring so page↔compact never replays coach-sheet-in / backdrop-in.
   */
  const [playEnter, setPlayEnter] = useState(true)
  /**
   * FLIP lock for page↔compact: pixel box matching the dragged frame so the
   * size-class swap doesn't jump the sheet to the target resting slot.
   */
  const [morphLock, setMorphLock] = useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)
  /** True while height/inset CSS is morphing toward page or compact rest. */
  const [sizeMorphing, setSizeMorphing] = useState(false)
  const morphTimer = useRef<number | null>(null)

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
  // Unlimited/dev: label only — dailyRemaining is still computed against the
  // standard 15 cap and is misleading once bypassed (e.g. "11 left").
  const quotaLabel = (() => {
    if (!quota) return '—'
    const resetBit = resetRelative ? ` · ${resetRelative}` : ''
    if (quota.unlimited) return 'Dev (unlimited)'
    if (dailyRemaining != null) {
      // Prefer "N left" over "N/15" — fits better next to header actions.
      return `${dailyRemaining} left${resetBit}`
    }
    if (dailyLimit != null) return `—/${dailyLimit}`
    return '…'
  })()

  const quotaTitle = quota?.unlimited
    ? 'Dev toggle is on — the app’s 15/day limit is bypassed until you hit Gemini’s own free-tier quota.'
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
    if (morphLock) setMorphLock(null)
    if (sizeMorphing) setSizeMorphing(false)
    if (pullPhase === 'idle' && pullY !== 0) setPullY(0)
    // Fresh open — allow enter keyframes once (sheet state survives unmount
    // of the portal contents via `mounted`, so this must be re-armed).
    setPlayEnter(true)
  }
  wasOpenRef.current = open
  // Idle reopen leftovers (e.g. interrupted non-gesture close).
  if (
    activelyOpen &&
    pullPhase === 'idle' &&
    !gestureDismissActive &&
    !sizeMorphing &&
    !morphLock &&
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
    !sizeMorphing &&
    !morphLock &&
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

  // Drop enter classes after the open spring so later size swaps stay quiet.
  useEffect(() => {
    if (!open || closing || !playEnter) return
    if (reduceMotion) {
      setPlayEnter(false)
      return
    }
    const t = window.setTimeout(() => setPlayEnter(false), ENTER_MS)
    return () => window.clearTimeout(t)
  }, [open, closing, playEnter, reduceMotion])

  useEffect(
    () => () => {
      if (morphTimer.current != null) window.clearTimeout(morphTimer.current)
    },
    [],
  )

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
   * Spring a FLIP-locked pixel box to a resting rect (page or compact).
   * Caller already set morphLock to `from` and swapped size classes.
   */
  const springMorphBox = useCallback(
    (
      from: { top: number; left: number; width: number; height: number },
      to: { top: number; left: number; width: number; height: number },
    ) => {
      let top = from.top
      let left = from.left
      let width = from.width
      let height = from.height
      let vTop = 0
      let vLeft = 0
      let vW = 0
      let vH = 0

      const tick = () => {
        const dt = 1 / 60
        const step = (
          cur: number,
          target: number,
          vel: number,
        ): [number, number] => {
          const a = -SHEET_SPRING_K * (cur - target) - SHEET_SPRING_C * vel
          const nextV = vel + a * dt
          return [cur + nextV * dt, nextV]
        }
        ;[top, vTop] = step(top, to.top, vTop)
        ;[left, vLeft] = step(left, to.left, vLeft)
        ;[width, vW] = step(width, to.width, vW)
        ;[height, vH] = step(height, to.height, vH)

        const done =
          Math.abs(top - to.top) < SHEET_SETTLE_POS &&
          Math.abs(left - to.left) < SHEET_SETTLE_POS &&
          Math.abs(width - to.width) < SHEET_SETTLE_POS &&
          Math.abs(height - to.height) < SHEET_SETTLE_POS &&
          Math.abs(vTop) < SHEET_SETTLE_VEL &&
          Math.abs(vLeft) < SHEET_SETTLE_VEL &&
          Math.abs(vW) < SHEET_SETTLE_VEL &&
          Math.abs(vH) < SHEET_SETTLE_VEL

        if (done) {
          setMorphLock(null)
          setSizeMorphing(false)
          settleRaf.current = null
          return
        }
        setMorphLock({ top, left, width, height })
        settleRaf.current = requestAnimationFrame(tick)
      }
      settleRaf.current = requestAnimationFrame(tick)
    },
    [],
  )

  /**
   * Page → compact without a bottom pop-in: lock the current visual rect
   * (includes pull translate), clear pullY, swap to compact classes, then
   * spring the locked box to compact resting geometry — one continuous sheet.
   */
  const morphToCompact = useCallback(
    (fromY: number) => {
      cancelSettle()
      setPlayEnter(false)
      setGestureDismissY(0)
      setDismissBackdropOpacity(null)
      setPullDismissing(false)

      if (reduceMotion) {
        if (morphTimer.current != null) window.clearTimeout(morphTimer.current)
        setMorphLock(null)
        setSizeMorphing(false)
        pullYRef.current = 0
        setPullY(0)
        setPullPhase('idle')
        setSize('compact')
        return
      }

      const sheet = sheetRef.current
      const rect = sheet?.getBoundingClientRect()
      if (!rect || rect.height < 8) {
        setSize('compact')
        springPullToZero(fromY, 0)
        return
      }

      if (morphTimer.current != null) window.clearTimeout(morphTimer.current)
      pullYRef.current = 0
      setPullY(0)
      setPullPhase('idle')

      const from = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }
      setMorphLock(from)
      setSizeMorphing(true)
      setSize('compact')
      springMorphBox(from, compactRestRect(dock))
    },
    [
      cancelSettle,
      dock,
      reduceMotion,
      setSize,
      springMorphBox,
      springPullToZero,
    ],
  )

  /**
   * Compact → page without a remount/enter pop: same FLIP as minimize.
   * Lock the dragged expand-preview frame (or current layout), clear pullY,
   * swap to page classes, spring the locked box to full-page geometry —
   * never springPullToZero across a size swap (that + page class was the
   * expand flash).
   */
  const morphToPage = useCallback(
    (fromY: number) => {
      cancelSettle()
      setPlayEnter(false)
      setGestureDismissY(0)
      setDismissBackdropOpacity(null)
      setPullDismissing(false)

      if (reduceMotion) {
        if (morphTimer.current != null) window.clearTimeout(morphTimer.current)
        setMorphLock(null)
        setSizeMorphing(false)
        pullYRef.current = 0
        setPullY(0)
        setPullPhase('idle')
        expandToPage()
        return
      }

      // Prefer the same geometry the finger was driving (expand preview).
      // getBoundingClientRect alone was wrong when motionY was clamped to 0
      // and height never grew — FLIP then sprang from the resting compact
      // card and felt like a snap-to-top after release.
      const sheet = sheetRef.current
      const rect = sheet?.getBoundingClientRect()
      const from: SheetRect =
        fromY < 0
          ? expandPreviewRect(dock, fromY)
          : rect && rect.height >= 8
            ? {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
              }
            : compactRestRect(dock)

      if (from.height < 8) {
        expandToPage()
        springPullToZero(fromY, 0)
        return
      }

      if (morphTimer.current != null) window.clearTimeout(morphTimer.current)
      pullYRef.current = 0
      setPullY(0)
      setPullPhase('idle')

      setMorphLock(from)
      setSizeMorphing(true)
      expandToPage()
      springMorphBox(from, pageRestRect())
    },
    [
      cancelSettle,
      dock,
      expandToPage,
      reduceMotion,
      springMorphBox,
      springPullToZero,
    ],
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
      if (morphTimer.current != null) {
        window.clearTimeout(morphTimer.current)
        morphTimer.current = null
      }
      setMorphLock(null)
      setSizeMorphing(false)
      setPlayEnter(false)
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
    if (morphTimer.current != null) {
      window.clearTimeout(morphTimer.current)
      morphTimer.current = null
    }
    setMorphLock(null)
    setSizeMorphing(false)
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

      // Capture live offset before killing enter/settle/morph motion.
      let liveY =
        pullPhase === 'dragging' || pullPhase === 'settling'
          ? pullYRef.current
          : readTranslateY(motionRef.current) ||
            readTranslateY(sheetRef.current)
      // Mid size morph / expand-preview box: convert visual top → pullY so
      // the finger continues from the same frame (not resting compact).
      if (sizeMorphing || morphLock) {
        const rect = sheetRef.current?.getBoundingClientRect()
        if (rect) {
          const rest =
            size === 'page' ? pageRestRect() : compactRestRect(dock)
          liveY = rect.top - rest.top
        }
      } else if (
        size !== 'page' &&
        (pullPhase === 'dragging' || pullPhase === 'settling') &&
        pullYRef.current < 0
      ) {
        // Expand preview uses absolute geometry (motionY=0) — keep pullY.
        liveY = pullYRef.current
      }
      cancelSettle()
      // Interrupt an in-flight page→compact morph — finger takes over.
      if (morphTimer.current != null) {
        window.clearTimeout(morphTimer.current)
        morphTimer.current = null
      }
      if (morphLock) setMorphLock(null)
      if (sizeMorphing) setSizeMorphing(false)
      setPullDismissing(false)
      setDismissBackdropOpacity(null)
      setPlayEnter(false)

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
    [
      cancelSettle,
      closing,
      dock,
      historyOpen,
      morphLock,
      pullPhase,
      size,
      sizeMorphing,
    ],
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
      const next = rubberY(dy, size !== 'page', expandSpanPx(dock))
      pullYRef.current = next
      setPullY(next)
    },
    [dock, size],
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
        // Continuous morph — same as minimize; never springPullToZero across
        // the page class swap (that replayed a pop / enter from the wrong Y).
        morphToPage(y)
      } else if (shouldCollapse) {
        // Continuous morph — do NOT springPullToZero (that + compact class swap
        // was the bottom pop-in).
        morphToCompact(y)
      } else {
        springPullToZero(y, vy)
      }
    },
    [
      flingOffAndClose,
      morphToCompact,
      morphToPage,
      size,
      springPullToZero,
    ],
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

  /**
   * Compact drag-up: absolute growing box (height + top), not translateY.
   * Prior “fix” used Math.max(pullY, gestureDismissY) — gestureDismissY is 0
   * while idle, so every negative pullY became 0 and the sheet never moved
   * until release (then snapped via morphToPage).
   */
  const expandPreview =
    !isPage &&
    !morphLock &&
    (dragging || settling) &&
    pullY < 0
      ? expandPreviewRect(dock, pullY)
      : null
  const boxLock: SheetRect | null = morphLock ?? expandPreview

  const motionY = (() => {
    if (!(dragging || settling || pullDismissing || fromDragDismiss)) return 0
    if (fromDragDismiss || pullDismissing) {
      // Dismiss only travels down — never allow a negative hold to flash.
      return Math.max(pullY, gestureDismissY, 1)
    }
    // Expand preview owns geometry; translating would double-move the grabber.
    if (expandPreview) return 0
    // Page rubber-band (and compact dismiss) — pullY may be negative.
    return pullY
  })()

  const origin =
    dock === 'tl' || dock === 'bl' ? 'bottom left' : 'bottom right'

  // Size morph only — Y lives on the motion shell, never on CSS exit keyframes
  // for gesture dismiss (coach-sheet-out from{translateY(0)} = middle flash).
  // During page→compact FLIP, keep transitions on after the lock releases.
  const sheetTransition = (() => {
    if (reduceMotion || dragging || settling || fromDragDismiss) return 'none'
    if (boxLock) return 'none'
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
      `padding ${SIZE_MS}ms ${curve}`,
    ]
    return parts.join(', ')
  })()

  // Dim the scrim only on a real dismiss path — never while settling a minimize
  // (that caused blur on→off→on when compact remounted the backdrop).
  const dismissAtLive = sheetDismissThreshold(sheetH.current || 400)
  const liveDismissScrim =
    pullDismissing ||
    fromDragDismiss ||
    (dragging &&
      pullY > 0 &&
      (visualSize !== 'page' || pullY > dismissAtLive))
  const dismissProgress = liveDismissScrim
    ? Math.min(1, Math.max(0, pullY) / dismissAtLive)
    : 0
  const backdropOpacity = 0.45 * (1 - dismissProgress * 0.85)

  // Scrim stays up for any open chat (page or compact), including morph/pull.
  // Fade only on full close — never unmount on size change.
  const showBackdrop = mounted

  // Lift fixed sheet above the iOS keyboard so autofocus can't bury the composer.
  // Top-docked desktop cards use `top`/`bottom:auto` — don't override bottom there.
  const topDocked = dock === 'tl' || dock === 'tr'
  const sheetKeyboardStyle =
    !closing && keyboardInset > 0 && !boxLock
      ? isPage
        ? ({ paddingBottom: keyboardInset } as const)
        : !topDocked
          ? ({ bottom: keyboardInset + 12 } as const)
          : undefined
      : undefined

  const morphLockStyle: CSSProperties | undefined = boxLock
    ? {
        top: boxLock.top,
        left: boxLock.left,
        width: boxLock.width,
        height: boxLock.height,
        right: 'auto',
        bottom: 'auto',
        maxHeight: 'none',
      }
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
      {mounted && (isPage || sizeMorphing) ? (
        <div
          className="coach-status-bar-heal"
          style={{ backgroundColor: THEME_COLOR[theme] }}
          aria-hidden
        />
      ) : null}
      {showBackdrop ? (
        <button
          type="button"
          className={`coach-backdrop${
            playEnter && !closing && !reduceMotion
              ? ' coach-backdrop--enter'
              : ''
          }${closing ? ' coach-backdrop--closing' : ''}${
            closing && fromDragDismiss
              ? ' coach-backdrop--closing-from-drag'
              : ''
          }`}
          aria-label="Close Coach"
          onClick={requestClose}
          style={
            !reduceMotion && liveDismissScrim
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
          playEnter && !closing && !reduceMotion && !boxLock
            ? ' coach-sheet--enter'
            : ''
        }${closing ? ' coach-sheet--closing' : ''}${
          fromDragDismiss ? ' coach-sheet--closing-from-drag' : ''
        }${
          dragging || settling ? ' coach-sheet--pulling' : ''
        }${boxLock ? ' coach-sheet--morph-lock' : ''}`}
        data-dock={dock}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          transformOrigin: origin,
          transition: sheetTransition,
          // Keyboard bottom must not win over FLIP / expand-preview box.
          ...sheetKeyboardStyle,
          ...morphLockStyle,
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
                onClick={() => morphToPage(0)}
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
