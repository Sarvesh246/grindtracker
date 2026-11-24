'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GarminScope } from '@/lib/health/garmin/collect'
import { dateLabel } from '@/lib/health/model'
import './health-import.css'

const endpoint = '/api/health/garmin-personal'

type Connection = {
  enabled: boolean
  push_enabled: boolean
  scopes: GarminScope[]
  time_zone: string
  capabilities: Record<string, boolean>
  last_success_at: string | null
  last_error: string | null
  backfill_date: string | null
  backfill_end: string | null
}

type Action = { action: 'probe' | 'enable' | 'pause' | 'disconnect' | 'sync' | 'push_on' | 'push_off' }
  | { action: 'scopes'; scopes: GarminScope[] }

const scopeLabels = [
  ['food', 'Food logs'], ['cycle', 'Cycle or pregnancy data'], ['gps', 'GPS routes']
] as const
const scopeHints = {
  food: 'Meals and nutrition you log in Garmin.',
  cycle: 'Stays private to you, never shown to friends.',
  gps: 'Map traces from outdoor activities.'
} as const
const coverage = {
  sleep: 'Sleep totals and score', sleep_stages: 'Sleep stage timeline', sleeping_hr: 'Sleeping heart rate',
  overnight_hrv: 'Overnight HRV', sleep_respiration: 'Overnight breathing', sleep_spo2: 'Overnight oxygen',
  wellness: 'Daily measurements', activity: 'Activity history'
} as const

const messages: Record<string, string> = {
  saved: 'Settings saved.',
  synced: 'Garmin sync finished.',
  idle: 'No sync started. Try again after the current sync or retry delay.',
  verified: 'Garmin connection verified.',
  credentials: 'Garmin rejected the key. Update the production secret, then reconnect.',
  rate_limit: 'Garmin asked us to wait. Sync will retry automatically.',
  storage: 'GRIND could not save the sync. Try again shortly.',
  paused: 'Resume health collection before connecting Garmin.',
  unavailable: 'Garmin Personal is unavailable for this account.',
  upstream: 'Garmin could not be reached. Try again shortly.',
}

