'use client'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useKeyboardInset } from '@/lib/hooks/useKeyboardInset'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Accessible modal/sheet primitive shared by completion, plate calc, feedback,
 * badge unlock, and confirm dialogs. Traps focus, restores it on close, locks
 * .app-main scroll, and honors Escape when `onClose` is provided.
 */
export default function Dialog({
  open,
  onClose,
  title,
  labelledBy,
  describedBy,
  children,
  style,
  panelStyle,
  className,
  panelClassName,
  role = 'dialog',
  initialFocusRef,
  closeOnBackdrop = true,
  zIndex = 300,
  avoidKeyboard = false,
  closing = false,
  focusPanel = false,
}: {
  open: boolean
  onClose?: () => void
  /** Visible / SR title when no external labelledBy is wired. */
  title?: string
  labelledBy?: string
  describedBy?: string
  children: ReactNode
  style?: CSSProperties
  panelStyle?: CSSProperties
  className?: string
  panelClassName?: string
  role?: 'dialog' | 'alertdialog'
  initialFocusRef?: React.RefObject<HTMLElement | null>
  closeOnBackdrop?: boolean
  zIndex?: number
  /**
   * Lifts the sheet above the on-screen keyboard and exposes the inset as the
   * `--grind-keyboard-inset` CSS var on the panel, so callers can shrink their
   * own max-height cap via `calc(Ndvh - var(--grind-keyboard-inset))` instead
   * of each hand-rolling `useKeyboardInset()` + the same padding/cap formula.
   *
   * Inset is already spring-smoothed in `useKeyboardInset` — do not add a CSS
   * padding transition on top or the sheet lags then overshoots the keyboard.
   */
  avoidKeyboard?: boolean
  /**
   * Play an exit animation while staying mounted. Freezes the keyboard lift so
   * a dismissing keyboard doesn't drop the sheet mid-slide, and ignores further
   * dismiss gestures.
   */
  closing?: boolean
  /** Focus the panel itself instead of the first input — avoids popping the
   *  keyboard before the user has seen the sheet (iOS PWA). */
  focusPanel?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const liveInset = useKeyboardInset()
  const [freeze, setFreeze] = useState<{ on: boolean; inset: number }>({ on: false, inset: 0 })
  if (closing && !freeze.on) {
    setFreeze({ on: true, inset: liveInset })
  } else if (!closing && freeze.on) {
    setFreeze({ on: false, inset: 0 })
  }
  const keyboardInset = freeze.on ? freeze.inset : liveInset
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const autoTitleId = useId()
  const titleId = labelledBy ?? (title ? autoTitleId : undefined)
  const canDismiss = !!onClose && !closing

  // Scroll lock on the app main scroller + body.
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const main = document.querySelector('.app-main') as HTMLElement | null
    const prevMain = main?.style.overflow
    const prevBody = document.body.style.overflow
    if (main) main.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      if (main) main.style.overflow = prevMain ?? ''
      document.body.style.overflow = prevBody
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  // Initial focus.
  useEffect(() => {
    if (!open || closing) return
    const t = window.setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
        return
      }
      const panel = panelRef.current
      if (!panel) return
      if (focusPanel) {
        panel.focus()
        return
      }
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus()
    }, 10)
    return () => window.clearTimeout(t)
  }, [open, closing, initialFocusRef, focusPanel])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'Escape' && canDismiss) {
        e.stopPropagation()
        onClose?.()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1)
      if (nodes.length === 0) {
        e.preventDefault()
        panelRef.current.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [canDismiss, onClose],
  )

  if (!open) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="presentation"
      className={className}
      data-closing={closing ? 'true' : undefined}
      data-keyboard={avoidKeyboard && keyboardInset > 8 ? 'true' : undefined}
      onClick={e => {
        if (!closeOnBackdrop || !canDismiss) return
        if (e.target === e.currentTarget) onClose?.()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        pointerEvents: closing ? 'none' : undefined,
        ...(avoidKeyboard ? { paddingBottom: keyboardInset } : null),
        ...style,
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={panelClassName}
        onKeyDown={onKeyDown}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '480px',
          outline: 'none',
          overscrollBehavior: 'contain',
          ...(avoidKeyboard
            ? ({ '--grind-keyboard-inset': `${keyboardInset}px` } as CSSProperties)
            : null),
          ...panelStyle,
        }}
      >
        {title && !labelledBy && (
          <span id={autoTitleId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {title}
          </span>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
