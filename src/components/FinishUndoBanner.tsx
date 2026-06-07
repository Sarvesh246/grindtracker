'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { FinishUndoToken } from '@/app/(app)/log/ActiveWorkout'

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
    const t = readToken()
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

    await Promise.all([
      supabase.from('sessions').update({ completed_at: null, xp_earned: 0 }).eq('id', token.sessionId),
      supabase.from('user_stats').update({
        xp_total: token.prevXpTotal,
        level: token.prevLevel,
        current_streak: token.prevStreak,
        longest_streak: token.prevLongestStreak,
        last_workout_date: token.prevLastWorkoutDate,
        total_workouts: token.prevTotalWorkouts,
      }).eq('user_id', user.id),
      supabase.from('user_rotation').update({ current_index: token.prevRotationIndex }).eq('user_id', user.id),
    ])

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
