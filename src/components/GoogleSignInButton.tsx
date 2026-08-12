'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'

type Variant = 'google' | 'primary' | 'secondary'

interface GoogleSignInButtonProps {
  /** Button label. Defaults by variant. */
  label?: string
  variant?: Variant
  fullWidth?: boolean
  className?: string
  style?: CSSProperties
  /** Called when OAuth fails to start (provider error). */
  onError?: (message: string) => void
  children?: ReactNode
}

function GoogleGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function variantStyle(variant: Variant, loading: boolean): CSSProperties {
  if (variant === 'google') {
    return {
      backgroundColor: loading ? '#cccccc' : '#ffffff',
      color: 'var(--on-accent)',
      border: 'none',
      fontWeight: 700,
    }
  }
  if (variant === 'primary') {
    return {
      backgroundColor: 'var(--accent)',
      color: 'var(--on-accent)',
      border: '1px solid var(--accent)',
      fontWeight: 700,
      opacity: loading ? 0.7 : 1,
    }
  }
  return {
    backgroundColor: 'var(--surface-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    fontWeight: 500,
    opacity: loading ? 0.7 : 1,
  }
}

/**
 * Shared Google OAuth entry point for login + landing CTAs.
 * Always redirects through `/auth/callback`; errors surface via `onError`
 * or (on login) the callback's `?error=` redirect.
 */
export default function GoogleSignInButton({
  label,
  variant = 'google',
  fullWidth = false,
  className,
  style,
  onError,
  children,
}: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false)
  const defaultLabel =
    variant === 'google' ? 'Continue with Google' : variant === 'primary' ? 'Get started' : 'Sign in'

  const handleClick = async () => {
    if (loading) return
    setLoading(true)
    const supabase = createClient()
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (oauthErr) {
      onError?.('Could not start sign in. Please try again.')
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      data-haptic="medium"
      className={className ? `press ${className}` : 'press'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        // Landing CTAs size via `.landing-btn-primary` in globals.css
        ...(className?.includes('landing-btn')
          ? {}
          : {
              height: '52px',
              padding: '0 20px',
              fontSize: '15px',
            }),
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-sans)',
        letterSpacing: '0.5px',
        cursor: loading ? 'default' : 'pointer',
        width: fullWidth ? '100%' : undefined,
        ...variantStyle(variant, loading),
        ...style,
      }}
    >
      {children ?? (
        <>
          {variant === 'google' && !loading ? <GoogleGlyph /> : null}
          {loading ? 'Redirecting...' : (label ?? defaultLabel)}
        </>
      )}
    </button>
  )
}
