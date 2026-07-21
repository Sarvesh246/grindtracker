'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LeaderboardEntry } from '@/lib/types'
import FriendsAccordion from './FriendsAccordion'
import ShareCard from './ShareCard'
import { useUnit } from '@/lib/contexts/UnitContext'

type Category = 'push' | 'pull' | 'legs' | 'overall'

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'push', label: 'PUSH' },
  { key: 'pull', label: 'PULL' },
  { key: 'legs', label: 'LEGS' },
  { key: 'overall', label: 'OVERALL' },
]

const RANK_COLORS: Record<number, string> = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

interface Props {
  userId: string
}

export default function LeaderboardClient({ userId }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const { unitLabel, fmt } = useUnit()
  const [category, setCategory] = useState<Category>('overall')
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [friendIds, setFriendIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [shareTarget, setShareTarget] = useState<{ entry: LeaderboardEntry; rank: number } | null>(null)
  // Tracks the most recently issued request. Earlier in-flight requests dropped
  // their result outright when a newer one started — fine for the same category,
  // but switching categories fast (e.g. PULL then LEGS before the first resolves)
  // meant the second fetch was silently skipped, leaving stale/mismatched data
  // on screen under the newly selected tab. Now every fetch runs; only the
  // response matching the *latest* request is ever committed to state.
  const requestIdRef = useRef(0)

  const fetchLeaderboard = useCallback(async (cat: Category, fIds: string[]) => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    const userIds = [userId, ...fIds]
    const { data, error } = await supabase.rpc('get_leaderboard', {
      p_day_type: cat,
      p_user_ids: userIds,
    })
    if (reqId !== requestIdRef.current) return
    setLoading(false)
    if (!error && data) {
      setEntries(data as LeaderboardEntry[])
    }
  }, [userId, supabase])

  // Refetch when category or friends change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLeaderboard(category, friendIds)
  }, [category, friendIds, fetchLeaderboard])

  // Refetch on window focus
  useEffect(() => {
    const handler = () => fetchLeaderboard(category, friendIds)
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [category, friendIds, fetchLeaderboard])

  const myEntry = entries.find(e => e.user_id === userId)
  const myRank = myEntry ? entries.indexOf(myEntry) + 1 : null

  function statDisplay(entry: LeaderboardEntry) {
    if (category === 'overall') return `${entry.xp_total.toLocaleString()} XP`
    if (entry.best_lift === 0) return '—'
    return `${fmt(entry.best_lift)}${unitLabel}`
  }

  return (
    <div className="page page--narrow" style={{
      minHeight: '100%',
      backgroundColor: 'var(--bg)',
      padding: '24px 16px',
      paddingBottom: 'calc(80px + env(safe-area-inset-bottom))',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '24px',
      }}>
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '32px',
          color: 'var(--text-primary)',
          letterSpacing: '1px',
          lineHeight: 1,
        }}>RANKS</div>
        {myEntry && myRank && (
          <button
            onClick={() => setShareTarget({ entry: myEntry, rank: myRank })}
            title="Share your rank"
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>
        )}
      </div>

      {/* Friends accordion */}
      <FriendsAccordion userId={userId} onFriendsChange={setFriendIds} />

      {/* Category tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '16px',
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}>
        {CATEGORIES.map(c => {
          const active = category === c.key
          return (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              style={{
                padding: '7px 16px',
                borderRadius: '9999px',
                border: active ? 'none' : '1px solid var(--border)',
                backgroundColor: active ? 'var(--accent)' : 'transparent',
                color: active ? 'var(--on-accent)' : 'var(--text-muted)',
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 700,
                fontSize: '12px',
                letterSpacing: '0.5px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 150ms ease',
              }}
            >{c.label}</button>
          )
        })}
      </div>

      {/* Category subtitle */}
      <div style={{
        fontFamily: "'DM Sans', sans-serif",
        fontSize: '12px',
        color: 'var(--text-muted)',
        marginBottom: '16px',
      }}>
        {category === 'overall' ? 'Ranked by total XP' : `Ranked by heaviest lift ever logged on ${category} day`}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{
          textAlign: 'center',
          padding: '40px 0',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '14px',
          color: 'var(--text-muted)',
        }}>Loading…</div>
      )}

      {/* Empty state */}
      {!loading && entries.length <= 1 && friendIds.length === 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          padding: '48px 24px',
          textAlign: 'center',
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
            stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="13" width="6" height="8" rx="1" />
            <rect x="9" y="9" width="6" height="12" rx="1" />
            <rect x="16" y="5" width="6" height="16" rx="1" />
          </svg>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: 'var(--text-primary)', letterSpacing: '1px' }}>
            ADD FRIENDS TO COMPETE
          </div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: 'var(--text-muted)', maxWidth: '240px', lineHeight: 1.5 }}>
            Open the Friends section above and search for people to add.
          </div>
        </div>
      )}

      {/* Leaderboard rows */}
      {!loading && entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {entries.map((entry, idx) => {
            const rank = idx + 1
            const isMe = entry.user_id === userId
            const rankColor = RANK_COLORS[rank]

            return (
              <div
                key={entry.user_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 14px',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  borderLeft: isMe ? '3px solid var(--accent)' : '1px solid var(--border)',
                }}
              >
                {/* Rank */}
                <div style={{
                  minWidth: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {rank <= 3 ? (
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: rankColor + '22',
                      border: `2px solid ${rankColor}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <span style={{
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontSize: '16px',
                        color: rankColor,
                        lineHeight: 1,
                      }}>{rank}</span>
                    </div>
                  ) : (
                    <span style={{
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: '22px',
                      color: 'var(--text-muted)',
                      lineHeight: 1,
                    }}>{rank}</span>
                  )}
                </div>

                {/* Avatar */}
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  overflow: 'hidden',
                  backgroundColor: 'var(--surface-elevated)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  border: '1px solid var(--border)',
                }}>
                  {entry.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {initials(entry.display_name)}
                    </span>
                  )}
                </div>

                {/* Name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 600,
                    fontSize: '14px',
                    color: isMe ? 'var(--accent-text)' : 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {entry.display_name}{isMe ? ' (you)' : ''}
                  </div>
                  <div style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                  }}>
                    Lv {entry.level} · {entry.current_streak}d streak
                  </div>
                </div>

                {/* Stat */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '15px',
                    fontWeight: 700,
                    color: rank === 1 ? RANK_COLORS[1] : 'var(--text-primary)',
                  }}>
                    {statDisplay(entry)}
                  </div>
                  <div style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    letterSpacing: '0.5px',
                    marginTop: '2px',
                  }}>
                    {category === 'overall' ? 'XP' : 'BEST LIFT'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Share card modal */}
      {shareTarget && (
        <ShareCard
          entry={shareTarget.entry}
          rank={shareTarget.rank}
          category={category}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  )
}
