'use client'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createClient, getClientUser } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import {
  buildBatches,
  GARMIN_EXPORT_FILE,
  parseGarminExportText,
  parseGarminHealthStatusText,
  withExportHrv,
  type ImportedNight
} from '@/lib/health/importers'
import { dateLabel, durationShort } from '@/lib/health/model'
import { sourceLabel } from '@/lib/health/reconcile'
import './health-import.css'

type Summary = { source: string; nights: number; latest: string }
type Preview = {
  found: number
  accepted: number
  skipped: { key: string; reason: string }[]
  batches: ReturnType<typeof buildBatches>['batches']
  recent: ImportedNight[]
  from: string
  to: string
}

const ENDPOINT_PATH = '/api/watch/v1/health-import'
const MAX_ZIP_BYTES = 400 * 1024 * 1024

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="hi-code">
      <pre tabIndex={0} aria-label={label}>
        {text}
      </pre>
      <button
        type="button"
        data-haptic="light"
        onClick={async () => {
          setDone(await copy(text))
          setTimeout(() => setDone(false), 1800)
        }}
      >
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/** Mints a device token (shown once) for the Shortcut or script; revoke it under Watch below. */
function TokenMaker({ name, onToken }: { name: string; onToken: (token: string) => void }) {
  const client = useMemo(() => createClient(), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  async function create() {
    setBusy(true)
    setError('')
    const { data, error: err } = await client.rpc('create_watch_device', { p_name: name })
    setBusy(false)
    const made = (data as { token?: string } | null)?.token
    if (err || !made) {
      setError(
        /LIMIT/.test(err?.message ?? '')
          ? 'You have 10 active devices. Revoke one under Watch first.'
          : 'Couldn’t create a token. Try again.'
      )
      return
    }
    setToken(made)
    onToken(made)
    window.dispatchEvent(new CustomEvent('grind:watch-devices-changed', { detail: 'created' }))
  }
  // A revoke anywhere else may have killed the token on screen, so never keep showing it.
  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e as CustomEvent).detail === 'revoked') {
        setToken('')
        onToken('')
      }
    }
    window.addEventListener('grind:watch-devices-changed', onChange)
    return () => window.removeEventListener('grind:watch-devices-changed', onChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (token)
    return (
      <div className="hi-token">
        <p>
          <strong>Copy this token now.</strong> It is shown once and stored only as a hash. Revoke
          it any time under Watch below.
        </p>
        <CopyBlock text={token} label="Device token" />
        <button
          type="button"
          className="hi-secondary"
          data-haptic="light"
          onClick={() => {
            setToken('')
            onToken('')
          }}
        >
          Create another token
        </button>
      </div>
    )
  return (
    <div>
      <button
        type="button"
        className="hi-primary"
        data-haptic="light"
        disabled={busy}
        onClick={create}
      >
        {busy ? 'Creating…' : `Create “${name}” token`}
      </button>
      {error && (
        <p role="alert" className="hi-error">
          {error}
        </p>
      )}
    </div>
  )
}

