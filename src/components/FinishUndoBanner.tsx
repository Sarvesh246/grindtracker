'use client'
/**
 * Slim 10-minute post-finish undo chip.
 *
 * Mounted on Home (and DaySelect) after a quick-save. CompletionModal covers
 * the live-finish path inside ActiveWorkout. Reads the same `grind_finish_undo`
 * token ActiveWorkout writes so either surface can undo either finish.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { demoSafeClient } from '@/lib/demoMode/demoSafeSupabase'
import { markAppDataStale } from '@/lib/cache/appDataCache'
import { useExitingValue } from '@/lib/hooks/useExitingValue'
import ToastPill, { TOAST_SLIDE_OUT_MS } from '@/components/ToastPill'
import { useToast } from '@/lib/contexts/ToastContext'
import {
  FINISH_UNDO_EVENT,
  type FinishUndoToken,
  clearFinishUndoToken,
  performFinishUndo,
  readFinishUndoToken,
  sameFinishUndoToken,
} from '@/lib/utils/finishUndo'

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function FinishUndoBanner() {
  const router = useRouter()
  const { demoMode } = useDemoMode()
  const supabase = useMemo(
    () => (demoMode ? demoSafeClient(createClient()) : createClient()),
    [demoMode],
  )
  const toast = useToast()
  const [tokenState, setToken] = useState<FinishUndoToken | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [undoing, setUndoing] = useState(false)
  const undoingRef = useRef(false)

  useEffect(() => {
    const sync = () => {
      const latest = readFinishUndoToken()
      setToken(prev => (sameFinishUndoToken(prev, latest) ? prev : latest))
      setRemaining(latest ? latest.expiresAt - Date.now() : 0)
    }
    sync()
    const interval = setInterval(sync, 1000)
    window.addEventListener('storage', sync)
    window.addEventListener(FINISH_UNDO_EVENT, sync)
    return () => {
      clearInterval(interval)
      window.removeEventListener('storage', sync)
      window.removeEventListener(FINISH_UNDO_EVENT, sync)
    }
  }, [])

  const { data: token, closing } = useExitingValue(demoMode ? null : tokenState, TOAST_SLIDE_OUT_MS)

  async function handleUndo() {
    if (!token || undoingRef.current) return
    undoingRef.current = true
    setUndoing(true)
    const day = token.day
    const ok = await performFinishUndo(supabase, token)
    undoingRef.current = false
    setUndoing(false)
    if (!ok) {
      toast.show('Could not undo. Try again.', 'error')
      return
    }
    setToken(null)
    markAppDataStale()
    router.push(`/log?day=${day}`)
  }

  if (!token) return null

  return (
    <ToastPill
      key={token.sessionId}
      edge="bottom"
      exiting={closing}
      role="status"
      aria-live="polite"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom) + 80px)',
        width: 'calc(100% - 32px)',
        maxWidth: '420px',
        backgroundColor: 'var(--surface-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        zIndex: 60,
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: '2px',
        }}>
          {token.xpEarned > 0 ? `Workout saved · +${token.xpEarned} XP` : 'Workout saved'}
        </div>
        <div style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '11px',
          color: 'var(--text-muted)',
        }}>
          Undo available for {formatRemaining(remaining)}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button
          type="button"
          data-haptic="light"
          className="press"
          onClick={() => { if (closing) return; clearFinishUndoToken(); setToken(null) }}
          disabled={closing}
          style={{
            position: 'relative',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '12px',
            padding: '4px 8px',
          }}
        >
          Dismiss
        </button>
        <button
          type="button"
          data-haptic="medium"
          className="press"
          onClick={() => void handleUndo()}
          disabled={undoing || closing}
          style={{
            position: 'relative',
            height: '36px',
            padding: '0 14px',
            backgroundColor: 'var(--accent)',
            color: 'var(--on-accent)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '15px',
            letterSpacing: '0.5px',
            cursor: undoing ? 'default' : 'pointer',
            opacity: undoing ? 0.6 : 1,
          }}
        >
          {undoing ? 'UNDOING…' : 'UNDO'}
        </button>
      </div>
    </ToastPill>
  )
}