export default function GarminPersonalSettings() {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [paused, setPaused] = useState(false)
  const [pushAvailable, setPushAvailable] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [probe, setProbe] = useState<Record<string, boolean> | null>(null)
  const lifetime = useRef<AbortController | null>(null)

  const read = useCallback(async (signal: AbortSignal) => {
    const result = await fetch(endpoint, { cache: 'no-store', signal })
    const data = await result.json()
    if (signal.aborted) return
    if (!result.ok) { setStatus(messages[data.status] ?? 'Could not load Garmin settings.'); return }
    setConnection(data.connection)
    setPaused(data.collectionPaused)
    setPushAvailable(data.pushAvailable === true)
    setLoaded(true)
  }, [])

  useEffect(() => {
    const abort = new AbortController()
    lifetime.current = abort
    const refresh = () => { void read(abort.signal).catch(() => {
      if (!abort.signal.aborted) setStatus('Could not load Garmin settings.')
    }) }
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('grind:health-updated', refresh)
    return () => {
      abort.abort()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('grind:health-updated', refresh)
    }
  }, [read])

  async function run(action: Action) {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || busy) return
    setBusy(true)
    setStatus('')
    try {
      const result = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action), signal
      })
      const data = await result.json()
      if (signal.aborted) return
      if (data.capabilities) setProbe(data.capabilities)
      setStatus(messages[data.status] ?? 'Garmin sync could not complete.')
      if (action.action !== 'probe') await read(signal)
      if (data.status === 'synced') window.dispatchEvent(new Event('grind:health-updated'))
    } catch {
      if (!signal.aborted) setStatus('Could not reach Garmin settings. Try again.')
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }

  const capabilities = probe ?? connection?.capabilities
  const last = connection?.last_success_at
  const backfilling = !!connection?.backfill_date && !!connection.backfill_end &&
    connection.backfill_date >= connection.backfill_end
  const needsAttention = !!connection?.last_error
  const tone = !connection?.enabled ? 'off' : paused ? 'warn' : needsAttention ? 'bad' : 'on'
  const stateLabel = !connection?.enabled ? 'Not connected'
    : paused ? 'Collection paused' : needsAttention ? 'Needs attention' : 'Connected'
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  })
  const toggles = connection?.enabled ? [
    ...scopeLabels.map(([scope, name]) => ({
      id: scope, name, hint: scopeHints[scope],
      checked: connection.scopes.includes(scope),
      change: (on: boolean): Action => ({ action: 'scopes', scopes: on
        ? [...connection.scopes, scope] : connection.scopes.filter(s => s !== scope) })
    })),
    ...(pushAvailable ? [{
      id: 'push', name: 'Private outlier notifications', hint: 'A quiet heads-up when a night looks unusual.',
      checked: connection.push_enabled,
      change: (on: boolean): Action => ({ action: on ? 'push_on' : 'push_off' })
    }] : [])
  ] : []
  return (
    <section className="gp" aria-labelledby="gp-title" aria-busy={busy}>
      <header className="gp-head">
        <div className="gp-titles">
          <h3 id="gp-title">Garmin Connect Personal</h3>
          <p>Syncs after your watch uploads to Garmin Connect.</p>
        </div>
        {loaded && <span className="gp-pill" data-tone={tone}>{stateLabel}</span>}
      </header>

      {loaded && (last || backfilling) && (
        <dl className="gp-meta">
          {last && (
            <div>
              <dt>Last sync</dt>
              <dd><time dateTime={last}>{when(last)}</time></dd>
            </div>
          )}
          {backfilling && (
            <div>
              <dt>Importing history</dt>
              <dd>Next date {dateLabel(connection!.backfill_date!)}</dd>
            </div>
          )}
        </dl>
      )}
      {connection?.last_error && (
        <p className="gp-alert" role="alert">{messages[connection.last_error] ?? 'Garmin sync needs attention.'}</p>
      )}

      {loaded && (
        <div className="gp-actions">
          {connection?.enabled ? (
            connection.last_error === 'credentials' ? (
              <button type="button" className="gp-btn gp-btn-main" disabled={busy || paused} onClick={() => void run({ action: 'enable' })}>Reconnect</button>
            ) : (
              <button type="button" className="gp-btn gp-btn-main" disabled={busy || paused} onClick={() => void run({ action: 'sync' })}>Sync now</button>
            )
          ) : (
            <button type="button" className="gp-btn gp-btn-main" disabled={busy || paused} onClick={() => void run({ action: 'enable' })}>Connect and sync</button>
          )}
          <button type="button" className="gp-btn" disabled={busy} onClick={() => void run({ action: 'probe' })}>Check connection</button>
          {connection?.enabled && (
            <button type="button" className="gp-btn" disabled={busy} onClick={() => void run({ action: 'pause' })}>Pause Garmin</button>
          )}
          {connection && (
            <button type="button" className="gp-btn gp-btn-quiet" disabled={busy} onClick={() => void run({ action: 'disconnect' })}>Disconnect</button>
          )}
        </div>
      )}

      {toggles.length > 0 && (
        <fieldset disabled={busy || paused} className="gp-toggles">
          <legend>Optional private imports</legend>
          {toggles.map(t => (
            <label key={t.id} className="gp-toggle">
              <span className="gp-toggle-text">
                <span>{t.name}</span>
                <small>{t.hint}</small>
              </span>
              <input type="checkbox" checked={t.checked} onChange={e => void run(t.change(e.target.checked))} />
            </label>
          ))}
        </fieldset>
      )}

      {capabilities && (
        <details className="gp-coverage">
          <summary>Latest Garmin coverage check</summary>
          <ul>
            {Object.entries(coverage).map(([id, name]) => (
              <li key={id} data-ok={capabilities[id] ? 'true' : 'false'}>
                <span>{name}</span>
                <b>{capabilities[id] ? 'Available' : 'No sample returned'}</b>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p role="status" className="gp-status">{busy ? 'Contacting Garmin…' : status}</p>
    </section>
  )
}
