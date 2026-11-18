'use client'
import { useState, useSyncExternalStore, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useDemoMode } from '@/lib/contexts/DemoModeContext'
import { useToast } from '@/lib/contexts/ToastContext'
import { localDateKey } from '@/lib/utils/formatting'
import { saveNotificationPrefs } from '@/lib/push/client'
import { PHASES } from '@/lib/energy/copy'
import { phaseAt } from '@/lib/energy/now'
import { ALERT_KINDS, type AlertKind, type EnergySchedule } from '@/lib/energy/types'
import { ChevronLeft, ChevronRight } from '@/components/ui/Icons'
import EnergyCurve from './EnergyCurve'
import '@/components/health/health.css'
import './energy.css'

// ── Clock: null on the server so no time is ever rendered from Vercel's zone ──
const TICK = 30_000
function subscribe(cb: () => void) {
  const id = setInterval(cb, TICK)
  window.addEventListener('focus', cb)
  return () => {
    clearInterval(id)
    window.removeEventListener('focus', cb)
  }
}
const clientNow = () => Math.floor(Date.now() / TICK) * TICK
const serverNow = () => null

function untilLabel(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}
function hm(min: number): string {
  const m = Math.abs(Math.round(min))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

type Alerts = { pushEnabled: boolean; on: boolean; kinds: string[]; leadMin: number }

export default function EnergyView({
  schedule,
  failed,
  alerts,
  userId,
}: {
  schedule: EnergySchedule | null
  failed: boolean
  alerts: Alerts
  userId: string
}) {
  const { demoMode } = useDemoMode()
  const now = useSyncExternalStore(subscribe, clientNow, serverNow)
  const router = useRouter()

  return (
    <div className="page health-page energy-page">
      <header className="energy-header">
        <Link href="/progress/health" className="energy-back press">
          <ChevronLeft size={16} />
          Health
        </Link>
        <h1 className="energy-title">ENERGY</h1>
      </header>

      {demoMode ? (
        <section className="health-panel">
          <h2>Energy is private</h2>
          <p>Turn off Demo Mode to see your own energy schedule.</p>
        </section>
      ) : failed ? (
        <section className="health-panel">
          <h2>Couldn&apos;t load your sleep</h2>
          <p>Your schedule is fine; the read failed.</p>
          <button type="button" className="health-primary" onClick={() => router.refresh()}>
            Try again
          </button>
        </section>
      ) : !schedule ? (
        <section className="health-panel energy-empty">
          <span className="health-eyebrow">No sleep yet</span>
          <h2>Energy runs on your nights</h2>
          <p>Import a few nights of sleep and GRIND will map your peaks and dips. A week makes it sharp.</p>
          <Link className="health-primary" href="/profile/settings#health">
            Import sleep
            <ChevronRight size={16} />
          </Link>
        </section>
      ) : (
        <Schedule schedule={schedule} now={now} alerts={alerts} userId={userId} />
      )}

      <footer className="health-footer">Estimated from your sleep timing. Not medical advice.</footer>
    </div>
  )
}

function Schedule({
  schedule,
  now,
  alerts,
  userId,
}: {
  schedule: EnergySchedule
  now: number | null
  alerts: Alerts
  userId: string
}) {
  const fmt = (ms: number | string) =>
    new Date(ms).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: schedule.timezone,
    })
  const reading = now != null ? phaseAt(schedule, now) : null

  return (
    <div className="stagger">
      <section className="energy-hero" data-state={reading?.state ?? 'loading'} style={{ '--i': 0 } as CSSProperties}>
        <span className="health-eyebrow">Right now</span>
        <h2 className="energy-phase">{reading ? reading.title : ' '}</h2>
        <p className="energy-hint">{reading?.hint ?? ' '}</p>
        {reading?.next && now != null && (
          <p className="energy-next">
            <span>{reading.next.label}</span>
            <b>in {untilLabel(reading.next.at - now)}</b>
            <span className="energy-next-at">{fmt(reading.next.at)}</span>
          </p>
        )}
        <div className="energy-chips">
          <span className={`energy-chip energy-chip-${schedule.confidence}`}>
            {schedule.confidence === 'high' ? 'High' : schedule.confidence === 'medium' ? 'Medium' : 'Low'} confidence
          </span>
          {schedule.provisional && <span className="energy-chip">Using your usual wake time</span>}
          {schedule.calibrationMin !== 0 && (
            <span className="energy-chip">
              Tuned {schedule.calibrationMin > 0 ? 'later' : 'earlier'} {hm(schedule.calibrationMin)}
            </span>
          )}
        </div>
      </section>

      <section className="health-panel" style={{ '--i': 1 } as CSSProperties}>
        <div className="health-section-head">
          <h2>Your day</h2>
        </div>
        <EnergyCurve schedule={schedule} now={now} timeLabel={fmt} />
        {schedule.signals?.length > 0 && (
          <div className="energy-signals">
            <span className="health-eyebrow">What shaped today</span>
            <ul>
              {schedule.signals.map((sig, i) => (
                <li key={`${sig.key}-${i}`} data-tone={sig.tone}>
                  <i aria-hidden="true" />
                  <strong>{sig.label}</strong>
                  <span>{sig.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="energy-grid">
        <Timeline schedule={schedule} now={now} fmt={fmt} alerts={alerts} />
        <Debt schedule={schedule} />
      </div>

      <div className="energy-grid">
        <CheckIn userId={userId} />
        <AlertControls initial={alerts} />
      </div>
    </div>
  )
}

function Timeline({
  schedule,
  now,
  fmt,
  alerts,
}: {
  schedule: EnergySchedule
  now: number | null
  fmt: (ms: number | string) => string
  alerts: Alerts
}) {
  const nextIdx = now == null ? -1 : schedule.events.findIndex((e) => Date.parse(e.end ?? e.start) > now)
  return (
    <section className="health-panel" style={{ '--i': 2 } as CSSProperties}>
      <div className="health-section-head">
        <h2>Schedule</h2>
      </div>
      <ol className="energy-timeline">
        {schedule.events.map((e, i) => {
          const past = now != null && Date.parse(e.end ?? e.start) <= now
          const alerted =
            alerts.pushEnabled && alerts.on && alerts.kinds.includes(e.kind)
          return (
            <li
              key={e.kind}
              className={`energy-event energy-event-${e.kind}`}
              data-past={past || undefined}
              data-next={i === nextIdx || undefined}
            >
              <i className="energy-event-mark" aria-hidden="true" />
              <span className="energy-event-name">{PHASES[e.kind].name}</span>
              <span className="energy-event-time">
                {now == null ? '--:--' : e.end ? `${fmt(e.start)}–${fmt(e.end)}` : fmt(e.start)}
              </span>
              {alerted && <Bell />}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function Bell() {
  return (
    <svg className="energy-bell" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Alert on" role="img">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

/** RISE's rule of thumb: under 5h of debt is where you want to live. */
const DEBT_TARGET_MIN = 300

function Debt({ schedule }: { schedule: EnergySchedule }) {
  const nights = [...schedule.debtNights].reverse()
  const maxDelta = Math.max(60, ...nights.map((n) => Math.abs(n.deltaMin)))
  const over = schedule.debtMin > DEBT_TARGET_MIN
  return (
    <section className="health-panel" style={{ '--i': 3 } as CSSProperties}>
      <div className="health-section-head">
        <h2>Sleep debt</h2>
      </div>
      <div className="energy-debt-head">
        <span className="energy-big">{hm(schedule.debtMin)}</span>
        <span className={over ? 'energy-debt-state energy-debt-over' : 'energy-debt-state'}>
          {schedule.debtMin === 0 ? 'Fully paid' : over ? 'Above 5h' : 'Under 5h'}
        </span>
      </div>
      <div className="energy-meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (schedule.debtMin / (DEBT_TARGET_MIN * 2)) * 100)}%` }} data-over={over || undefined} />
        <i style={{ left: '50%' }} />
      </div>
      <div className="energy-nights" role="img" aria-label={`Last ${nights.length} nights against your need`}>
        {nights.map((n) => (
          <span key={n.date} className="energy-night" title={`${n.date}: ${hm(n.sleepMin)}`}>
            <i
              data-short={n.deltaMin > 0 || undefined}
              style={{ height: `${Math.max(3, (Math.abs(n.deltaMin) / maxDelta) * 50)}%` }}
            />
          </span>
        ))}
      </div>
      <dl className="energy-facts">
        <div>
          <dt>Your need</dt>
          <dd>{hm(schedule.needMin)}</dd>
        </div>
        <div>
          <dt>Nights</dt>
          <dd>{schedule.nights}</dd>
        </div>
      </dl>
    </section>
  )
}

const FEELINGS = [
  { value: -1, label: 'Tired' },
  { value: 0, label: 'OK' },
  { value: 1, label: 'Sharp' },
] as const

function CheckIn({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false)
  const [logged, setLogged] = useState<string | null>(null)
  const toast = useToast()
  const router = useRouter()

  async function log(feeling: -1 | 0 | 1, label: string) {
    if (busy) return
    setBusy(true)
    const d = new Date()
    const { error } = await createClient()
      .from('energy_checkins')
      .insert({
        user_id: userId,
        local_date: localDateKey(d),
        local_hour: d.getHours() + d.getMinutes() / 60,
        feeling,
      })
    setBusy(false)
    if (error) {
      toast.show("Couldn't log that", 'error')
      return
    }
    setLogged(label)
    router.refresh()
  }

  return (
    <section className="health-panel" style={{ '--i': 4 } as CSSProperties}>
      <div className="health-section-head">
        <h2>How do you feel?</h2>
      </div>
      <div className="energy-feel">
        {FEELINGS.map((f) => (
          <button
            key={f.value}
            type="button"
            className="press"
            data-feel={f.value}
            data-haptic="light"
            disabled={busy}
            onClick={() => log(f.value, f.label)}
          >
            <FeelIcon value={f.value} />
            {f.label}
          </button>
        ))}
      </div>
      <p className="health-muted energy-feel-note" aria-live="polite">
        {logged ? `Logged ${logged.toLowerCase()}. It tunes your dip timing.` : 'Taps tune your dip timing to you.'}
      </p>
    </section>
  )
}

function FeelIcon({ value }: { value: -1 | 0 | 1 }) {
  const d =
    value === -1
      ? 'M4 14c2.5 0 3.5-4 6-4s3.5 4 6 4 3.5-4 4-4' // a sag
      : value === 0
        ? 'M4 12h16'
        : 'M4 16l5-5 4 3 7-8'
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const KIND_LABEL: Record<AlertKind, string> = {
  morning_peak: 'Morning peak',
  afternoon_dip: 'Afternoon dip',
  evening_peak: 'Evening peak',
  wind_down: 'Wind-down',
}
const LEADS = [10, 20, 30] as const

function AlertControls({ initial }: { initial: Alerts }) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const router = useRouter()

  async function save(patch: Partial<{ energy_alerts: boolean; energy_kinds: string[]; energy_lead_min: number }>) {
    if (busy) return
    const prev = state
    setState({
      ...state,
      on: patch.energy_alerts ?? state.on,
      kinds: patch.energy_kinds ?? state.kinds,
      leadMin: patch.energy_lead_min ?? state.leadMin,
    })
    setBusy(true)
    const saved = await saveNotificationPrefs(patch).catch(() => null)
    setBusy(false)
    if (!saved) {
      setState(prev)
      toast.show("Couldn't save alert setting", 'error')
      return
    }
    router.refresh()
  }

  if (!state.pushEnabled) {
    return (
      <section className="health-panel" style={{ '--i': 5 } as CSSProperties}>
        <div className="health-section-head">
          <h2>Heads-ups</h2>
        </div>
        <p>Get a nudge before each peak and dip. Turn on notifications first.</p>
        <Link className="health-primary" href="/profile/settings#alerts">
          Notification settings
          <ChevronRight size={16} />
        </Link>
      </section>
    )
  }

  return (
    <section className="health-panel" style={{ '--i': 5 } as CSSProperties}>
      <div className="health-section-head energy-alert-head">
        <h2>Heads-ups</h2>
        <button
          type="button"
          role="switch"
          aria-checked={state.on}
          aria-label="Energy alerts"
          className="energy-switch"
          disabled={busy}
          onClick={() => save({ energy_alerts: !state.on })}
        >
          <span />
        </button>
      </div>
      <div className="energy-kinds" data-off={!state.on || undefined}>
        {ALERT_KINDS.map((k) => {
          const on = state.kinds.includes(k)
          return (
            <button
              key={k}
              type="button"
              className="press"
              aria-pressed={on}
              disabled={busy || !state.on}
              onClick={() =>
                save({ energy_kinds: on ? state.kinds.filter((x) => x !== k) : [...state.kinds, k] })
              }
            >
              {KIND_LABEL[k]}
            </button>
          )
        })}
      </div>
      <span className="health-eyebrow energy-lead-label">How early</span>
      <div className="health-segment" role="group" aria-label="How early">
        {LEADS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={state.leadMin === m}
            disabled={busy || !state.on}
            onClick={() => save({ energy_lead_min: m })}
          >
            {m} min
          </button>
        ))}
      </div>
    </section>
  )
}
