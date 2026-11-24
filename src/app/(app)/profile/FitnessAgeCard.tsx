'use client'

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, Card, Input, SectionLabel } from '@/components/ui'
import { localDateKey } from '@/lib/utils/formatting'
import type { Calibration, CardioResult, RecoveryResult, StrengthResult } from '@/lib/body/fitnessAge'

/**
 * Fitness age setup + readout (docs/FITNESS-AGE-RESEARCH.md). Functional first
 * pass: profile details, the four ages with their 80% ranges, manual
 * calibration entry, and accept/reject for auto-detected 5 km runs.
 */

type Profile = { birth_date: string; sex: 'male' | 'female'; height_cm: number | null }
type Result = {
  age: number
  cardio: CardioResult | null
  strength: StrengthResult | null
  recovery: RecoveryResult | null
  grind: { age: number; range: [number, number]; weights: Record<string, number> } | null
  autoCalibrations: Calibration[]
  calibrate: { cardio: 'missing' | 'stale' | null; strength: 'missing' | 'stale' | null }
}
type Response =
  | { ok: true; result: Result; profile: Profile | null }
  | { ok: false; reason: 'no_profile' | 'unavailable' | 'under_18' | 'over_90'; profile: Profile | null }

type CalKind = 'run_5k' | 'cooper' | 'lab_cpet' | 'grip'
const CAL_LABEL: Record<CalKind, string> = {
  run_5k: '5 km all-out run',
  cooper: 'Cooper 12-minute run',
  lab_cpet: 'Lab VO₂max test',
  grip: 'Grip dynamometer',
}

const mono: CSSProperties = { fontFamily: 'var(--font-mono)' }
const muted: CSSProperties = { color: 'var(--text-muted)', fontSize: '13px' }
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 160px', minWidth: 0 }
const select: CSSProperties = {
  backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', fontSize: '16px', padding: '10px 12px',
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={field}>
      <SectionLabel as="span">{label}</SectionLabel>
      {children}
    </label>
  )
}

const fmtRange = (r: [number, number]) => `${Math.round(r[0])}–${Math.round(r[1])}`

function AgeRow({ name, age, range, note, badge }: { name: string; age: number; range: [number, number]; note: string; badge?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{name}{badge && <span style={{ ...muted, marginLeft: 8 }}>{badge}</span>}</div>
        <div style={muted}>{note}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ ...mono, fontSize: '22px', fontWeight: 700 }}>{Math.round(age)}</div>
        <div style={{ ...mono, ...muted }}>{fmtRange(range)}</div>
      </div>
    </div>
  )
}

async function fetchFitnessAge(): Promise<Response | Error> {
  try {
    const res = await fetch(`/api/fitness-age?today=${localDateKey()}`, { cache: 'no-store' })
    if (!res.ok) return new Error((await res.json().catch(() => null))?.error ?? 'Failed to load')
    return (await res.json()) as Response
  } catch {
    return new Error('Failed to load')
  }
}

const confidenceLabel =(c: string) => (c === 'lab-verified' ? 'Lab-verified' : c === 'calibrated' ? 'Calibrated' : 'Uncalibrated')

