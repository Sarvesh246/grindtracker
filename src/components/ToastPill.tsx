'use client'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { useSwipeDismiss } from '@/lib/hooks/useSwipeDismiss'

/** Keep in sync with `.toast-slide` durations in `globals.css`. */
export const TOAST_SLIDE_OUT_MS = 480

type Props = {
  /** Nearest viewport edge — enter from and exit toward this side. */
  edge: 'top' | 'bottom'
  exiting?: boolean
  /**
   * When set, the pill captures a drag and dismisses on a swipe left, right,
   * up, or down. Interactive children (UNDO, Dismiss) still receive taps —
   * a drag only starts after a few pixels of movement.
   */
  onDismiss?: () => void
  children: ReactNode
  style?: CSSProperties
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'children'>

/**
 * Fixed notification pill. Slides fully off-screen toward `edge` (and in from
 * that same edge). Pair with `useExitingValue(..., TOAST_SLIDE_OUT_MS)` so the
 * node stays mounted through the exit.
 *
 * Positioning (top/bottom/z-index) lives on a full-width flex anchor so the
 * pill can animate `translateY` without fighting a centering `translateX(-50%)`
 * on the same node — that conflict skipped or aborted the slide on iOS.
 *
 * Swipe-to-dismiss (when `onDismiss` is passed) follows the finger, then flies
 * off in the swipe direction. The full-width anchor stays `pointer-events:
 * none` so only the pill itself is hittable — never the page underneath.
 */
export default function ToastPill({
  edge,
  exiting = false,
  onDismiss,
  children,
  style,
  className,
  ...rest
}: Props) {
  const {
    top,
    bottom,
    zIndex,
    left: _left,
    right: _right,
    position: _position,
    transform: _transform,
    pointerEvents: _pointerEvents,
    ...visualStyle
  } = style ?? {}

  const swipe = useSwipeDismiss(onDismiss, exiting)

  return (
    <div
      className="toast-slide-anchor"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        top,
        bottom,
        zIndex,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        {...rest}
        {...swipe.handlers}
        data-swipe-ignore=""
        className={[
          'toast-slide',
          edge === 'top' ? 'toast-slide--top' : 'toast-slide--bottom',
          exiting ? 'toast-slide--exiting' : '',
          swipe.dragging ? 'toast-slide--dragging' : '',
          swipe.flying ? 'toast-slide--swipe-out' : '',
          className,
        ].filter(Boolean).join(' ')}
        style={{
          ...visualStyle,
          ...swipe.style,
        }}
      >
        {children}
      </div>
    </div>
  )
}
