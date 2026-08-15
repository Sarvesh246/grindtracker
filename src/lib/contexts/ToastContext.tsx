'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useKeyboardInset } from '@/lib/hooks/useKeyboardInset'
import { useExitingValue } from '@/lib/hooks/useExitingValue'
import ToastPill, { TOAST_SLIDE_OUT_MS } from '@/components/ToastPill'

type ToastVariant = 'success' | 'error'
type ToastPayload = { id: number; message: string; variant: ToastVariant }

interface ToastAPI {
  /** Flash a brief, passive bottom-anchored pill. Defaults to a "saved"-style
   *  success confirmation; pass 'error' for a failure that needs to read as
   *  visually distinct, not just differently-worded. */
  show: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastAPI>({ show: () => {} })

/** Access the app-wide confirmation toast. No-ops if used outside the provider. */
export function useToast(): ToastAPI {
  return useContext(ToastContext)
}

/**
 * App-wide confirmation toast — one bottom-anchored pill that reassures the
 * user an action persisted ("Weight logged", "Request sent"), then slides off
 * on its own. Swipe it any direction to dismiss early. Mounted once in the
 * (app) layout so any page can call `useToast().show(...)` without wiring
 * up its own toast state.
 *
 * The full-width anchor is `pointer-events: none` so only the pill itself is
 * hittable — never the page underneath. It rides above the on-screen keyboard
 * so a confirmation fired right after an edit stays visible while typing.
 *
 * ActiveWorkout keeps its own bespoke save toast — that one is positioned to
 * clear the live workout's finish/rest bars, which this generic offset can't
 * know about. Both share the same visual so they read identically.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [payload, setPayload] = useState<ToastPayload | null>(null)
  const timer = useRef<NodeJS.Timeout | null>(null)
  const idRef = useRef(0)
  const keyboardInset = useKeyboardInset()
  const exit = useExitingValue(payload, TOAST_SLIDE_OUT_MS)

  const show = useCallback((msg: string, v: ToastVariant = 'success') => {
    idRef.current += 1
    setPayload({ id: idRef.current, message: msg, variant: v })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setPayload(null), 1900)
  }, [])

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setPayload(null)
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const isError = exit.data?.variant === 'error'
  const contextValue = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {exit.data && (
        <ToastPill
          key={exit.data.id}
          edge="bottom"
          exiting={exit.closing}
          onDismiss={dismiss}
          role="status"
          aria-live="polite"
          style={{
            // Clear the mobile bottom nav (~84px) normally; when the keyboard is
            // up, sit just above it instead so the confirmation stays visible.
            bottom: keyboardInset > 0
              ? `calc(${keyboardInset}px + 16px)`
              : 'calc(env(safe-area-inset-bottom) + 84px)',
            backgroundColor: 'var(--surface-elevated)',
            border: `1px solid ${isError ? 'var(--danger)' : 'var(--accent)'}`,
            color: isError ? 'var(--danger)' : 'var(--accent-text)',
            padding: '9px 16px',
            borderRadius: 'var(--radius-pill, 9999px)',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            whiteSpace: 'nowrap',
            maxWidth: 'calc(100vw - 32px)',
            // Above every overlay in the app (highest is PlateCalculator at
            // 600) — this toast needs to read as "always on top", since it
            // now fires from inside modals too (e.g. WorkoutManager's
            // exercise toggle, itself at 500).
            zIndex: 700,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            {isError ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <polyline points="20 6 9 17 4 12" />
            )}
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{exit.data.message}</span>
        </ToastPill>
      )}
    </ToastContext.Provider>
  )
}
