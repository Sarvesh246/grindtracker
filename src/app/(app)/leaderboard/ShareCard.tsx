'use client'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { LeaderboardEntry } from '@/lib/types'
import { useUnit } from '@/lib/contexts/UnitContext'
import { renderShareCardPng } from '@/lib/utils/shareCardImage'
import { reportError } from '@/lib/utils/reportError'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'

/* UI medals follow theme tokens; PNG share is always dark-branded hex. */
const RANK_COLORS: Record<number, string> = {
  1: 'var(--medal-1)',
  2: 'var(--medal-2)',
  3: 'var(--medal-3)',
}

const SHARE_RANK_HEX: Record<number, string> = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
}

export type ShareCardEntry = Pick<
  LeaderboardEntry,
  | 'display_name'
  | 'username'
  | 'avatar_url'
  | 'level'
  | 'current_streak'
  | 'total_workouts'
  | 'xp_total'
  | 'best_lift'
>

interface ShareCardProps {
  entry: ShareCardEntry
  rank?: number
  category: string
  onClose: () => void
  variant?: 'rank' | 'profile'
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

export default function ShareCard({
  entry,
  rank = 0,
  category,
  onClose,
  variant = 'rank',
}: ShareCardProps) {
  const { unitLabel, fmt } = useUnit()
  const [canShare, setCanShare] = useState(false)
  const [sharing, setSharing] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, true)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanShare(typeof navigator !== 'undefined' && 'share' in navigator)
  }, [])
  useEffect(() => {
    const first = panelRef.current?.querySelector<HTMLElement>('button:not([disabled])')
    ;(first ?? backdropRef.current)?.focus()
  }, [])
  useEffect(() => {
    const main = document.querySelector('.app-main') as HTMLElement | null
    const scrollY = main?.scrollTop ?? 0
    const prevMainOverflow = main?.style.overflow ?? ''
    const prevMainTouch = main?.style.touchAction ?? ''
    const prevBody = document.body.style.overflow

    // Body class: hide Coach FAB + CSS-lock .app-main (iOS ignores plain
    // overflow:hidden on -webkit-overflow-scrolling: touch scrollers).
    document.body.classList.add('share-overlay-open')
    document.body.style.overflow = 'hidden'
    if (main) {
      main.style.overflow = 'hidden'
      main.style.touchAction = 'none'
    }

    // Block background pan; still allow the overlay itself to scroll when the
    // share card + actions are taller than the viewport.
    const onTouchMove = (e: TouchEvent) => {
      const overlay = backdropRef.current
      if (!overlay) {
        e.preventDefault()
        return
      }
      const target = e.target
      if (!(target instanceof Node) || !overlay.contains(target)) {
        e.preventDefault()
        return
      }
      if (overlay.scrollHeight <= overlay.clientHeight + 1) {
        e.preventDefault()
      }
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false })

    return () => {
      document.removeEventListener('touchmove', onTouchMove)
      document.body.classList.remove('share-overlay-open')
      document.body.style.overflow = prevBody
      if (main) {
        main.style.overflow = prevMainOverflow
        main.style.touchAction = prevMainTouch
        main.scrollTop = scrollY
      }
    }
  }, [])

  const isProfile = variant === 'profile'
  const categoryLabel = isProfile
    ? 'PROFILE'
    : {
        push: 'PUSH DAY',
        pull: 'PULL DAY',
        legs: 'LEG DAY',
        overall: 'OVERALL',
      }[category] ?? category.toUpperCase()

  const statLabel = isProfile
    ? 'DAY STREAK'
    : category === 'overall'
      ? 'XP'
      : 'BEST LIFT'
  const statValue = isProfile
    ? `${entry.current_streak}`
    : category === 'overall'
      ? `${entry.xp_total.toLocaleString()} XP`
      : `${entry.best_lift === 0 ? '—' : `${fmt(entry.best_lift)}${unitLabel}`}`

  const heroText = isProfile ? String(entry.level) : `#${rank}`
  const heroSub = isProfile ? 'LEVEL' : null
  const rankColor = isProfile
    ? 'var(--accent-text)'
    : (RANK_COLORS[rank] ?? 'var(--accent)')
  const shareText = isProfile
    ? `I'm Level ${entry.level} on GRIND — ${entry.current_streak} day streak · ${entry.total_workouts} workouts · ${entry.xp_total.toLocaleString()} XP`
    : `I'm ranked #${rank} in ${categoryLabel} on GRIND! ${statLabel}: ${statValue} | Level ${entry.level} | ${entry.current_streak} day streak`

  async function handleShareImage() {
    if (sharing) return
    setSharing(true)
    try {
      const blob = await renderShareCardPng({
        displayName: entry.display_name,
        username: entry.username,
        rank,
        categoryLabel,
        statLabel,
        statValue: isProfile ? `${entry.current_streak} days` : statValue,
        level: entry.level,
        streak: entry.current_streak,
        workouts: entry.total_workouts,
        avatarUrl: entry.avatar_url,
        rankColor: isProfile ? '#c8f135' : (SHARE_RANK_HEX[rank] ?? '#c8f135'),
        heroText: isProfile ? String(entry.level) : undefined,
        heroSub: isProfile ? 'LEVEL' : undefined,
      })
      const file = new File(
        [blob],
        isProfile ? 'grind-profile.png' : `grind-rank-${rank}.png`,
        { type: 'image/png' },
      )
      if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: 'GRIND', text: shareText, files: [file] })
      } else if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'GRIND', text: shareText })
      } else {
        // Desktop fallback: download the PNG
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      // User cancel is not an error worth reporting
      if (err instanceof Error && err.name === 'AbortError') return
      reportError(err, { operation: 'shareCardImage', route: isProfile ? '/profile' : '/leaderboard' })
    } finally {
      setSharing(false)
    }
  }

  function handleShareText() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: 'GRIND', text: shareText }).catch(() => {})
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={backdropRef}
      role="presentation"
      tabIndex={-1}
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        // Above bottom nav (100) and Coach FAB (420). Portaled to <body> so
        // .app-main's -webkit-overflow-scrolling: touch cannot trap this
        // overlay inside the scroll pane — otherwise the nav paints over
        // Share text stats. body.share-overlay-open also hides the FAB.
        zIndex: 450,
        paddingTop: 'max(24px, env(safe-area-inset-top))',
        paddingLeft: '24px',
        paddingRight: '24px',
        paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        outline: 'none',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={isProfile ? 'Share your profile' : 'Share your rank'}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          // margin:auto centers when the card fits, and still lets the
          // backdrop scroll when it doesn't (justify-content:center would
          // clip the top of an overflowing column).
          margin: 'auto',
          width: '100%',
          maxWidth: '320px',
          outline: 'none',
        }}
      >
      <div
        className="share-card-dark"
        style={{
          width: '100%',
          backgroundColor: '#0f0f0f',
          border: `2px solid var(--accent)`,
          borderRadius: '16px',
          padding: '32px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '36px',
          color: 'var(--accent-text)',
          letterSpacing: '3px',
          lineHeight: 1,
        }}>GRIND</div>

        <div style={{
          fontSize: '11px',
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 700,
          color: 'var(--text-muted)',
          letterSpacing: '2px',
        }}>{categoryLabel}</div>

        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          overflow: 'hidden',
          backgroundColor: 'var(--surface-elevated)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid var(--border)',
        }}>
          {entry.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: '20px', color: 'var(--text-primary)' }}>
              {initials(entry.display_name)}
            </span>
          )}
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)' }}>
            {entry.display_name}
          </div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', color: 'var(--text-muted)' }}>
            @{entry.username}
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '72px',
            lineHeight: 1,
            color: rankColor,
            letterSpacing: '2px',
          }}>{heroText}</div>
          {heroSub && (
            <div style={{
              fontSize: '11px',
              fontFamily: "'DM Sans', sans-serif",
              color: 'var(--text-muted)',
              letterSpacing: '1px',
              marginTop: '2px',
            }}>{heroSub}</div>
          )}
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--text-primary)',
          }}>{statValue}</div>
          <div style={{ fontSize: '11px', fontFamily: "'DM Sans', sans-serif", color: 'var(--text-muted)', letterSpacing: '1px', marginTop: '2px' }}>
            {statLabel}
          </div>
        </div>

        <div style={{
          display: 'flex',
          gap: '24px',
          borderTop: '1px solid var(--border)',
          paddingTop: '16px',
          width: '100%',
          justifyContent: 'center',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: 'var(--accent-text)' }}>
              {entry.level}
            </div>
            <div style={{ fontSize: '10px', fontFamily: "'DM Sans', sans-serif", color: 'var(--text-muted)', letterSpacing: '1px' }}>
              LEVEL
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: 'var(--accent-text)' }}>
              {entry.current_streak}
            </div>
            <div style={{ fontSize: '10px', fontFamily: "'DM Sans', sans-serif", color: 'var(--text-muted)', letterSpacing: '1px' }}>
              DAY STREAK
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: 'var(--accent-text)' }}>
              {entry.total_workouts}
            </div>
            <div style={{ fontSize: '10px', fontFamily: "'DM Sans', sans-serif", color: 'var(--text-muted)', letterSpacing: '1px' }}>
              WORKOUTS
            </div>
          </div>
        </div>
      </div>

      <div style={{
        marginTop: '20px',
        textAlign: 'center',
        fontFamily: "'DM Sans', sans-serif",
        fontSize: '13px',
        color: 'var(--text-muted)',
      }}>
        Share as an image, or copy text stats
      </div>

      <button
        onClick={handleShareImage}
        disabled={sharing}
        style={{
          marginTop: '12px',
          padding: '10px 24px',
          backgroundColor: 'var(--accent)',
          border: 'none',
          borderRadius: '9999px',
          color: '#0f0f0f',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '14px',
          fontWeight: 700,
          cursor: sharing ? 'default' : 'pointer',
          opacity: sharing ? 0.7 : 1,
        }}
      >
        {sharing ? 'Preparing…' : 'Share image'}
      </button>

      {canShare && (
        <button
          onClick={handleShareText}
          style={{
            marginTop: '12px',
            padding: '10px 24px',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '9999px',
            color: 'var(--text-primary)',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Share text stats
        </button>
      )}

      <button
        onClick={onClose}
        style={{
          marginTop: '12px',
          padding: '10px 24px',
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '14px',
          cursor: 'pointer',
        }}
      >
        Close
      </button>
      </div>
    </div>,
    document.body,
  )
}
