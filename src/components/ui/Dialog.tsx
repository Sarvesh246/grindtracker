'use client'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'

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
  role = 'dialog',
  initialFocusRef,
  closeOnBackdrop = true,
  zIndex = 300,
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
  role?: 'dialog' | 'alertdialog'
  initialFocusRef?: React.RefObject<HTMLElement | null>
  closeOnBackdrop?: boolean
  zIndex?: number
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const autoTitleId = useId()
  const titleId = labelledBy ?? (title ? autoTitleId : undefined)

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
    if (!open) return
    const t = window.setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
        return
      }
      const panel = panelRef.current
      if (!panel) return
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus()
    }, 10)
    return () => window.clearTimeout(t)
  }, [open, initialFocusRef])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation()
        onClose()
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
    [onClose],
  )

  if (!open) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="presentation"
      onClick={e => {
        if (!closeOnBackdrop || !onClose) return
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
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
        onKeyDown={onKeyDown}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '480px',
          outline: 'none',
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
