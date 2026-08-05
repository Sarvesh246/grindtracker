'use client'
import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useProgressPhotos, type ProgressPhotoGroupWithPhotos } from '@/lib/hooks/useProgressPhotos'
import { formatDayType, formatShortDate } from '@/lib/utils/formatting'

/**
 * True side-by-side even on narrow mobile — stacking would defeat the point
 * of a simultaneous visual A/B comparison. Each side defaults to its day's
 * first photo; multi-photo days get prev/next arrows to pick a different one.
 */
export default function ComparePhotosView({
  groups,
  onClose,
}: {
  groups: [ProgressPhotoGroupWithPhotos, ProgressPhotoGroupWithPhotos]
  onClose: () => void
}) {
  const { signPaths } = useProgressPhotos()
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [photoIndex, setPhotoIndex] = useState<[number, number]>([0, 0])
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])

  useEffect(() => {
    const paths = groups.flatMap(g => g.photos.map(p => p.storage_path))
    if (paths.length === 0) return
    let cancelled = false
    signPaths(paths).then(map => { if (!cancelled) setSignedUrls(map) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  function requestClose() {
    if (closing) return
    setClosing(true)
    setVisible(false)
    window.setTimeout(onClose, 220)
  }

  function cyclePhoto(side: 0 | 1, direction: 1 | -1) {
    setPhotoIndex(prev => {
      const count = groups[side].photos.length
      if (count === 0) return prev
      const next: [number, number] = [...prev]
      next[side] = (prev[side] + direction + count) % count
      return next
    })
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Compare progress photos"
      style={{
        position: 'fixed', inset: 0, zIndex: 400, backgroundColor: '#000',
        display: 'flex', flexDirection: 'column',
        opacity: visible && !closing ? 1 : 0, transition: 'opacity 220ms ease',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'max(14px, env(safe-area-inset-top)) 14px 10px',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '18px', color: '#f0f0f0', letterSpacing: '0.5px' }}>
          COMPARE
        </span>
        <button onClick={requestClose} aria-label="Close" style={ICON_BTN}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: '2px', overflow: 'hidden', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {groups.map((g, i) => {
          const side = i as 0 | 1
          const photo = g.photos[photoIndex[side]]
          const url = photo ? signedUrls[photo.storage_path] : undefined
          return (
            <div key={g.id} style={{ flex: 1, position: 'relative', backgroundColor: '#0a0a0a', overflow: 'hidden' }}>
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div className="shimmer" style={{ width: '100%', height: '100%' }} />
              )}

              <div style={{ position: 'absolute', top: '8px', left: '8px', right: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={CHIP}>{formatShortDate(g.taken_date)}</span>
                <span style={CHIP}>{g.day_type ? formatDayType(g.day_type) : 'N/A'}</span>
              </div>

              {g.photos.length > 1 && (
                <div style={{ position: 'absolute', bottom: '10px', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: '8px' }}>
                  <button onClick={() => cyclePhoto(side, -1)} aria-label="Previous photo" style={SMALL_ICON_BTN}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <span style={{ ...CHIP, alignSelf: 'center' }}>
                    {photoIndex[side] + 1}/{g.photos.length}
                  </span>
                  <button onClick={() => cyclePhoto(side, 1)} aria-label="Next photo" style={SMALL_ICON_BTN}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>,
    document.body
  )
}

const ICON_BTN: CSSProperties = {
  width: '36px', height: '36px', borderRadius: '9999px',
  backgroundColor: 'rgba(255,255,255,0.1)', border: 'none', color: '#f0f0f0',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
}

const SMALL_ICON_BTN: CSSProperties = {
  width: '28px', height: '28px', borderRadius: '9999px',
  backgroundColor: 'rgba(0,0,0,0.55)', border: 'none', color: '#f0f0f0',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
}

const CHIP: CSSProperties = {
  display: 'inline-block', width: 'fit-content',
  padding: '3px 8px', borderRadius: 'var(--radius-pill, 9999px)',
  backgroundColor: 'rgba(0,0,0,0.55)', color: '#f0f0f0',
  fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600,
}
