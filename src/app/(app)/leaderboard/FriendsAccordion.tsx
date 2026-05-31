'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { UserProfile } from '@/lib/types'

interface FriendRow {
  friendship_id: string
  profile: UserProfile
}

interface PendingRow {
  friendship_id: string
  profile: UserProfile
}

interface SentRow {
  friendship_id: string
  profile: UserProfile
}

interface Props {
  userId: string
  onFriendsChange: (friendIds: string[]) => void
}

export default function FriendsAccordion({ userId, onFriendsChange }: Props) {
  const supabase = createClient()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserProfile[]>([])
  const [friends, setFriends] = useState<FriendRow[]>([])
  const [pending, setPending] = useState<PendingRow[]>([])
  const [sent, setSent] = useState<SentRow[]>([])
  const [revealRemove, setRevealRemove] = useState<string | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadFriendsData = useCallback(async () => {
    const { data } = await supabase
      .from('friendships')
      .select('id, requester_id, addressee_id, status')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)

    if (!data) return

    const acceptedIds = data
      .filter(f => f.status === 'accepted')
      .map(f => (f.requester_id === userId ? f.addressee_id : f.requester_id))

    const pendingIncoming = data.filter(f => f.status === 'pending' && f.addressee_id === userId)
    const pendingOutgoing = data.filter(f => f.status === 'pending' && f.requester_id === userId)

    // Fetch profiles for all relevant users
    const allIds = [
      ...acceptedIds,
      ...pendingIncoming.map(f => f.requester_id),
      ...pendingOutgoing.map(f => f.addressee_id),
    ]

    if (allIds.length === 0) {
      setFriends([])
      setPending([])
      setSent([])
      onFriendsChange([])
      return
    }

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('*')
      .in('id', allIds)

    const profileMap = new Map((profiles ?? []).map(p => [p.id, p as UserProfile]))

    const friendRows: FriendRow[] = data
      .filter(f => f.status === 'accepted')
      .map(f => {
        const otherId = f.requester_id === userId ? f.addressee_id : f.requester_id
        const profile = profileMap.get(otherId)
        if (!profile) return null
        return { friendship_id: f.id, profile }
      })
      .filter((x): x is FriendRow => x !== null)

    const pendingRows: PendingRow[] = pendingIncoming
      .map(f => {
        const profile = profileMap.get(f.requester_id)
        if (!profile) return null
        return { friendship_id: f.id, profile }
      })
      .filter((x): x is PendingRow => x !== null)

    const sentRows: SentRow[] = pendingOutgoing
      .map(f => {
        const profile = profileMap.get(f.addressee_id)
        if (!profile) return null
        return { friendship_id: f.id, profile }
      })
      .filter((x): x is SentRow => x !== null)

    setFriends(friendRows)
    setPending(pendingRows)
    setSent(sentRows)
    onFriendsChange(friendRows.map(f => f.profile.id))
  }, [userId, supabase, onFriendsChange])

  useEffect(() => { loadFriendsData() }, [loadFriendsData])

  // Debounced username search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim().toLowerCase()
    if (!q) { setSearchResults([]); return }

    debounceRef.current = setTimeout(async () => {
      const existingIds = [
        userId,
        ...friends.map(f => f.profile.id),
        ...pending.map(p => p.profile.id),
        ...sent.map(s => s.profile.id),
      ]
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .ilike('username', `%${q}%`)
        .not('id', 'in', `(${existingIds.join(',')})`)
        .limit(6)
      setSearchResults((data ?? []) as UserProfile[])
    }, 350)
  }, [query, userId, friends, pending, sent])

  async function sendRequest(targetId: string) {
    await supabase.from('friendships').insert({ requester_id: userId, addressee_id: targetId })
    setQuery('')
    setSearchResults([])
    loadFriendsData()
  }

  async function acceptRequest(friendshipId: string) {
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId)
    loadFriendsData()
  }

  async function declineRequest(friendshipId: string) {
    await supabase.from('friendships').delete().eq('id', friendshipId)
    loadFriendsData()
  }

  async function cancelRequest(friendshipId: string) {
    await supabase.from('friendships').delete().eq('id', friendshipId)
    loadFriendsData()
  }

  async function removeFriend(friendshipId: string) {
    await supabase.from('friendships').delete().eq('id', friendshipId)
    setRevealRemove(null)
    loadFriendsData()
  }

  function startLongPress(id: string) {
    longPressRef.current = setTimeout(() => setRevealRemove(id), 500)
  }

  function cancelLongPress() {
    if (longPressRef.current) clearTimeout(longPressRef.current)
  }

  const pendingCount = pending.length

  return (
    <div style={{
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      overflow: 'hidden',
      marginBottom: '20px',
    }}>
      {/* Accordion header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '18px',
            color: 'var(--text-primary)',
            letterSpacing: '1px',
          }}>FRIENDS</span>
          {pendingCount > 0 && (
            <span style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--on-accent)',
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700,
              fontSize: '11px',
              borderRadius: '9999px',
              padding: '2px 7px',
              lineHeight: 1.4,
            }}>{pendingCount}</span>
          )}
        </div>
        {/* Chevron */}
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Search */}
          <div>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by username…"
              autoComplete="off"
              autoCapitalize="none"
              style={{
                width: '100%',
                padding: '10px 14px',
                backgroundColor: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {searchResults.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {searchResults.map(u => (
                  <div key={u.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    backgroundColor: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                  }}>
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {u.display_name}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: 'var(--text-muted)' }}>
                        @{u.username}
                      </div>
                    </div>
                    <button
                      onClick={() => sendRequest(u.id)}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: 'var(--accent)',
                        color: 'var(--on-accent)',
                        border: 'none',
                        borderRadius: '9999px',
                        fontFamily: "'DM Sans', sans-serif",
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >Add</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending incoming */}
          {pending.length > 0 && (
            <div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: '8px' }}>
                REQUESTS
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {pending.map(p => (
                  <div key={p.friendship_id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    backgroundColor: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                  }}>
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {p.profile.display_name}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: 'var(--text-muted)' }}>
                        @{p.profile.username}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => acceptRequest(p.friendship_id)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'var(--accent)',
                          color: 'var(--on-accent)',
                          border: 'none',
                          borderRadius: '9999px',
                          fontFamily: "'DM Sans', sans-serif",
                          fontWeight: 700,
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >Accept</button>
                      <button
                        onClick={() => declineRequest(p.friendship_id)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'transparent',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border)',
                          borderRadius: '9999px',
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sent requests */}
          {sent.length > 0 && (
            <div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: '8px' }}>
                PENDING
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {sent.map(s => (
                  <div key={s.friendship_id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    backgroundColor: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                  }}>
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {s.profile.display_name}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: 'var(--text-muted)' }}>
                        @{s.profile.username} · Request sent
                      </div>
                    </div>
                    <button
                      onClick={() => cancelRequest(s.friendship_id)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: 'transparent',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border)',
                        borderRadius: '9999px',
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >Cancel</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Friends list */}
          {friends.length > 0 && (
            <div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: '8px' }}>
                {friends.length} {friends.length === 1 ? 'FRIEND' : 'FRIENDS'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {friends.map(f => (
                  <div
                    key={f.friendship_id}
                    onPointerDown={() => startLongPress(f.friendship_id)}
                    onPointerUp={cancelLongPress}
                    onPointerLeave={cancelLongPress}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      backgroundColor: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      userSelect: 'none',
                    }}
                  >
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {f.profile.display_name}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: 'var(--text-muted)' }}>
                        @{f.profile.username}
                      </div>
                    </div>
                    {revealRemove === f.friendship_id ? (
                      <button
                        onClick={() => removeFriend(f.friendship_id)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'rgba(239,68,68,0.1)',
                          color: 'var(--danger)',
                          border: '1px solid var(--danger)',
                          borderRadius: '9999px',
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >Remove</button>
                    ) : (
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: 'var(--text-muted)' }}>
                        Hold to remove
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {friends.length === 0 && pending.length === 0 && sent.length === 0 && !query && (
            <div style={{
              textAlign: 'center',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '13px',
              color: 'var(--text-muted)',
              padding: '8px 0',
            }}>
              Search for friends by username above
            </div>
          )}
        </div>
      )}
    </div>
  )
}
