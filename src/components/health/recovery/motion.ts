'use client'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import { useMotionPref } from '@/lib/contexts/MotionContext'

/**
 * Counts a number up to its target (and between targets when it changes).
 * With Reduce Motion, in-app or OS, it is simply the target.
 */
export function useCountUp(target: number | null, ms = 1300, delay = 0): number | null {
  const { reduceMotion } = useMotionPref()
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (target == null || reduceMotion) return
    let raf = 0
    const start = performance.now() + delay
    const origin = from.current
    const step = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - start) / ms))
      const eased = 1 - Math.pow(1 - p, 4)
      from.current = origin + (target - origin) * eased
      setShown(from.current)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, reduceMotion, ms, delay])
  if (target == null) return null
  return reduceMotion ? target : Math.round(shown)
}

/** The element's rendered width, so charts draw at real pixels instead of stretching. */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const [node, setNode] = useState<T | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    if (!node) return
    const read = () => {
      const w = Math.round(node.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width] as const
}

/** Movement under this (px) is a tap, not a drag. */
const TAP_SLOP = 6
/** How close (px) a tap must land to the reading's line to count as tapping it. */
const TAP_REACH = 22

/**
 * Read a chart by dragging, hovering or with the arrow keys. A horizontal drag
 * scrubs (pointer capture), a vertical one is left to the page (`touch-action:
 * pan-y` on the plot), a tap reads one point and a tap back on that point
 * clears it. Returns the picked index or null.
 */
export function useScrub(
  count: number,
  options: {
    max?: number
    bars?: boolean
    inset?: [number, number]
    resetKey?: string
    /** Maps a 0–1 position to an index, for items of unequal width. */
    locate?: (fraction: number) => number
  } = {}
) {
  const { max = count - 1, bars = false, inset = [0, 0], resetKey = '', locate } = options
  const [picked, setPicked] = useState<{ key: string; index: number } | null>(null)
  const index = picked?.key === resetKey ? picked.index : null
  const touch = useRef(false)
  // A tap (no drag) back on the point already being read puts the chart away,
  // so the whole line is visible again. `down` is where the press started and
  // what was picked before it; `dismissed` keeps a mouse from re-picking on
  // its next nudge, until it moves off that spot.
  const down = useRef<{
    x: number
    before: number | null
    moved: boolean
  } | null>(null)
  const dismissedAt = useRef<number | null>(null)
  const at = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      const width = r.width - inset[0] - inset[1]
      const p = Math.max(0, Math.min(1, (e.clientX - r.left - inset[0]) / Math.max(1, width)))
      const i = locate
        ? locate(p)
        : bars
          ? Math.min(count - 1, Math.floor(p * count))
          : Math.round(p * (count - 1))
      return Math.max(0, Math.min(max, i))
    },
    [bars, count, inset, max, locate]
  )
  /** Whether the press landed on the point being read (same item, or within a fingertip of its line). */
  const onSelected = (e: PointerEvent<HTMLElement>, before: number) => {
    if (at(e) === before) return true
    if (locate || bars) return false
    const r = e.currentTarget.getBoundingClientRect()
    const width = r.width - inset[0] - inset[1]
    const lineX = r.left + inset[0] + (before / Math.max(1, count - 1)) * width
    return Math.abs(e.clientX - lineX) <= TAP_REACH
  }
  const set = useCallback(
    (i: number | null) => setPicked(i == null ? null : { key: resetKey, index: i }),
    [resetKey]
  )
  return {
    index,
    set,
    props: {
      tabIndex: 0,
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        touch.current = e.pointerType !== 'mouse'
        if (e.pointerType !== 'mouse') e.currentTarget.setPointerCapture?.(e.pointerId)
        down.current = { x: e.clientX, before: index, moved: false }
        dismissedAt.current = null
        set(at(e))
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        if (down.current && Math.abs(e.clientX - down.current.x) > TAP_SLOP)
          down.current.moved = true
        if (e.pointerType === 'mouse') {
          if (dismissedAt.current != null) {
            if (Math.abs(e.clientX - dismissedAt.current) <= TAP_REACH) return
            dismissedAt.current = null
          }
        } else if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return
        set(at(e))
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        const press = down.current
        down.current = null
        if (!press || press.moved || press.before == null) return
        if (onSelected(e, press.before)) {
          dismissedAt.current = e.clientX
          set(null)
        }
      },
      onPointerCancel: () => {
        down.current = null
      },
      onPointerLeave: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === 'mouse') {
          dismissedAt.current = null
          set(null)
        }
      },
      onBlur: () => {
        if (!touch.current) set(null)
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        const current = index ?? max
        const next =
          e.key === 'ArrowLeft'
            ? current - 1
            : e.key === 'ArrowRight'
              ? current + 1
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? max
                  : e.key === 'Escape'
                    ? null
                    : undefined
        if (next === undefined) return
        e.preventDefault()
        set(next == null ? null : Math.max(0, Math.min(max, next)))
      }
    }
  }
}
