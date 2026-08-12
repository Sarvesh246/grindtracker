'use client'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { UserProfile } from '@/lib/types'
import { useToast } from '@/lib/contexts/ToastContext'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { DEMO_FRIENDS, DEMO_PENDING_INCOMING, DEMO_SENT } from '@/lib/demoMode/fakeData'
import { CACHE_KEYS, getCached, isFresh, markAppDataStale, setCached } from '@/lib/cache/appDataCache'

// Pin the projection instead of `select('*')`. Every column here is safe to
// show to another user; selecting explicitly means a column added to
// `user_profiles` later can't silently start leaking into friend search.
const PROFILE_COLUMNS = 'id, username, display_name, avatar_url, created_at'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// How long a friend row must be held before it's removed. Long enough that a
// stray tap — or an iOS text-selection long-press — can't trigger it by
// accident; the filling bar is the feedback that tells the user how close
// they are to a deliberate hold actually completing.
const HOLD_TO_REMOVE_MS = 1800

// A hold that drifts more than this many px is a scroll/selection gesture,
// not a stationary hold — cancel rather than let it keep counting down.
const HOLD_CANCEL_DRIFT_PX = 10

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

type FriendsCache = {
  friends: FriendRow[]
  pending: PendingRow[]
  sent: SentRow[]
  ids: string[]
}

interface Props {
  userId: string
  onFriendsChange: (friendIds: string[]) => void
}

