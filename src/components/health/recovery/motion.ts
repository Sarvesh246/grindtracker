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

/**
 * Read a chart by dragging, hovering or with the arrow keys. A horizontal drag
 * scrubs (pointer capture), a vertical one is left to the page (`touch-action:
 * pan-y` on the plot), a tap reads one point. Returns the picked index or null.
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
        set(at(e))
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === 'mouse' || e.currentTarget.hasPointerCapture?.(e.pointerId))
          set(at(e))
      },
      onPointerLeave: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === 'mouse') set(null)
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