export default function HealthImportSettings() {
  const client = useMemo(() => createClient(), [])
  const { demoMode } = useDemoMode()
  const [sources, setSources] = useState<Summary[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => 'https://YOUR-GRIND-DOMAIN'
  )
  // Null on the server and first client render, so the markup matches; the
  // real zone fills in after hydration.
  const zone = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null
  )

  const [reload, setReload] = useState(0)
  useEffect(() => {
    let disposed = false
    void (async () => {
      if (demoMode) return
      const user = await getClientUser(client)
      if (!user || disposed) return
      const { data, error } = await client
        .from('sleep_sessions')
        .select('source,wake_date')
        .eq('user_id', user.id)
        .eq('kind', 'main')
        .order('wake_date', { ascending: false })
        .limit(1500)
      if (error || !data || disposed) return
      const map = new Map<string, Summary>()
      for (const row of data as { source: string; wake_date: string }[]) {
        const cur = map.get(row.source)
        if (cur) cur.nights++
        else map.set(row.source, { source: row.source, nights: 1, latest: row.wake_date })
      }
      setSources([...map.values()])
    })()
    return () => {
      disposed = true
    }
  }, [client, demoMode, reload])
  useEffect(() => {
    const again = () => setReload((n) => n + 1)
    window.addEventListener('grind:health-updated', again)
    return () => window.removeEventListener('grind:health-updated', again)
  }, [])

  async function onFiles(files: FileList | null) {
    if (!files?.length || busy) return
    setBusy(true)
    setPreview(null)
    setStatus('Reading your export…')
    try {
      const texts: string[] = []
      const statusTexts: string[] = []
      const add = (name: string, text: string) =>
        (/healthStatusData/i.test(name) ? statusTexts : texts).push(text)
      for (const file of Array.from(files)) {
        if (/\.zip$/i.test(file.name)) {
          if (file.size > MAX_ZIP_BYTES) {
            setStatus(
              'That zip is very large. Unzip it on a computer and upload just the *_sleepData.json files.'
            )
            return
          }
          const { unzipSync, strFromU8 } = await import('fflate')
          const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
            filter: (entry) => GARMIN_EXPORT_FILE.test(entry.name)
          })
          for (const [name, bytes] of Object.entries(entries)) add(name, strFromU8(bytes))
        } else add(file.name, await file.text())
      }
      const hrvByDate = new Map<string, number>()
      for (const text of statusTexts)
        for (const [date, hrv] of parseGarminHealthStatusText(text)) hrvByDate.set(date, hrv)
      const nights = new Map<string, ImportedNight>()
      const skipped: { key: string; reason: string }[] = []
      for (const text of texts) {
        const r = parseGarminExportText(text, { fallbackZone: zone ?? undefined })
        for (const n of withExportHrv(r.nights, hrvByDate)) nights.set(n.provider_id, n)
        skipped.push(...r.skipped)
      }
      if (!nights.size) {
        setStatus(
          texts.length
            ? 'No sleep nights found in those files. Look for files named like 2026-01-01_2026-04-10_12345_sleepData.json.'
            : 'No sleepData.json file found in that upload.'
        )
        return
      }
      const all = [...nights.values()].sort((a, b) => a.start_at.localeCompare(b.start_at))
      const built = buildBatches(all, 'garmin_export', new Date())
      setPreview({
        found: all.length,
        accepted: built.accepted,
        skipped: [...skipped, ...built.skipped],
        batches: built.batches,
        recent: [...all].reverse().slice(0, 5),
        from: all[0].wake_date,
        to: all[all.length - 1].wake_date
      })
      setStatus('')
    } catch {
      setStatus('Couldn’t read that file. Try the *_sleepData.json files instead of the zip.')
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (!preview || busy || demoMode) return
    setBusy(true)
    try {
      for (let i = 0; i < preview.batches.length; i++) {
        setStatus(`Importing ${i + 1} of ${preview.batches.length}…`)
        const { error } = await client.rpc('import_health_batch', {
          p_source: 'garmin_export',
          p_batch: preview.batches[i]
        })
        if (error) {
          setStatus(
            /PAUSED/.test(error.message)
              ? 'Health collection is paused. Resume it above, then import again.'
              : `Stopped after ${i} of ${preview.batches.length} batches. Nothing is duplicated if you try again.`
          )
          return
        }
      }
      setStatus(`Imported ${preview.accepted} nights.`)
      setPreview(null)
      window.dispatchEvent(new Event('grind:health-updated'))
    } finally {
      setBusy(false)
    }
  }

  const shortcutJson = `{
  "kind": "apple_health",
  "timezone": "${zone ?? 'Area/City'}",
  "token": "gwt_…",
  "samples": "2026-11-15T23:40:00-06:00 | 2026-11-16T01:10:00-06:00 | Core\\n2026-11-16T01:10:00-06:00 | 2026-11-16T02:10:00-06:00 | Deep"
}`
  const scriptEnv = `pip install garminconnect
export GRIND_URL="${origin}"
export GRIND_TOKEN="${token || 'gwt_… (create a token above)'}"
python3 garmin-sleep-sync.py --days 14`

  return (
    <div id="health-import" className="hi">
      <p className="hi-lead">
        Import sleep from one or more sources. GRIND combines them for each night, using the
        most detailed source first and filling gaps from the others.
      </p>

      {sources.length > 0 && (
        <ul className="hi-sources" aria-label="Imported sleep by source">
          {sources.map((s) => (
            <li key={s.source}>
              <span>{sourceLabel(s.source)}</span>
              <b>
                {s.nights} night{s.nights === 1 ? '' : 's'} · latest {dateLabel(s.latest)}
              </b>
            </li>
          ))}
        </ul>
      )}

      <details className="hi-card">
        <summary>1 · Garmin data export (file upload)</summary>
        <p>
          The most complete history, but manual. In Garmin Connect on the web: Account → Data
          Management → Export Your Data. Garmin emails a link (it can take a day or two). Then
          upload the zip here, or just the <code>*_sleepData.json</code> and{' '}
          <code>*_healthStatusData.json</code> files (the second adds overnight HRV) from{' '}
          <code>DI_CONNECT/DI-Connect-Wellness</code>. The file is read on your device; only sleep
          nights and naps are sent. Garmin’s export has stage totals, not the stage timeline.
        </p>
        <label className="hi-primary hi-file" aria-disabled={busy || demoMode}>
          Choose export file…
          <input
            type="file"
            accept=".json,.zip,application/json,application/zip"
            multiple
            disabled={busy || demoMode}
            onChange={(e) => {
              void onFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        {preview && (
          <div className="hi-preview">
            <p>
              <strong>{preview.found} nights</strong> found, {dateLabel(preview.from)} to{' '}
              {dateLabel(preview.to)}. <strong>{preview.accepted}</strong> can be imported (GRIND
              keeps the last 180 days).
              {preview.skipped.length > 0 && ` ${preview.skipped.length} skipped.`}
            </p>
            <table>
              <caption>Most recent nights in this file</caption>
              <thead>
                <tr>
                  <th>Wake date</th>
                  <th>Sleep</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {preview.recent.map((n) => (
                  <tr key={n.provider_id}>
                    <th>{dateLabel(n.wake_date)}</th>
                    <td>{durationShort(n.duration_seconds)}</td>
                    <td>{n.score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hi-note">
              Check these against Garmin Connect before importing. Re-importing is safe: nights are
              matched, not duplicated.
            </p>
            <button
              type="button"
              className="hi-primary"
              data-haptic="light"
              disabled={busy || preview.accepted === 0}
              onClick={runImport}
            >
              Import {preview.accepted} nights
            </button>
          </div>
        )}
      </details>

      <details className="hi-card">
        <summary>2 · Apple Health (iPhone Shortcut)</summary>
        <p>
          GRIND is a web app, so it can’t read Apple Health itself, but the iPhone Shortcuts app
          can, and it can send what it reads to GRIND. First check that your Garmin nights are in
          Apple Health: Health → Browse → Sleep → Data Sources. If only Apple Watch or iPhone
          entries appear, this route won’t help; use the export or the script.
        </p>
        <TokenMaker name="Apple Health Shortcut" onToken={() => {}} />
        <ol className="hi-steps">
          <li>
            In Shortcuts, create a shortcut. Add <b>Find Health Samples</b>: Type = Sleep Analysis,
            Start Date is in the last 3 days, sort by Start Date (oldest first).
          </li>
          <li>
            Add <b>Repeat with Each</b> over the samples. Inside it: <b>Format Date</b> (Start Date,
            ISO 8601), <b>Format Date</b> (End Date, ISO 8601), then a <b>Text</b> action with{' '}
            <code>start | end | value</code> built from those two results and the sample’s Value,
            then <b>Add to Variable</b> named lines.
          </li>
          <li>
            After the loop, <b>Combine Text</b> (lines, New Lines).
          </li>
          <li>
            Add <b>Get Contents of URL</b>: URL <code>{origin + ENDPOINT_PATH}</code>, method POST,
            request body JSON with <code>kind</code> = apple_health, <code>timezone</code> = {zone ?? 'your time zone'},{' '}
            <code>token</code> = your token, and <code>samples</code> = the combined text. A header
            is optional.
          </li>
          <li>
            Add <b>Show Result</b>. A reply starting {'{"imported": 1'} means it worked.
          </li>
          <li>
            Optional: Automation → Sleep Focus turns off (or a time each morning) → Run Shortcut,
            “Run Immediately”. Manual runs work any time.
          </li>
        </ol>
        <p className="hi-note">What the Shortcut must send:</p>
        <CopyBlock text={shortcutJson} label="Example request body" />
        <p className="hi-note">
          Apple Health sleep gives times and stages only. GRIND ignores Apple’s HRV, which is measured
          differently from Garmin’s, and doesn’t infer stages from untyped “Asleep” entries. Action
          names can differ between iOS versions; use the closest match.
        </p>
      </details>

      <details className="hi-card">
        <summary>3 · Garmin sync script (unofficial, your account only)</summary>
        <p className="hi-warn">
          This logs in to Garmin’s private web API using a community library. That is against
          Garmin’s terms, can break without notice, and should only ever be used for your own
          account. Your Garmin password is typed on your computer and never sent to GRIND; only
          sleep nights are uploaded with the token below.
        </p>
        <TokenMaker name="Garmin sync script" onToken={setToken} />
        <p>
          <a href="/tools/garmin-sleep-sync.py" download>
            Download garmin-sleep-sync.py
          </a>{' '}
          then run it where Python 3 is installed (a Mac, PC or a small always-on box). Schedule it
          each morning with cron or launchd for a near-daily catch-up.
        </p>
        <CopyBlock text={scriptEnv} label="Setup and run commands" />
        <p className="hi-note">
          Written to the community library’s documented behavior and not verified against a live
          account. Run it once with <code>--dry-run</code> and compare a night with Garmin Connect.
        </p>
      </details>

      <p role="status" className="hi-status">
        {status || (demoMode ? 'Imports are disabled in Demo Mode.' : '')}
      </p>
    </div>
  )
}
