'use client'
import { useState } from 'react'
import type { ProgressPhoto } from '@/lib/types'
import type { ProgressPhotoGroupWithPhotos } from '@/lib/hooks/useProgressPhotos'
import { formatDayType, formatShortDate } from '@/lib/utils/formatting'

type GridCell =
  | { type: 'photo'; photo: ProgressPhoto; index: number }
  | { type: 'more'; photo: ProgressPhoto; index: number; count: number }

/**
 * 1 photo -> single square tile. 2/3 -> equal tiles in one row.
 * 4+ -> fixed 2x2, with the 4th cell scrimmed and labeled "+N" (N = total - 3).
 */
export function buildGridCells(photos: ProgressPhoto[]): GridCell[] {
  if (photos.length <= 3) {
    return photos.map((photo, index) => ({ type: 'photo', photo, index }))
  }
  return [
    ...photos.slice(0, 3).map((photo, index): GridCell => ({ type: 'photo', photo, index })),
    { type: 'more', photo: photos[3], index: 3, count: photos.length - 3 },
  ]
}

function gridColumns(count: number): string {
  if (count <= 1) return '1fr'
  if (count === 2) return 'repeat(2, 1fr)'
  if (count === 3) return 'repeat(3, 1fr)'
  return 'repeat(2, 1fr)'
}

export default function PhotoGroupGrid({
  group,
  signedUrls,
  onImageError,
  onOpenLightbox,
  onDeleteGroup,
  compareMode = false,
  compareSelected = false,
  onToggleCompareSelect,
}: {
  group: ProgressPhotoGroupWithPhotos
  signedUrls: Record<string, string>
  onImageError?: (path: string) => void
  onOpenLightbox: (photoIndex: number) => void
  onDeleteGroup: () => void
  compareMode?: boolean
  compareSelected?: boolean
  onToggleCompareSelect?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const cells = buildGridCells(group.photos)

  function handleTileTap(index: number) {
    if (compareMode) {
      onToggleCompareSelect?.()
      return
    }
    onOpenLightbox(index)
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--surface)',
        border: `1px solid ${compareSelected ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        position: 'relative',
        transition: 'border-color 150ms ease',
      }}
    >
      {compareMode && (
        <button
          onClick={onToggleCompareSelect}
          aria-label={compareSelected ? `Deselect ${formatShortDate(group.taken_date)}` : `Select ${formatShortDate(group.taken_date)}`}
          aria-pressed={compareSelected}
          style={{
            position: 'absolute', top: '10px', right: '10px', zIndex: 2,
            width: '26px', height: '26px', borderRadius: '9999px',
            backgroundColor: compareSelected ? 'var(--accent)' : 'rgba(0,0,0,0.55)',
            border: compareSelected ? 'none' : '1.5px solid rgba(255,255,255,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
        >
          {compareSelected && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)"
              strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '12px 12px 8px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '17px', letterSpacing: '0.5px', color: 'var(--text-primary)' }}>
              {formatShortDate(group.taken_date)}
            </span>
            <span style={{
              fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase',
              color: group.day_type ? 'var(--accent-text)' : 'var(--text-muted)',
              backgroundColor: group.day_type ? 'var(--accent-wash)' : 'var(--surface-elevated)',
              border: `1px solid ${group.day_type ? 'transparent' : 'var(--border)'}`,
              borderRadius: 'var(--radius-pill, 9999px)', padding: '2px 8px',
            }}>
              {group.day_type ? formatDayType(group.day_type) : 'N/A'}
            </span>
          </div>
          {group.note && (
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: '6px 0 0' }}>
              {group.note}
            </p>
          )}
        </div>

        {!compareMode && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              aria-label="Entry options"
              aria-expanded={menuOpen}
              style={{
                width: '32px', height: '32px', borderRadius: 'var(--radius-sm)',
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="12" cy="19" r="1.8" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 3 }} />
                <div style={{
                  position: 'absolute', top: '36px', right: 0, zIndex: 4,
                  backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                  minWidth: '160px', overflow: 'hidden',
                }}>
                  <button
                    onClick={() => { setMenuOpen(false); onDeleteGroup() }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '11px 14px',
                      background: 'transparent', border: 'none', color: 'var(--danger)',
                      fontFamily: 'var(--font-sans)', fontSize: '13px', cursor: 'pointer',
                    }}
                  >
                    Delete entry
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div
        role={compareMode ? undefined : 'group'}
        aria-label={compareMode ? undefined : `Photos from ${formatShortDate(group.taken_date)}`}
        style={{
          display: 'grid',
          gridTemplateColumns: gridColumns(group.photos.length),
          gridTemplateRows: group.photos.length >= 4 ? 'repeat(2, 1fr)' : undefined,
          gap: '3px',
          padding: '0 3px 3px',
        }}
      >
        {cells.map(cell => {
          const url = signedUrls[cell.photo.storage_path]
          return (
            <button
              key={cell.photo.id}
              onClick={() => handleTileTap(cell.index)}
              aria-label={cell.type === 'more' ? `View ${cell.count} more photos` : `Open photo ${cell.index + 1}`}
              style={{
                position: 'relative', aspectRatio: '1', padding: 0, border: 'none',
                borderRadius: 'var(--radius-sm)', overflow: 'hidden', cursor: 'pointer',
                backgroundColor: 'var(--surface-elevated)',
              }}
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() => onImageError?.(cell.photo.storage_path)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div className="shimmer" style={{ width: '100%', height: '100%' }} />
              )}
              {cell.type === 'more' && (
                <div style={{
                  position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#f5f5f5', fontFamily: 'var(--font-display)', fontSize: '22px', letterSpacing: '0.5px',
                }}>
                  +{cell.count}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