export default function FriendsAccordion({ userId, onFriendsChange }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const { demoMode } = useDemoMode()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserProfile[]>([])
  const [friends, setFriends] = useState<FriendRow[]>([])
  const [pending, setPending] = useState<PendingRow[]>([])
  const [sent, setSent] = useState<SentRow[]>([])
  // Which friend row is currently mid-hold — drives the filling removal bar.
  const [holdingId, setHoldingId] = useState<string | null>(null)
  // Surfaced when a friendship mutation is rejected — most often the unique-pair
  // index, now that duplicate requests are a constraint violation rather than a
  // silently-inserted second row.
  const [actionError, setActionError] = useState<string | null>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdStartPos = useRef<{ x: number; y: number } | null>(null)
  // Stored so cancelHold always removes the exact listener instance startHold
  // added — a plain function declared in the component body gets a new
  // identity every render, so referencing it by name in removeEventListener
  // from a later render would silently fail to unregister the old one.
  const selectionListenerRef = useRef<(() => void) | null>(null)

  const loadFriendsData = useCallback(async () => {
    if (demoMode) {
      setFriends(DEMO_FRIENDS)
      setPending(DEMO_PENDING_INCOMING)
      setSent(DEMO_SENT)
      onFriendsChange(DEMO_FRIENDS.map(f => f.profile.id))
      return
    }

    const cached = getCached<FriendsCache>(CACHE_KEYS.friends)
    if (cached) {
      setFriends(cached.friends)
      setPending(cached.pending)
      setSent(cached.sent)
      onFriendsChange(cached.ids)
      if (isFresh(CACHE_KEYS.friends)) return
    }

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
      const empty: FriendsCache = { friends: [], pending: [], sent: [], ids: [] }
      setCached(CACHE_KEYS.friends, empty)
      setFriends([])
      setPending([])
      setSent([])
      onFriendsChange([])
      return
    }

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select(PROFILE_COLUMNS)
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

    const payload: FriendsCache = {
      friends: friendRows,
      pending: pendingRows,
      sent: sentRows,
      ids: friendRows.map(f => f.profile.id),
    }
    setCached(CACHE_KEYS.friends, payload)
    setFriends(friendRows)
    setPending(pendingRows)
    setSent(sentRows)
    onFriendsChange(payload.ids)
  }, [userId, supabase, onFriendsChange, demoMode])

  // Initial + dependency-driven load of the friendship graph from Supabase.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadFriendsData() }, [loadFriendsData])

  // Debounced username search — skipped entirely in Demo Mode so a real
  // username search never hits the screen while faking the rest of the page.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim().toLowerCase()
    // Clear stale results as the user types; the lookup below is debounced.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!q || demoMode) { setSearchResults([]); return }

    debounceRef.current = setTimeout(async () => {
      const existingIds = [
        userId,
        ...friends.map(f => f.profile.id),
        ...pending.map(p => p.profile.id),
        ...sent.map(s => s.profile.id),
      ]
      // `existingIds` is interpolated into a PostgREST filter string, so every
      // element must be a syntactically valid uuid — a stray comma or paren
      // would change the meaning of the filter. They come from Supabase, but
      // filter that assumption rather than trusting it.
      const safeIds = existingIds.filter(id => UUID_RE.test(id))
      const { data } = await supabase
        .from('user_profiles')
        .select(PROFILE_COLUMNS)
        .ilike('username', `%${q}%`)
        .not('id', 'in', `(${safeIds.join(',')})`)
        .limit(6)
      setSearchResults((data ?? []) as UserProfile[])
    }, 350)
  }, [query, userId, friends, pending, sent, supabase, demoMode])

  async function sendRequest(targetId: string) {
    if (demoMode) return
    // `status` is set explicitly rather than left to the column default: the
    // INSERT policy (docs/sql/12-friendship-authz.sql) requires 'pending', and
    // relying on a default to satisfy a policy is a silent dependency.
    const { error } = await supabase.from('friendships').insert({
      requester_id: userId,
      addressee_id: targetId,
      status: 'pending',
    })

    if (error) {
      // Most likely the unique-pair index: a relationship already exists in one
      // direction or the other.
      setActionError(
        error.code === '23505'
          ? 'You already have a request or friendship with that user.'
          : 'Could not send the request. Try again.'
      )
      return
    }

    setActionError(null)
    setQuery('')
    setSearchResults([])
    markAppDataStale()
    loadFriendsData()
    toast.show('Request sent')
  }

  async function acceptRequest(friendshipId: string) {
    if (demoMode) return
    // Only the addressee can accept, enforced in Postgres — the requester has
    // no UPDATE path at all, which is what prevents accepting your own request.
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId)

    if (error) {
      setActionError('Could not accept the request. Try again.')
      return
    }

    setActionError(null)
    markAppDataStale()
    loadFriendsData()
    toast.show('Friend added')
  }

  async function declineRequest(friendshipId: string) {
    if (demoMode) return
    await supabase.from('friendships').delete().eq('id', friendshipId)
    markAppDataStale()
    loadFriendsData()
  }

  async function cancelRequest(friendshipId: string) {
    if (demoMode) return
    await supabase.from('friendships').delete().eq('id', friendshipId)
    markAppDataStale()
    loadFriendsData()
  }

  async function removeFriend(friendshipId: string) {
    if (demoMode) return
    await supabase.from('friendships').delete().eq('id', friendshipId)
    setHoldingId(null)
    markAppDataStale()
    loadFriendsData()
  }

  // Holding a row fills its bar over HOLD_TO_REMOVE_MS (CSS transition keyed
  // off `holdingId`); if the timer completes uninterrupted, the friend is
  // removed. Releasing early, drifting the pointer, or the row's text
  // getting selected (an iOS PWA long-press quirk — see the selectionchange
  // listener below) all cancel it. cancelHold's own state update snaps the
  // bar back down via a much shorter transition instead of reversing the
  // full hold duration.
  function startHold(id: string, x: number, y: number) {
    if (demoMode) return
    setHoldingId(id)
    holdStartPos.current = { x, y }
    window.getSelection()?.removeAllRanges()

    // iOS Safari (including installed PWAs) can start a text-selection
    // long-press on the row's own name/username text even with
    // user-select/-webkit-touch-callout set to none — that selection doesn't
    // stop our JS timer on its own, so watch for it explicitly and bail.
    const onSelectionChange = () => {
      const sel = window.getSelection()
      if (sel && sel.toString().length > 0) cancelHold()
    }
    selectionListenerRef.current = onSelectionChange
    document.addEventListener('selectionchange', onSelectionChange)

    holdTimerRef.current = setTimeout(() => {
      if (selectionListenerRef.current) {
        document.removeEventListener('selectionchange', selectionListenerRef.current)
        selectionListenerRef.current = null
      }
      removeFriend(id)
    }, HOLD_TO_REMOVE_MS)
  }

  function cancelHold() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (selectionListenerRef.current) {
      document.removeEventListener('selectionchange', selectionListenerRef.current)
      selectionListenerRef.current = null
    }
    holdStartPos.current = null
    window.getSelection()?.removeAllRanges()
    setHoldingId(null)
  }

  function handleHoldPointerMove(x: number, y: number) {
    if (!holdStartPos.current) return
    const dx = x - holdStartPos.current.x
    const dy = y - holdStartPos.current.y
    if (Math.hypot(dx, dy) > HOLD_CANCEL_DRIFT_PX) cancelHold()
  }

  // Belt-and-suspenders: don't leave a timer/listener running if the
  // accordion (or the whole page) unmounts mid-hold.
  useEffect(() => () => cancelHold(), [])

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
        className="press"
        data-haptic="light"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="friends-panel"
        style={{
          position: 'relative',
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

      {/* Always mounted so the panel animates open/closed (.drawer in
          globals.css); `inert` keeps the collapsed controls untabbable. */}
      <div className="drawer" data-open={open}>
        <div>
        {/* 4px top padding keeps the drawer's clip off the first control's
            focus ring: outline-offset 2px + outline width 2px = 4px needed. */}
        <div id="friends-panel" inert={!open} style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {actionError && (
            <div role="alert" style={{
              fontSize: '13px',
              color: 'var(--danger)',
              fontFamily: "'DM Sans', sans-serif",
              lineHeight: 1.4,
            }}>
              {actionError}
            </div>
          )}

          {demoMode && (
            <div style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              fontFamily: "'DM Sans', sans-serif",
              fontStyle: 'italic',
            }}>
              Demo Mode — friend actions disabled
            </div>
          )}

          {/* Search */}
          <div>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by username…"
              autoComplete="off"
              autoCapitalize="none"
              disabled={demoMode}
              style={{
                width: '100%',
                padding: '10px 14px',
                backgroundColor: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                opacity: demoMode ? 0.5 : 1,
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '16px', // ≥16px — anything smaller makes iOS auto-zoom on focus
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
                      data-haptic="medium"
                      onClick={() => sendRequest(u.id)}
                      style={{
                        position: 'relative',
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
                        data-haptic="medium"
                        onClick={() => acceptRequest(p.friendship_id)}
                        disabled={demoMode}
                        style={{
                          position: 'relative',
                          padding: '6px 12px',
                          backgroundColor: 'var(--accent)',
                          color: 'var(--on-accent)',
                          border: 'none',
                          borderRadius: '9999px',
                          fontFamily: "'DM Sans', sans-serif",
                          fontWeight: 700,
                          fontSize: '12px',
                          cursor: demoMode ? 'default' : 'pointer',
                          opacity: demoMode ? 0.5 : 1,
                        }}
                      >Accept</button>
                      <button
                        data-haptic="light"
                        onClick={() => declineRequest(p.friendship_id)}
                        disabled={demoMode}
                        style={{
                          position: 'relative',
                          padding: '6px 12px',
                          backgroundColor: 'transparent',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border)',
                          borderRadius: '9999px',
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: '12px',
                          cursor: demoMode ? 'default' : 'pointer',
                          opacity: demoMode ? 0.5 : 1,
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
                      disabled={demoMode}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: 'transparent',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border)',
                        borderRadius: '9999px',
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: '12px',
                        cursor: demoMode ? 'default' : 'pointer',
                        opacity: demoMode ? 0.5 : 1,
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
                {friends.map(f => {
                  const holding = holdingId === f.friendship_id
                  return (
                    <div
                      key={f.friendship_id}
                      onPointerDown={e => { e.stopPropagation(); startHold(f.friendship_id, e.clientX, e.clientY) }}
                      onPointerMove={e => { e.stopPropagation(); handleHoldPointerMove(e.clientX, e.clientY) }}
                      onPointerUp={cancelHold}
                      onPointerLeave={cancelHold}
                      onPointerCancel={cancelHold}
                      onContextMenu={e => e.preventDefault()}
                      style={{
                        position: 'relative',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        backgroundColor: 'var(--bg)',
                        border: `1px solid ${holding ? 'var(--danger)' : 'var(--border)'}`,
                        borderRadius: '8px',
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                        // iOS Safari/PWA won't suppress the long-press
                        // selection callout from user-select alone.
                        WebkitTouchCallout: 'none',
                        WebkitTapHighlightColor: 'transparent',
                        touchAction: 'none',
                        transition: 'border-color 150ms ease',
                      }}
                    >
                      {/* Fill indicator — grows over the full hold duration
                          (linear, so it reads as a countdown) but snaps back
                          quickly on release rather than un-filling at the
                          same slow rate. */}
                      <div
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: holding ? '100%' : '0%',
                          backgroundColor: 'rgba(239,68,68,0.16)',
                          transition: holding
                            ? `width ${HOLD_TO_REMOVE_MS}ms linear`
                            : 'width 150ms ease',
                        }}
                      />
                      <div style={{ position: 'relative' }}>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>
                          {f.profile.display_name}
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: 'var(--text-muted)' }}>
                          @{f.profile.username}
                        </div>
                      </div>
                      <div style={{
                        position: 'relative',
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: '12px',
                        color: holding ? 'var(--danger)' : 'var(--text-muted)',
                        fontWeight: holding ? 700 : 400,
                      }}>
                        {demoMode ? '' : holding ? 'Keep holding…' : 'Hold to remove'}
                      </div>
                    </div>
                  )
                })}
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
        </div>
      </div>
    </div>
  )
}
