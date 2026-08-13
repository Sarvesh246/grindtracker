'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import Button from '@/components/ui/Button'
import { useKeyboardInset } from '@/lib/hooks/useKeyboardInset'

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export type SetupProfile = {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  setup_completed_at: string | null
}

export default function IdentityStep({
  supabase,
  user,
  existingProfile,
  onComplete,
}: {
  supabase: SupabaseClient
  user: User
  existingProfile: SetupProfile | null
  onComplete: (profile: SetupProfile) => void
}) {
  const meta = user.user_metadata ?? {}
  const oauthName = (meta.full_name as string) || ''
  const [username, setUsername] = useState(existingProfile?.username ?? '')
  const [displayName, setDisplayName] = useState(
    existingProfile?.display_name || oauthName || '',
  )
  const [checking, setChecking] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(
    existingProfile ? true : null,
  )
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkGenRef = useRef(0)
  const keyboardInset = useKeyboardInset()

  const selfUsername = existingProfile?.username?.toLowerCase() ?? null

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Reset availability immediately while typing; debounce the lookup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailable(null)
    setError(null)

    const trimmed = username.trim().toLowerCase()
    if (!trimmed || !USERNAME_RE.test(trimmed)) return

    if (selfUsername && trimmed === selfUsername) {
      setAvailable(true)
      setChecking(false)
      return
    }

    setChecking(true)
    const gen = ++checkGenRef.current
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('username', trimmed)
        .maybeSingle()
      if (gen !== checkGenRef.current) return
      setChecking(false)
      setAvailable(!data || data.id === user.id)
    }, 400)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [username, supabase, selfUsername, user.id])

  async function handleContinue() {
    const trimmed = username.trim().toLowerCase()
    const display = displayName.trim() || oauthName || trimmed

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
    if (submittingRef.current) return
    submittingRef.current = true

    setSubmitting(true)
    setError(null)

    const avatar =
      existingProfile?.avatar_url ||
      (meta.avatar_url as string) ||
      null

    if (existingProfile) {
      const { error: updateErr } = await supabase
        .from('user_profiles')
        .update({
          username: trimmed,
          display_name: display,
        })
        .eq('id', user.id)

      if (updateErr) {
        setError(updateErr.message)
        submittingRef.current = false
        setSubmitting(false)
        return
      }

      onComplete({
        ...existingProfile,
        username: trimmed,
        display_name: display,
        avatar_url: avatar,
      })
      submittingRef.current = false
      setSubmitting(false)
      return
    }

    const { error: insertErr } = await supabase.from('user_profiles').insert({
      id: user.id,
      username: trimmed,
      display_name: display,
      avatar_url: avatar,
      // Explicitly leave setup incomplete — proxy still routes here until finish.
      setup_completed_at: null,
    })

    if (insertErr) {
      setError(insertErr.message)
      submittingRef.current = false
      setSubmitting(false)
      return
    }

    onComplete({
      id: user.id,
      username: trimmed,
      display_name: display,
      avatar_url: avatar,
      setup_completed_at: null,
    })
    submittingRef.current = false
    setSubmitting(false)
  }

  const trimmed = username.trim().toLowerCase()
  const formatOk = USERNAME_RE.test(trimmed)
  const canSubmit = formatOk && available === true && !submitting

  function statusColor() {
    if (!trimmed || !formatOk) return 'var(--text-muted)'
    if (checking) return 'var(--text-muted)'
    return available ? 'var(--accent-text)' : 'var(--danger)'
  }

  function statusText() {
    if (!trimmed) return ''
    if (!formatOk) return '3–20 chars, lowercase letters, numbers, underscores only'
    if (checking) return 'Checking…'
    if (available === true) {
      return selfUsername === trimmed
        ? '@' + trimmed + ' is yours'
        : '@' + trimmed + ' is available'
    }
    if (available === false) return 'Username taken'
    return ''
  }

  const inputStyle = useMemo(
    () =>
      ({
        width: '100%',
        padding: '14px 16px',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        color: 'var(--text-primary)',
        fontFamily: "'DM Sans', sans-serif",
        fontSize: '16px',
        outline: 'none',
        boxSizing: 'border-box' as const,
      }),
    [],
  )

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        paddingBottom: keyboardInset > 0 ? keyboardInset : 0,
        transition: 'padding-bottom 180ms ease',
      }}
    >
      <div style={{ marginBottom: '28px' }}>
        <h1
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '36px',
            letterSpacing: '1px',
            color: 'var(--text-primary)',
            fontWeight: 'normal',
            margin: 0,
            lineHeight: 1.05,
          }}
        >
          WHO ARE YOU?
        </h1>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: '15px',
            color: 'var(--text-secondary)',
            lineHeight: 1.45,
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Your username shows on leaderboards. You can change it later.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
        <div>
          <label
            htmlFor="setup-username"
            style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-muted)',
              marginBottom: '6px',
              letterSpacing: '0.4px',
            }}
          >
            USERNAME
          </label>
          <input
            id="setup-username"
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value.toLowerCase())}
            placeholder="username"
            maxLength={20}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            style={inputStyle}
          />
          {statusText() && (
            <div
              style={{
                marginTop: '8px',
                fontSize: '13px',
                fontFamily: "'DM Sans', sans-serif",
                color: statusColor(),
                paddingLeft: '4px',
              }}
            >
              {statusText()}
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="setup-display-name"
            style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-muted)',
              marginBottom: '6px',
              letterSpacing: '0.4px',
            }}
          >
            DISPLAY NAME <span style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            id="setup-display-name"
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="How friends see you"
            maxLength={40}
            autoComplete="nickname"
            style={inputStyle}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: '12px 16px',
              backgroundColor: 'var(--danger-bg)',
              border: '1px solid var(--danger)',
              borderRadius: '8px',
              color: 'var(--danger)',
              fontSize: '13px',
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {error}
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="primary"
        size="lg"
        fullWidth
        data-haptic="light"
        disabled={!canSubmit}
        onClick={handleContinue}
        style={{ height: '52px', fontSize: '16px', marginTop: '24px' }}
      >
        {submitting ? 'Saving…' : 'Continue'}
      </Button>
    </div>
  )
}