export default function FitnessAgeCard() {
  const [data, setData] = useState<Response | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [profile, setProfile] = useState<{ birth_date: string; sex: 'male' | 'female'; height_cm: string }>({ birth_date: '', sex: 'male', height_cm: '' })
  const [cal, setCal] = useState<{ kind: CalKind; date: string; a: string; b: string }>({ kind: 'run_5k', date: localDateKey(), a: '', b: '' })
  const [notice, setNotice] = useState<string | null>(null)

  const apply = useCallback((body: Response | Error) => {
    if (body instanceof Error) { setError(body.message); return }
    setError(null)
    setData(body)
    if (body.profile) setProfile({ birth_date: body.profile.birth_date, sex: body.profile.sex, height_cm: body.profile.height_cm?.toString() ?? '' })
  }, [])
  const load = useCallback(async () => apply(await fetchFitnessAge()), [apply])

  useEffect(() => {
    let live = true
    fetchFitnessAge().then(body => { if (live) apply(body) })
    return () => { live = false }
  }, [apply])

  async function send(method: 'PUT' | 'POST', body: object, ok: string) {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/fitness-age', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Save failed')
      setNotice(ok)
      setEditing(false)
      await load()
      return true
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Save failed')
      return false
    } finally {
      setBusy(false)
    }
  }

  function saveProfile() {
    void send('PUT', { birth_date: profile.birth_date, sex: profile.sex, height_cm: profile.height_cm ? Number(profile.height_cm) : null }, 'Details saved')
  }

  async function saveCalibration() {
    const base = { kind: cal.kind, measured_on: cal.date }
    let body: Record<string, unknown>
    if (cal.kind === 'run_5k') {
      const [m, s] = cal.a.split(':').map(Number)
      body = { ...base, seconds: (m || 0) * 60 + (s || 0) }
    } else if (cal.kind === 'cooper') body = { ...base, distance_m: Number(cal.a) }
    else if (cal.kind === 'lab_cpet') body = { ...base, vo2max: Number(cal.a) }
    else body = { ...base, kg: Number(cal.a) }
    if (await send('POST', body, 'Calibration added')) setCal(c => ({ ...c, a: '' }))
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
      <SectionLabel>Fitness age</SectionLabel>
      {data?.profile && !editing && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit details</Button>}
    </div>
  )

  if (error) return <Card style={{ marginBottom: '32px' }}>{header}<p style={muted}>{error}</p><Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button></Card>
  if (!data) return <Card style={{ marginBottom: '32px' }}>{header}<p style={muted}>Loading…</p></Card>

  if (!data.ok && data.reason === 'unavailable') {
    return <Card style={{ marginBottom: '32px' }}>{header}<p style={muted}>Fitness age needs database migration 84 (docs/sql/84-fitness-age.sql). Apply it in Supabase, then reload.</p></Card>
  }

  const profileForm = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={muted}>Fitness age compares you against people of your own age and sex, so it needs these once.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        <Field label="Birth date"><Input type="date" value={profile.birth_date} onChange={e => setProfile(p => ({ ...p, birth_date: e.target.value }))} /></Field>
        <Field label="Sex">
          <select style={select} value={profile.sex} onChange={e => setProfile(p => ({ ...p, sex: e.target.value as 'male' | 'female' }))}>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </Field>
        <Field label="Height (cm, optional)"><Input inputMode="decimal" value={profile.height_cm} onChange={e => setProfile(p => ({ ...p, height_cm: e.target.value }))} /></Field>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button onClick={saveProfile} disabled={busy || !profile.birth_date}>Save details</Button>
        {editing && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
      </div>
    </div>
  )

  if (editing || (!data.ok && data.reason === 'no_profile')) {
    return <Card style={{ marginBottom: '32px' }}>{header}{profileForm}{notice && <p style={{ ...muted, marginTop: 8 }}>{notice}</p>}</Card>
  }
  if (!data.ok) {
    return <Card style={{ marginBottom: '32px' }}>{header}<p style={muted}>{data.reason === 'under_18' ? 'Fitness age starts at 18.' : 'Fitness age covers ages 18–90.'}</p></Card>
  }

  const r = data.result
  const placeholder = cal.kind === 'run_5k' ? 'Time, mm:ss (e.g. 21:30)' : cal.kind === 'cooper' ? 'Distance in metres' : cal.kind === 'lab_cpet' ? 'VO₂max, mL/kg/min' : 'Best squeeze, kg'

  return (
    <Card style={{ marginBottom: '32px' }}>
      {header}

      {r.grind ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '4px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '56px', lineHeight: 1, color: 'var(--accent-text)' }}>{Math.round(r.grind.age)}</div>
          <div>
            <div style={{ fontWeight: 600 }}>GRIND age</div>
            <div style={muted}>You&apos;re {Math.floor(r.age)} · likely range <span style={mono}>{fmtRange(r.grind.range)}</span></div>
          </div>
        </div>
      ) : (
        <p style={muted}>Not enough data yet. GRIND needs Garmin VO₂max readings, resting heart rate, or a calibration test to start.</p>
      )}

      <div style={{ marginTop: '12px' }}>
        {r.cardio && (
          <AgeRow name="Cardio" age={r.cardio.age} range={r.cardio.range} badge={confidenceLabel(r.cardio.confidence)}
            note={`VO₂max ${r.cardio.vo2} ±${r.cardio.vo2Sd} · ${r.cardio.percentile}th percentile for your age${r.cardio.atPeak ? ' · at peak' : ''}`} />
        )}
        {r.strength ? (
          <AgeRow name="Strength" age={r.strength.age} range={r.strength.range} badge={confidenceLabel(r.strength.confidence)}
            note={`${r.strength.percentile}th percentile${r.strength.lifts.length ? ` · from ${r.strength.lifts.join(', ')}` : ' · from grip'}`} />
        ) : (
          <div style={{ ...muted, padding: '10px 0', borderTop: '1px solid var(--border)' }}>Strength: log squat, bench, deadlift or overhead press sets, or add a grip reading.</div>
        )}
        {r.recovery ? (
          <AgeRow name="Recovery" age={r.recovery.age} range={r.recovery.range}
            note={`Resting HR ${r.recovery.restingHr} bpm · HRV ${r.recovery.hrvMs} ms · ${r.recovery.nights} nights`} />
        ) : (
          <div style={{ ...muted, padding: '10px 0', borderTop: '1px solid var(--border)' }}>Recovery: needs 10+ nights of resting HR and HRV.</div>
        )}
      </div>

      {r.cardio?.surprise && (
        <p style={{ ...muted, marginTop: 8 }}>
          Your Garmin was reading about {r.cardio.surprise.by} mL/kg/min {r.cardio.surprise.garminReadsHigh ? 'high' : 'low'} before your test on {r.cardio.surprise.date}.
        </p>
      )}

      {(r.calibrate.cardio || r.calibrate.strength) && (
        <p style={{ ...muted, marginTop: 8 }}>
          {r.calibrate.cardio && <>Cardio is {r.calibrate.cardio === 'stale' ? 'due for a recheck' : 'uncalibrated'}: a hard 5 km run tightens it (about ±5 → ±4 years). </>}
          {r.calibrate.strength && <>Strength is {r.calibrate.strength === 'stale' ? 'due for a recheck' : 'uncalibrated'}: a grip reading roughly halves its error.</>}
        </p>
      )}

      {r.autoCalibrations.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <SectionLabel as="h3" style={{ marginBottom: 6 }}>Auto-detected 5 km efforts</SectionLabel>
          {r.autoCalibrations.map(c => (
            <div key={c.activity_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
              <div style={{ flex: 1 }}>
                <span style={mono}>{c.measured_on}</span> · VO₂max <span style={mono}>{Math.round(c.value * 10) / 10}</span>
                <span style={{ ...muted, marginLeft: 8 }}>{c.status === 'rejected' ? 'Rejected' : 'Used as calibration ✓'}</span>
              </div>
              <Button size="sm" variant={c.status === 'rejected' ? 'secondary' : 'ghost'} disabled={busy}
                onClick={() => void send('POST', { activity_id: c.activity_id, measured_on: c.measured_on, value: c.value, status: c.status === 'rejected' ? 'accepted' : 'rejected' }, 'Updated')}>
                {c.status === 'rejected' ? 'Use it' : 'Reject'}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
        <SectionLabel as="h3" style={{ marginBottom: 8 }}>Add a calibration</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
          <Field label="Test">
            <select style={select} value={cal.kind} onChange={e => setCal(c => ({ ...c, kind: e.target.value as CalKind, a: '' }))}>
              {(Object.keys(CAL_LABEL) as CalKind[]).map(k => <option key={k} value={k}>{CAL_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Date"><Input type="date" value={cal.date} max={localDateKey()} onChange={e => setCal(c => ({ ...c, date: e.target.value }))} /></Field>
          <Field label="Result"><Input value={cal.a} placeholder={placeholder} inputMode={cal.kind === 'run_5k' ? 'text' : 'decimal'} onChange={e => setCal(c => ({ ...c, a: e.target.value }))} /></Field>
          <Button onClick={() => void saveCalibration()} disabled={busy || !cal.a}>Add</Button>
        </div>
        <p style={{ ...muted, marginTop: 8 }}>
          {cal.kind === 'grip'
            ? 'Seated, elbow at 90°, three squeezes per hand, alternating. Enter your single best.'
            : cal.kind === 'lab_cpet'
              ? 'The VO₂max from a lab treadmill or bike test with gas analysis.'
              : 'Flat route or track, all-out with even pacing, under ~25 °C, not when ill. Hard 5 km runs on Garmin are picked up automatically.'}
        </p>
      </div>

      {notice && <p style={{ ...muted, marginTop: 8 }}>{notice}</p>}
    </Card>
  )
}
