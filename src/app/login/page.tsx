'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import GoogleSignInButton from '@/components/GoogleSignInButton'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)

  // Surface a failed OAuth round trip. /auth/callback redirects here with
  // ?error=... when the provider refuses or the code exchange fails; without
  // this the user just lands back on the login screen with no explanation.
  // Read from location rather than useSearchParams so this stays a plain
  // client component with no Suspense boundary.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const reason = params.get('error')
    if (!reason) return
    // Reading the URL is exactly the "sync from an external system" case; the
    // effect runs once on mount and the state settles immediately.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(
      reason === 'missing_code'
        ? 'Sign in did not complete. Please try again.'
        : `Could not sign you in: ${reason}`
    )
    // Drop the param so a refresh doesn't re-show a stale error.
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  return (
    <div
      style={{
        minHeight: '100%',
        backgroundColor: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        position: 'relative',
      }}
    >
      <Link
        href="/"
        className="press"
        style={{
          position: 'absolute',
          top: 'max(8px, env(safe-area-inset-top))',
          left: 'max(8px, env(safe-area-inset-left))',
          display: 'inline-flex',
          alignItems: 'center',
          minHeight: '44px',
          padding: '0 12px',
          fontFamily: 'var(--font-sans)',
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--text-secondary)',
          textDecoration: 'none',
          letterSpacing: '0.3px',
        }}
      >
        ← GRIND
      </Link>

      <div style={{ textAlign: 'center', marginBottom: '48px' }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '72px',
            color: 'var(--accent-text)',
            lineHeight: 1,
            letterSpacing: '2px',
          }}
        >
          GRIND
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '16px',
            color: 'var(--text-secondary)',
            marginTop: '8px',
            letterSpacing: '0.5px',
          }}
        >
          Track. Progress. Dominate.
        </p>
      </div>

      <GoogleSignInButton
        fullWidth
        style={{ maxWidth: '320px' }}
        onError={setError}
      />

      {error && (
        <div
          style={{
            marginTop: '16px',
            fontSize: '13px',
            color: 'var(--danger)',
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
            maxWidth: '320px',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
