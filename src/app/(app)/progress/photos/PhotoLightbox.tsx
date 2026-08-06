'use client'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import { useProgressPhotos } from '@/lib/hooks/useProgressPhotos'
import { formatDayType, formatShortDate } from '@/lib/utils/formatting'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import TimelineStrip from './TimelineStrip'

export interface LightboxItem {
  id: string
  storage_path: string
  taken_date: string
  day_type: string | null
}

const SWIPE_MIN_PX = 60
const SWIPE_FRACTION = 0.22
const TAP_MOVE_THRESHOLD = 10
const SETTLE_MS = 260

/**
 * Hand-rolled full-screen swipe viewer (no gesture library in this app).
 * Renders only [prev, current, next] at a time and signs at most 5 URLs
 * (current +/- 2) — bounded DOM/signed-URL cost regardless of history length,
 * which is what makes `showTimeline` mode safe to point at the user's entire
 * photo history.
 *
 * Mount this conditionally (`{open && <PhotoLightbox .../>}`), not with an
 * `open` prop — like FeedbackModal, every mount should start fresh.
 */
export default function PhotoLightbox({
  items: initialItems,
  initialIndex,
  showTimeline = false,
  onClose,
  onDeleteItem,
}: {
  items: LightboxItem[]
  initialIndex: number
  showTimeline?: boolean
  onClose: () => void
  onDeleteItem?: (item: LightboxItem) => Promise<void>
}) {
  const { reduceMotion } = useMotionPref()
  const { signPaths } = useProgressPhotos()
  const containerRef = useRef<HTMLDivElement>(null)

  const [items, setItems] = useState(initialItems)
  const [index, setIndex] = useState(initialIndex)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [chrome, setChrome] = useState(true)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dragX, setDragX] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'dragging' | 'settling'>('idle')

  const dragRef = useRef<{ startX: number; startY: number; moved: number; axis: 'x' | 'y' | null } | null>(null)

  // Fresh-mount entrance. The track below positions slides with percentage
  // transforms (100% per slide) instead of a JS-measured pixel width, so there's
  // no "correct width hasn't been measured yet" frame to race — the very first
  // paint is already correctly positioned, and orientation/viewport-chrome
  // changes (mobile Safari's collapsing address bar, etc.) can't leave it stale.
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    const prevBody = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevBody }
  }, [])

  const current = items[index] as LightboxItem | undefined
  const prev = index > 0 ? items[index - 1] : undefined
  const next = index < items.length - 1 ? items[index + 1] : undefined
  // One extra neighbor on each side, for prefetching only (never rendered) —
  // by the time a swipe lands on `next`, `next`'s own neighbor is already
  // signed, so a second fast swipe in the same direction doesn't hit a
  // still-loading placeholder.
  const prev2 = index > 1 ? items[index - 2] : undefined
  const next2 = index < items.length - 2 ? items[index + 2] : undefined

  const dates = useMemo(() => {
    const out: string[] = []
    for (const it of items) {
      if (out[out.length - 1] !== it.taken_date) out.push(it.taken_date)
    }
    return out
  }, [items])

  // Windowed signing: only the current photo +/- two neighbors ever get signed,
  // so a "view all history" session never signs more than 5 URLs at once.
  useEffect(() => {
    const windowItems = [prev2, prev, current, next, next2].filter((it): it is LightboxItem => !!it)
    const missing = windowItems.map(it => it.storage_path).filter(p => !signedUrls[p])
    if (missing.length === 0) return
    let cancelled = false
    signPaths(missing).then(map => {
      if (!cancelled) setSignedUrls(p => ({ ...p, ...map }))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items])

  function requestClose() {
    if (closing) return
    setClosing(true)
    setVisible(false)
    window.setTimeout(onClose, reduceMotion ? 0 : 220)
  }

  function goTo(target: number) {
    if (phase === 'settling') return
    setIndex(Math.min(items.length - 1, Math.max(0, target)))
    setDragX(0)
    setPhase('idle')
  }

  function commitSwipe(direction: 1 | -1) {
    if (phase === 'settling') return
    const target = index + direction
    if (target < 0 || target >= items.length) {
      settleBack()
      return
    }
    const w = containerRef.current?.offsetWidth ?? 0
    setPhase('settling')
    setDragX(direction > 0 ? -w : w)
    window.setTimeout(() => {
      setIndex(target)
      setDragX(0)
      setPhase('idle')
    }, reduceMotion ? 0 : SETTLE_MS)
  }

  function settleBack() {
    if (phase === 'settling') return
    setPhase('settling')
    setDragX(0)
    window.setTimeout(() => setPhase('idle'), reduceMotion ? 0 : SETTLE_MS)
  }

  // Keyboard nav registered once; reads fresh closures via this ref so the
  // listener never goes stale without re-binding on every state change.
  const latest = useRef({ commitSwipe, requestClose })
  useEffect(() => { latest.current = { commitSwipe, requestClose } })
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') latest.current.requestClose()
      else if (e.key === 'ArrowLeft') latest.current.commitSwipe(-1)
      else if (e.key === 'ArrowRight') latest.current.commitSwipe(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onPointerDown(e: ReactPointerEvent) {
    if (phase === 'settling') return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: 0, axis: null }
    setPhase('dragging')
  }

  function onPointerMove(e: ReactPointerEvent) {
    const drag = dragRef.current
    if (!drag || phase !== 'dragging') return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    drag.moved = Math.max(drag.moved, Math.abs(dx), Math.abs(dy))
    if (!drag.axis) {
      if (Math.abs(dx) <= 6 && Math.abs(dy) <= 6) return
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (drag.axis !== 'x') return
    e.preventDefault()
    const atStart = index === 0 && dx > 0
    const atEnd = index === items.length - 1 && dx < 0
    setDragX(atStart || atEnd ? dx * 0.35 : dx)
  }

  function onPointerUp(e: ReactPointerEvent) {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return

    if (drag.axis === 'x') {
      const w = containerRef.current?.offsetWidth ?? 0
      const threshold = Math.max(SWIPE_MIN_PX, w * SWIPE_FRACTION)
      if (dragX <= -threshold) { commitSwipe(1); return }
      if (dragX >= threshold) { commitSwipe(-1); return }
      settleBack()
      return
    }

    if (drag.moved < TAP_MOVE_THRESHOLD) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const relX = e.clientX - rect.left
        if (relX < rect.width / 3) { commitSwipe(-1); return }
        if (relX > (rect.width * 2) / 3) { commitSwipe(1); return }
      }
      setChrome(v => !v)
    }
    setPhase('idle')
  }

  async function handleDelete() {
    if (!onDeleteItem || !current) return
    setDeleting(true)
    try {
      await onDeleteItem(current)
      const remaining = items.filter(it => it.id !== current.id)
      setDeleting(false)
      setConfirmDelete(false)
      if (remaining.length === 0) {
        requestClose()
        return
      }
      setItems(remaining)
      setIndex(i => Math.min(i, remaining.length - 1))
      setDragX(0)
      setPhase('idle')
    } catch {
      setDeleting(false)
    }
  }

  if (!current || typeof document === 'undefined') return null

  // Only 'settling' animates — 'dragging' tracks the finger 1:1, and the
  // post-commit index/dragX reset (phase -> 'idle') must be instant or the
  // content swap and the transform jump would visibly fight each other.
  const transitionStyle = phase === 'settling' && !reduceMotion
    ? `transform ${SETTLE_MS}ms cubic-bezier(0.22,1,0.36,1)`
    : 'none'
  const baseOffsetPercent = prev ? -100 : 0
  const shown = visible && !closing

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Progress photo viewer"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        backgroundColor: 'rgba(0,0,0,0.97)',
        opacity: shown ? 1 : 0,
        transform: shown ? 'scale(1)' : 'scale(0.96)',
        transition: 'opacity 200ms ease, transform 200ms ease',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {chrome && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'max(14px, env(safe-area-inset-top)) 14px 18px',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.75), rgba(0,0,0,0.35) 70%, transparent)',
            position: 'absolute',
            top: 0, left: 0, right: 0,
            zIndex: 2,
          }}
        >
          <button onClick={requestClose} aria-label="Close" style={ICON_BTN}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div style={{ textAlign: 'center', color: '#f5f5f5', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '20px', letterSpacing: '0.5px' }}>
              {formatShortDate(current.taken_date)}
            </div>
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
              {current.day_type ? formatDayType(current.day_type) : 'N/A'}
            </div>
          </div>
          {onDeleteItem ? (
            <button onClick={() => setConfirmDelete(true)} aria-label="Delete photo" style={ICON_BTN}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          ) : (
            <span style={{ width: '38px' }} />
          )}
        </div>
      )}

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ flex: 1, overflow: 'hidden', position: 'relative', touchAction: 'pan-y' }}
      >
        <div
          style={{
            display: 'flex',
            height: '100%',
            transform: `translateX(calc(${baseOffsetPercent}% + ${dragX}px))`,
            transition: transitionStyle,
          }}
        >
          {prev && <LightboxSlide item={prev} url={signedUrls[prev.storage_path]} />}
          <LightboxSlide item={current} url={signedUrls[current.storage_path]} />
          {next && <LightboxSlide item={next} url={signedUrls[next.storage_path]} />}
        </div>
      </div>

      {chrome && showTimeline && dates.length > 1 && (
        <div
          style={{
            position: 'absolute',
            left: 0, right: 0,
            bottom: 'env(safe-area-inset-bottom)',
            background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)',
          }}
        >
          <TimelineStrip
            dates={dates}
            activeDate={current.taken_date}
            onJump={date => {
              const target = items.findIndex(it => it.taken_date === date)
              if (target >= 0) goTo(target)
            }}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this photo?"
        message="This can't be undone."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>,
    document.body
  )
}

const ICON_BTN: CSSProperties = {
  width: '38px', height: '38px', borderRadius: '9999px',
  backgroundColor: 'rgba(0,0,0,0.4)', border: 'none', color: '#f0f0f0',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
}

function LightboxSlide({ item, url }: { item: LightboxItem; url?: string }) {
  return (
    <div style={{ flex: '0 0 100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {url ? (
        // Signed Supabase URL — not a configured next/image remote host, and
        // this app skips next/image elsewhere for the same reason.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Progress photo from ${formatShortDate(item.taken_date)}`}
          draggable={false}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none' }}
        />
      ) : (
        <div className="shimmer" aria-hidden="true" style={{ width: '70%', height: '70%', borderRadius: 'var(--radius-md)' }} />
      )}
    </div>
  )
}
