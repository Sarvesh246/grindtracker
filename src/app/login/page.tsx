'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
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

  const handleGoogleLogin = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (oauthErr) {
      setError('Could not start sign in. Please try again.')
      setLoading(false)
    }
  }

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
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '48px' }}>
        <h1
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
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
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '16px',
            color: 'var(--text-secondary)',
            marginTop: '8px',
            letterSpacing: '0.5px',
          }}
        >
          Track. Progress. Dominate.
        </p>
      </div>

      <button
        onClick={handleGoogleLogin}
        disabled={loading}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          width: '100%',
          maxWidth: '320px',
          height: '52px',
          backgroundColor: loading ? '#cccccc' : '#ffffff',
          color: 'var(--on-accent)',
          border: 'none',
          borderRadius: '12px',
          fontSize: '15px',
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 700,
          cursor: loading ? 'default' : 'pointer',
          transition: 'background-color 150ms ease',
        }}
      >
        {loading ? (
          'Redirecting...'
        ) : (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24">
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
            Continue with Google
          </>
        )}
      </button>

      {error && (
        <div style={{
          marginTop: '16px',
          fontSize: '13px',
          color: 'var(--danger)',
          textAlign: 'center',
          fontFamily: "'DM Sans', sans-serif",
          maxWidth: '320px',
        }}>
          {error}
        </div>
      )}
    </div>
  )
}
