'use client'
import { useState, useEffect } from 'react'
import { LeaderboardEntry } from '@/lib/types'
import { useUnit } from '@/lib/contexts/UnitContext'

const RANK_COLORS: Record<number, string> = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
}

interface ShareCardProps {
  entry: LeaderboardEntry
  rank: number
  category: string
  onClose: () => void
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

export default function ShareCard({ entry, rank, category, onClose }: ShareCardProps) {
  const { unitLabel, fmt } = useUnit()
  const [canShare, setCanShare] = useState(false)
  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && 'share' in navigator)
  }, [])
  const categoryLabel = {
    push: 'PUSH DAY',
    pull: 'PULL DAY',
    legs: 'LEG DAY',
    overall: 'OVERALL',
  }[category] ?? category.toUpperCase()

  const statLabel = category === 'overall' ? 'XP' : 'BEST LIFT'
  const statValue = category === 'overall'
    ? `${entry.xp_total.toLocaleString()} XP`
    : `${entry.best_lift === 0 ? '—' : `${fmt(entry.best_lift)}${unitLabel}`}`

  const rankColor = RANK_COLORS[rank] ?? 'var(--accent)'

  function handleShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({
        title: 'GRIND',
        text: `I'm ranked #${rank} in ${categoryLabel} on GRIND! ${statLabel}: ${statValue} | Level ${entry.level} | ${entry.current_streak} day streak 🏆`,
      }).catch(() => {})
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '24px',
      }}
    >
      {/* Card — stop propagation so clicking it doesn't close */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '320px',
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
        {/* Wordmark */}
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '36px',
          color: 'var(--accent)',
          letterSpacing: '3px',
          lineHeight: 1,
        }}>GRIND</div>

        {/* Category */}
        <div style={{
          fontSize: '11px',
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 700,
          color: 'var(--text-muted)',
          letterSpacing: '2px',
        }}>{categoryLabel}</div>

        {/* Avatar */}
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

        {/* Name */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)' }}>
            {entry.display_name}
          </div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', color: 'var(--text-muted)' }}>
            @{entry.username}
          </div>
        </div>

        {/* Rank */}
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '72px',
          lineHeight: 1,
          color: rankColor,
          letterSpacing: '2px',
        }}>#{rank}</div>

        {/* Key stat */}
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

        {/* Level + streak row */}
        <div style={{
          display: 'flex',
          gap: '24px',
          borderTop: '1px solid var(--border)',
          paddingTop: '16px',
          width: '100%',
          justifyContent: 'center',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: 'var(--accent)' }}>
              {entry.level}
            </div>
            <div style={{ fontSize: '10px', fontFamily: "'DM Sans', sans-serif", color: 'var(--text-muted)', letterSpacing: '1px' }}>
              LEVEL
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: 'var(--accent)' }}>
              {entry.current_streak}
            </div>
            <div style={{ fontSize: '10px', fontFamily: "'DM Sans', sans-serif", color: 'var(--text-muted)', letterSpacing: '1px' }}>
              DAY STREAK
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: 'var(--accent)' }}>
              {entry.total_workouts}
            </div>
            <div style={{ fontSize: '10px', fontFamily: "'DM Sans', sans-serif", color: 'var(--text-muted)', letterSpacing: '1px' }}>
              WORKOUTS
            </div>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div style={{
        marginTop: '20px',
        textAlign: 'center',
        fontFamily: "'DM Sans', sans-serif",
        fontSize: '13px',
        color: 'var(--text-muted)',
      }}>
        Screenshot to share
      </div>

      {canShare && (
        <button
          onClick={handleShare}
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
  )
}
