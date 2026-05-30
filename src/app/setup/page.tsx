'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export default function SetupPage() {
  const router = useRouter()
  const supabase = createClient()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [username, setUsername] = useState('')
  const [checking, setChecking] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setAvailable(null)
    setError(null)

    const trimmed = username.trim().toLowerCase()
    if (!trimmed || !USERNAME_RE.test(trimmed)) return

    setChecking(true)
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('username', trimmed)
        .maybeSingle()
      setChecking(false)
      setAvailable(!data)
    }, 400)
  }, [username])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = username.trim().toLowerCase()

    if (!USERNAME_RE.test(trimmed)) {
      setError('3–20 chars, lowercase letters, numbers, underscores only.')
      return
    }
    if (checking) {
      setError('Still checking availability — try again in a moment.')
      return
    }
    if (available === null) {
      setError('Enter a username to continue.')
      return
    }
    if (available === false) {
      setError('That username is taken.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const meta = user.user_metadata ?? {}
    const { error: insertErr } = await supabase.from('user_profiles').insert({
      id: user.id,
      username: trimmed,
      display_name: (meta.full_name as string) || trimmed,
      avatar_url: (meta.avatar_url as string) || null,
    })

    if (insertErr) {
      setError(insertErr.message)
      setSubmitting(false)
      return
    }

    router.push('/home')
  }

  const trimmed = username.trim().toLowerCase()
  const formatOk = USERNAME_RE.test(trimmed)
  const canSubmit = formatOk && available === true && !submitting

  function statusColor() {
    if (!trimmed || !formatOk) return 'var(--text-muted)'
    if (checking) return 'var(--text-muted)'
    return available ? '#4ade80' : 'var(--danger)'
  }

  function statusText() {
    if (!trimmed) return ''
    if (!formatOk) return '3–20 chars, lowercase letters, numbers, underscores only'
    if (checking) return 'Checking…'
    if (available === true) return '@' + trimmed + ' is available'
    if (available === false) return 'Username taken'
    return ''
  }

  return (
    <div style={{
      minHeight: '100dvh',
      backgroundColor: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{ width: '100%', maxWidth: '360px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '64px',
            lineHeight: 1,
            color: 'var(--accent-text)',
            letterSpacing: '2px',
          }}>GRIND</div>
          <div style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '14px',
            color: 'var(--text-secondary)',
            marginTop: '8px',
          }}>Choose your username to get started</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase())}
              placeholder="username"
              maxLength={20}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              style={{
                width: '100%',
                padding: '14px 16px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                color: 'var(--text-primary)',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '16px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {statusText() && (
              <div style={{
                marginTop: '8px',
                fontSize: '13px',
                fontFamily: "'DM Sans', sans-serif",
                color: statusColor(),
                paddingLeft: '4px',
              }}>
                {statusText()}
              </div>
            )}
          </div>

          {error && (
            <div style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(239,68,68,0.1)',
              border: '1px solid var(--danger)',
              borderRadius: '8px',
              color: 'var(--danger)',
              fontSize: '13px',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            style={{
              width: '100%',
              height: '52px',
              backgroundColor: canSubmit ? 'var(--accent)' : 'var(--surface)',
              color: canSubmit ? 'var(--on-accent)' : 'var(--text-muted)',
              border: canSubmit ? 'none' : '1px solid var(--border)',
              borderRadius: '12px',
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700,
              fontSize: '16px',
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            {submitting ? 'Setting up…' : 'Claim Username'}
          </button>
        </form>

        <div style={{
          marginTop: '24px',
          textAlign: 'center',
          fontSize: '12px',
          color: 'var(--text-muted)',
          fontFamily: "'DM Sans', sans-serif",
          lineHeight: 1.5,
        }}>
          Your username is public and appears on leaderboards.<br />
          You can change it later in your profile.
        </div>
      </div>
    </div>
  )
}
