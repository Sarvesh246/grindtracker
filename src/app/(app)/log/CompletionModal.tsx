'use client'
import { useEffect, useState } from 'react'
import { ALL_BADGES } from '@/lib/utils/badges'
import { useUnit } from '@/lib/contexts/UnitContext'

interface CompletionData {
  xpEarned: number
  leveledUp: boolean
  newLevel: number
  prCount: number
  prExercises: { name: string; weight: number }[]
  newBadges: string[]
  duration: number
  setsCompleted: number
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

export default function CompletionModal({
  data,
  onDone,
}: {
  data: CompletionData
  onDone: () => void
}) {
  const [visible, setVisible] = useState(false)
  const { unitLabel, fmt } = useUnit()

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'flex-end',
    }}>
      <div style={{
        width: '100%',
        backgroundColor: 'var(--surface)',
        borderRadius: '20px 20px 0 0',
        border: '1px solid var(--border)',
        borderBottom: 'none',
        padding: '32px 24px 48px',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 300ms ease',
        maxHeight: '90dvh',
        overflowY: 'auto',
      }}>

        <div style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '40px', color: 'var(--accent-text)',
          textAlign: 'center', letterSpacing: '2px',
          marginBottom: '8px',
        }}>
          WORKOUT COMPLETE
        </div>

        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '72px', lineHeight: 1,
            color: 'var(--text-primary)',
          }}>
            <span style={{ color: 'var(--accent-text)' }}>+</span>{data.xpEarned}
          </span>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '2px' }}>
            XP EARNED
          </div>
        </div>

        {data.leveledUp && (
          <div style={{
            backgroundColor: 'rgba(200, 241, 53, 0.08)',
            border: '1px solid rgba(200, 241, 53, 0.25)',
            borderRadius: '12px',
            padding: '14px',
            textAlign: 'center',
            marginBottom: '20px',
          }}>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '28px', color: 'var(--accent-text)', letterSpacing: '1px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              LEVEL UP → LVL {data.newLevel}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {[
            { label: 'DURATION', value: formatDuration(data.duration) },
            { label: 'SETS', value: String(data.setsCompleted) },
            { label: 'PRs', value: String(data.prCount) },
          ].map(stat => (
            <div key={stat.label} style={{
              flex: 1,
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '12px 8px',
              textAlign: 'center',
            }}>
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '26px', color: 'var(--text-primary)', lineHeight: 1, marginBottom: '4px',
              }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {data.prExercises.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>
              PERSONAL RECORDS
            </div>
            {data.prExercises.map((pr, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 12px',
                backgroundColor: 'var(--surface-elevated)',
                borderRadius: '8px',
                marginBottom: '6px',
              }}>
                <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{pr.name}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '14px', color: 'var(--accent-text)',
                  }}>
                    {fmt(pr.weight)} {unitLabel}
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
                    <polyline points="8 6 12 2 16 6"/><path d="M12 2v10"/><path d="M5 17l1.5-5h11L19 17"/><path d="M3 22h18"/>
                  </svg>
                </span>
              </div>
            ))}
          </div>
        )}

        {data.newBadges.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>
              BADGES EARNED
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {data.newBadges.map(badgeId => {
                const badge = ALL_BADGES.find(b => b.id === badgeId)
                if (!badge) return null
                return (
                  <div key={badgeId} style={{
                    backgroundColor: 'rgba(200, 241, 53, 0.08)',
                    border: '1px solid rgba(200, 241, 53, 0.25)',
                    borderRadius: '9999px',
                    padding: '6px 14px',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                    <span style={{ fontSize: '13px', color: 'var(--accent-text)', fontWeight: 600 }}>{badge.label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <button
          onClick={onDone}
          style={{
            width: '100%', height: '56px',
            backgroundColor: 'var(--accent)',
            color: 'var(--on-accent)',
            border: 'none', borderRadius: '12px',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '22px', letterSpacing: '1px',
            cursor: 'pointer',
          }}
        >
          BACK TO HOME
        </button>
      </div>
    </div>
  )
}
