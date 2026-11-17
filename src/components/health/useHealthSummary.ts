'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient, getClientUser } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { getHealthSummary, type HealthSummary } from '@/lib/health/queries'

export function useHealthSummary(date: string | null) {
  const client = useMemo(() => createClient(), [])
  const { demoMode } = useDemoMode()
  const [state, setState] = useState<{ date: string; data: HealthSummary } | null>(null)
  const [error, setError] = useState(false)
  const [updating, setUpdating] = useState(false)
  const generation = useRef(0)
  const owner = useRef<string | null>(null)
  const [retry, setRetry] = useState(0)
  const refresh = useCallback(() => setRetry((n) => n + 1), [])

  useEffect(() => {
    let disposed = false
    let running = false
    async function load() {
      if (!date || demoMode || disposed || running) return
      running = true
      const request = ++generation.current
      setUpdating(true)
      try {
        const user = await getClientUser(client)
        if (disposed || request !== generation.current) return
        if (owner.current !== user?.id) {
          setState(null)
          owner.current = user?.id ?? null
        }
        if (!user) {
          setError(true)
          return
        }
        const data = await getHealthSummary(client, user.id, date)
        if (!disposed && request === generation.current) {
          if (data.body.available) setState({ date, data })
          setError(!data.body.available)
        }
      } catch {
        if (!disposed && request === generation.current) setError(true)
      } finally {
        running = false
        if (!disposed && request === generation.current) setUpdating(false)
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const auth = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== owner.current) {
        ++generation.current
        owner.current = session?.user.id ?? null
        setState(null)
        setError(false)
        // Never perform Supabase work inside its auth lock callback.
        setTimeout(() => {
          if (!disposed) refresh()
        }, 0)
      }
    })
    void load()
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', onVisible)
    window.addEventListener('grind:health-updated', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      ++generation.current
      auth.data.subscription.unsubscribe()
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onVisible)
      window.removeEventListener('grind:health-updated', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [client, date, demoMode, retry, refresh])
  return {
    data: !demoMode && state?.date === date ? state.data : null,
    error,
    updating,
    refresh,
    demoMode
  }
}
