'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useKeyboardInset } from '@/lib/hooks/useKeyboardInset'

interface ToastAPI {
  /** Flash a brief, passive "saved"-style confirmation at the bottom. */
  show: (message: string) => void
}

const ToastContext = createContext<ToastAPI>({ show: () => {} })

/** Access the app-wide confirmation toast. No-ops if used outside the provider. */
export function useToast(): ToastAPI {
  return useContext(ToastContext)
}

/**
 * App-wide passive confirmation toast — one bottom-anchored, non-interactive
 * pill that reassures the user an action persisted ("Weight logged", "Request
 * sent"), then fades on its own. Mounted once in the (app) layout so any page
 * can call `useToast().show(...)` without wiring up its own toast state.
 *
 * It's `pointer-events: none` so it can never swallow a tap on the content
 * beneath it, and it rides above the on-screen keyboard so a confirmation fired
 * right after an edit stays visible while typing.
 *
 * ActiveWorkout keeps its own bespoke save toast — that one is positioned to
 * clear the live workout's finish/rest bars, which this generic offset can't
 * know about. Both share the same visual so they read identically.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const timer = useRef<NodeJS.Timeout | null>(null)
  const keyboardInset = useKeyboardInset()

  const show = useCallback((msg: string) => {
    setMessage(msg)
    setVisible(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(false), 1900)
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {message && visible && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            left: '50%',
            // Clear the mobile bottom nav (~84px) normally; when the keyboard is
            // up, sit just above it instead so the confirmation stays visible.
            bottom: keyboardInset > 0
              ? `calc(${keyboardInset}px + 16px)`
              : 'calc(env(safe-area-inset-bottom) + 84px)',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--accent)',
            color: 'var(--accent-text)',
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
            zIndex: 250,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            animation: 'save-toast-in 160ms ease',
            pointerEvents: 'none',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{message}</span>
        </div>
      )}
    </ToastContext.Provider>
  )
}
