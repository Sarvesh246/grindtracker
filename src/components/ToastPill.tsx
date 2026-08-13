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
 */
export default function ToastPill({
  edge,
  exiting = false,
  children,
  style,
  className,
  ...rest
}: Props) {
  return (
    <div
      {...rest}
      className={[
        'toast-slide',
        edge === 'top' ? 'toast-slide--top' : 'toast-slide--bottom',
        exiting ? 'toast-slide--exiting' : '',
        className,
      ].filter(Boolean).join(' ')}
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
