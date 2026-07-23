'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { FinishUndoToken } from '@/app/(app)/log/ActiveWorkout'
import { localDateKey } from '@/lib/utils/formatting'

const UNDO_KEY = 'grind_finish_undo'

function readToken(): FinishUndoToken | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(UNDO_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as FinishUndoToken
    if (Date.now() > t.expiresAt) { localStorage.removeItem(UNDO_KEY); return null }
    return t
  } catch { return null }
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function FinishUndoBanner() {
  const router = useRouter()
  const supabase = createClient()
  const [token, setToken] = useState<FinishUndoToken | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [undoing, setUndoing] = useState(false)

  useEffect(() => {
    // Hydrate from the localStorage undo token (client-only external store) and
    // then poll it every second for expiry/changes.
    const t = readToken()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t) { setToken(t); setRemaining(t.expiresAt - Date.now()) }

    const interval = setInterval(() => {
      const latest = readToken()
      setToken(latest)
      setRemaining(latest ? latest.expiresAt - Date.now() : 0)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  if (!token) return null

  async function handleUndo() {
    if (!token || undoing) return
    setUndoing(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.id !== token.userId) { setUndoing(false); return }

    // Server reopens the session and re-derives stats from the logs (see
    // ActiveWorkout.handleUndoFinish for the same reasoning).
    const { error } = await supabase.rpc('uncomplete_session', {
      p_session_id: token.sessionId,
      p_local_date: localDateKey(new Date()),
    })

    if (error) {
      setUndoing(false)
      return
    }

    await supabase
      .from('user_rotation')
      .update({ current_index: token.prevRotationIndex })
      .eq('user_id', user.id)

    localStorage.removeItem(UNDO_KEY)
    setToken(null)
    setUndoing(false)
    router.push(`/log?day=${token.day}`)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom) + 80px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 32px)',
        maxWidth: '420px',
        backgroundColor: 'var(--surface-elevated)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        zIndex: 400,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
          Accidentally finished?
        </div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '11px', color: 'var(--text-muted)' }}>
          Resume available for {formatRemaining(remaining)}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button
          onClick={() => { localStorage.removeItem(UNDO_KEY); setToken(null) }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif",
            fontSize: '12px', padding: '4px 8px',
          }}
        >
          Dismiss
        </button>
        <button
          onClick={handleUndo}
          disabled={undoing}
          style={{
            height: '36px', padding: '0 14px',
            backgroundColor: 'var(--accent)',
            color: 'var(--on-accent)',
            border: 'none', borderRadius: '8px',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '15px', letterSpacing: '0.5px',
            cursor: undoing ? 'default' : 'pointer',
            opacity: undoing ? 0.6 : 1,
          }}
        >
          {undoing ? 'RESUMING...' : 'RESUME'}
        </button>
      </div>
    </div>
  )
}
