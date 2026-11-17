'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient, getClientUser } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'

export default function HealthSettings() {
  const client = useMemo(() => createClient(), [])
  const { demoMode } = useDemoMode()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const refresh = () => setRetry((n) => n + 1)
    window.addEventListener('grind:health-updated', refresh)
    return () => window.removeEventListener('grind:health-updated', refresh)
  }, [])
  useEffect(() => {
    let disposed = false
    void (async () => {
      if (demoMode) return
      const user = await getClientUser(client)
      if (!user || disposed) return
      const result = await client
        .from('health_collection')
        .select('enabled')
        .eq('user_id', user.id)
        .maybeSingle()
      if (disposed) return
      if (result.error) {
        setStatus('Health collection controls are temporarily unavailable.')
        return
      }
      setEnabled(result.data?.enabled ?? true)
      setStatus('')
    })()
    return () => {
      disposed = true
    }
  }, [client, demoMode, retry])
  async function toggle() {
    if (busy || demoMode || enabled == null) return
    setBusy(true)
    const result = await client.rpc('set_health_collection', { p_enabled: !enabled })
    if (result.error) setStatus('Couldn’t change collection. Try again.')
    else {
      setEnabled(!enabled)
      setStatus(
        enabled
          ? 'Future collection paused. Stored history stays available.'
          : 'Collection resumed.'
      )
      window.dispatchEvent(new Event('grind:health-updated'))
    }
    setBusy(false)
  }
  async function exportHealth() {
    if (busy || demoMode) return
    setBusy(true)
    setStatus('Preparing private health export…')
    try {
      const user = await getClientUser(client)
      if (!user) throw new Error('No session')
      const output: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        format_version: 1
      }
      for (const table of [
        'daily_body',
        'body_prefs',
        'health_collection',
        'health_connections',
        'health_samples',
        'sleep_sessions',
        'health_daily_summaries',
        'health_insights'
      ]) {
        const records: unknown[] = []
        for (let offset = 0; ; offset += 500) {
          // A deterministic order is required for pagination; all fields are
          // owner-readable and credentials are never stored in these tables.
          let query = client.from(table).select('*').eq('user_id', user.id)
          const keys =
            table === 'daily_body'
              ? ['local_date']
              : table === 'health_daily_summaries'
                ? ['local_date', 'timezone']
                : table === 'health_samples'
                  ? ['connection_id', 'metric', 'provider_id']
                  : table === 'sleep_sessions'
                    ? ['connection_id', 'provider_id']
                    : table === 'health_connections' || table === 'health_insights'
                      ? ['id']
                      : ['user_id']
          for (const key of keys) query = query.order(key)
          const result = await query.range(offset, offset + 499)
          if (result.error) throw result.error
          records.push(...result.data)
          if (result.data.length < 500) break
          if (records.length >= 250000) throw new Error('Export too large')
        }
        output[table] = records
      }
      const current = await getClientUser(client)
      if (current?.id !== user.id) throw new Error('Account changed')
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' })
      )
      const link = document.createElement('a')
      link.href = url
      link.download = 'grind-health.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus('Health export downloaded.')
    } catch {
      setStatus('Couldn’t complete the health export. No partial file was downloaded.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      id="health"
      style={{
        scrollMarginTop: 96,
        paddingBottom: 20,
        marginBottom: 20,
        borderBottom: '1px solid var(--border)'
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
        Health connections & privacy
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
        Watch snapshots and workout readings come from your paired Garmin. Sleep arrives from the
        sources below. Opening GRIND on your phone cannot wake the watch.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <button
          type="button"
          data-haptic="light"
          onClick={() => void toggle()}
          disabled={busy || enabled == null || demoMode}
          style={{
            minHeight: 44,
            padding: '8px 12px',
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--surface-elevated)',
            color: 'var(--text-primary)',
            fontSize: 13
          }}
        >
          {enabled === false ? 'Resume health collection' : 'Pause health collection'}
        </button>
        <button
          type="button"
          data-haptic="light"
          onClick={() => void exportHealth()}
          disabled={busy || demoMode || enabled == null}
          style={{
            minHeight: 44,
            padding: '8px 12px',
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--surface-elevated)',
            color: 'var(--text-primary)',
            fontSize: 13
          }}
        >
          Export health data
        </button>
        <Link
          href="/progress/health"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 44,
            color: 'var(--accent-text)',
            fontSize: 13
          }}
        >
          View health ›
        </Link>
      </div>
      <p
        role="status"
        style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 8 }}
      >
        {status ||
          (enabled === false
            ? 'Collection paused. Resuming is always explicit.'
            : 'Deleting health history also pauses future collection. Workouts and XP are preserved.')}
      </p>
      {enabled == null && status && (
        <button
          onClick={() => setRetry((n) => n + 1)}
          style={{ minHeight: 44, color: 'var(--accent-text)' }}
        >
          Retry health controls
        </button>
      )}
    </div>
  )
}
