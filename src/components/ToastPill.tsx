'use client'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

/** Keep in sync with `.toast-slide` durations in `globals.css`. */
export const TOAST_SLIDE_OUT_MS = 480

type Props = {
  /** Nearest viewport edge — enter from and exit toward this side. */
  edge: 'top' | 'bottom'
  exiting?: boolean
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
 */
export default function ToastPill({
  edge,
  exiting = false,
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
    ...visualStyle
  } = style ?? {}

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
        className={[
          'toast-slide',
          edge === 'top' ? 'toast-slide--top' : 'toast-slide--bottom',
          exiting ? 'toast-slide--exiting' : '',
          className,
        ].filter(Boolean).join(' ')}
        style={visualStyle}
      >
        {children}
      </div>
    </div>
  )
}
