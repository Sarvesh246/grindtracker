'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GarminScope } from '@/lib/health/garmin/collect'

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
  return (
    <details className="hi-card" open>
      <summary>Garmin Connect Personal</summary>
      <p>Syncs after your watch uploads to Garmin Connect.</p>
      <p>{connection?.enabled ? paused ? 'Health collection paused' : 'Connected' : 'Disconnected or paused'}</p>
      {last && <p>Last successful sync <time dateTime={last}>{new Date(last).toLocaleString()}</time></p>}
      {backfilling && <p>Importing history. Next date {connection?.backfill_date}.</p>}
      {connection?.last_error && <p>{messages[connection.last_error] ?? 'Garmin sync needs attention.'}</p>}
      {loaded && (
        <div className="hi-actions">
          <button type="button" className="hi-primary" disabled={busy} onClick={() => void run({ action: 'probe' })}>Check connection</button>
          {connection?.enabled ? (
            <>
              {connection.last_error === 'credentials' ? (
                <button type="button" className="hi-primary" disabled={busy || paused} onClick={() => void run({ action: 'enable' })}>Reconnect</button>
              ) : (
                <button type="button" className="hi-primary" disabled={busy || paused} onClick={() => void run({ action: 'sync' })}>Sync now</button>
              )}
              <button type="button" className="hi-primary" disabled={busy} onClick={() => void run({ action: 'pause' })}>Pause Garmin</button>
            </>
          ) : (
            <button type="button" className="hi-primary" disabled={busy || paused} onClick={() => void run({ action: 'enable' })}>Connect and sync</button>
          )}
          {connection && <button type="button" className="hi-primary" disabled={busy}
            onClick={() => void run({ action: 'disconnect' })}>Disconnect</button>}
        </div>
      )}
      {connection?.enabled && (
        <fieldset disabled={busy || paused} className="garmin-scopes">
          <legend>Optional private imports</legend>
          {scopeLabels.map(([scope, name]) => (
            <label key={scope}>
              <input type="checkbox" checked={connection.scopes.includes(scope)}
                onChange={e => void run({ action: 'scopes', scopes: e.target.checked
                  ? [...connection.scopes, scope] : connection.scopes.filter(s => s !== scope) })} />
              {name}
            </label>
          ))}
        </fieldset>
      )}
      {connection?.enabled && pushAvailable && (
        <label>
          <input type="checkbox" disabled={busy || paused} checked={connection.push_enabled}
            onChange={event => void run({ action: event.target.checked ? 'push_on' : 'push_off' })} />
          {' '}Private outlier notifications
        </label>
      )}
      {capabilities && (
        <details>
          <summary>Latest Garmin coverage check</summary>
          <ul className="hi-sources">
            {Object.entries(coverage).map(([id, name]) => (
              <li key={id}><span>{name}</span><b>{capabilities[id] ? 'Available' : 'No sample returned'}</b></li>
            ))}
          </ul>
        </details>
      )}
      <p role="status">{busy ? 'Contacting Garmin…' : status}</p>
    </details>
  )
}
