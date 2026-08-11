'use client'
import { useState, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useUnit } from '@/lib/contexts/UnitContext'
import { useToast } from '@/lib/contexts/ToastContext'
import { getDefaultRest, setDefaultRest, getPauseRestOnExit, setPauseRestOnExit } from '@/lib/hooks/useRestTimer'
import { useTheme } from '@/lib/contexts/ThemeContext'
import ThemeToggle from '@/components/ThemeToggle'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import FeedbackModal from '@/components/FeedbackModal'
import {
  downloadJson,
  downloadText,
  exportFilename,
  sessionsLogsToCsv,
  type GrindExportPayload,
} from '@/lib/utils/exportData'
import { reportError } from '@/lib/utils/reportError'
import { useTour, type TourStep } from '@/components/onboarding/Tour'
import { useOnboarding } from '@/lib/contexts/OnboardingContext'
import {
  DEFAULT_NOTIFICATION_PREFS,
  fetchNotificationPrefs,
  isStandalonePwa,
  pushSupported,
  saveNotificationPrefs,
  subscribeToPush,
  unsubscribeFromPush,
  type NotificationPrefs,
} from '@/lib/push'

const REST_DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] // 0=Sun..6=Sat
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const sectionLabelStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '1.5px',
  marginBottom: '10px',
}

const cardStyle: CSSProperties = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
}

const titleStyle: CSSProperties = {
  fontSize: '14px',
  color: 'var(--text-primary)',
  fontWeight: 600,
  marginBottom: '2px',
}

const hintStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--text-muted)',
}

const dividerStyle: CSSProperties = {
  height: '1px',
  backgroundColor: 'var(--border)',
}

function Switch({
  checked,
  onClick,
  disabled,
  ariaLabel,
}: {
  checked: boolean
  onClick: () => void
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <button
      data-haptic="light"
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      style={{
        width: '44px',
        height: '26px',
        flexShrink: 0,
        borderRadius: '9999px',
        border: 'none',
        position: 'relative',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        backgroundColor: checked ? 'var(--accent)' : 'var(--surface-elevated)',
        boxShadow: checked ? 'none' : 'inset 0 0 0 1px var(--border)',
        transition: 'background-color 150ms ease',
      }}
    >
      <span style={{
        position: 'absolute',
        top: '3px',
        left: checked ? '21px' : '3px',
        width: '20px',
        height: '20px',
        borderRadius: '9999px',
        backgroundColor: checked ? 'var(--on-accent)' : 'var(--text-muted)',
        transition: 'left 150ms ease',
      }} />
    </button>
  )
}

function NavRow({
  title,
  hint,
  onClick,
  href,
  disabled,
  icon,
}: {
  title: string
  hint: string
  onClick?: () => void
  href?: string
  disabled?: boolean
  icon: ReactNode
}) {
  const body = (
    <>
      <div>
        <div style={titleStyle}>{title}</div>
        <div style={hintStyle}>{hint}</div>
      </div>
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '32px', height: '32px', flexShrink: 0,
        borderRadius: '9999px',
        backgroundColor: 'var(--surface-elevated)',
        border: '1px solid var(--border)',
        color: 'var(--accent-text)',
      }}>
        {icon}
      </span>
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        data-haptic="light"
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', textDecoration: 'none',
        }}
      >
        {body}
      </Link>
    )
  }

  return (
    <button
      type="button"
      data-haptic="light"
      onClick={onClick}
      disabled={disabled}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '12px', width: '100%',
        background: 'transparent', border: 'none', padding: 0,
        cursor: disabled ? 'default' : 'pointer', textAlign: 'left',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {body}
    </button>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={sectionLabelStyle}>{label}</div>
      <div style={cardStyle}>{children}</div>
    </div>
  )
}

interface Props {
  recurringRestDays: number[]
  isAdmin: boolean
  displayName: string
  username: string | null
}

export default function SettingsView({
  recurringRestDays,
  isAdmin,
  displayName,
  username,
}: Props) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { unit, toggleUnit } = useUnit()
  const { theme } = useTheme()
  const { prefReduceMotion, toggleReduceMotion } = useMotionPref()
  const toast = useToast()

  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deletingData, setDeletingData] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const [restMin, setRestMin] = useState(2)
  const [restSec, setRestSec] = useState(0)
  const [pauseRestOnExit, setPauseRestOnExitState] = useState(true)

  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs | null>(null)
  const [notifBusy, setNotifBusy] = useState(false)
  const [standalone, setStandalone] = useState(true)

  const [restDays, setRestDays] = useState<Set<number>>(new Set(recurringRestDays))
  const [savingRestDay, setSavingRestDay] = useState<number | null>(null)
  const [replayingSetup, setReplayingSetup] = useState(false)

  useEffect(() => {
    const total = getDefaultRest()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestMin(Math.floor(total / 60))
    setRestSec(total % 60)
    setPauseRestOnExitState(getPauseRestOnExit())
    setStandalone(isStandalonePwa())
    void fetchNotificationPrefs().then(prefs => {
      if (prefs) setNotifPrefs(prefs)
      else setNotifPrefs({ user_id: '', ...DEFAULT_NOTIFICATION_PREFS })
    })
  }, [])

  async function toggleNotificationsMaster() {
    if (notifBusy) return
    setNotifBusy(true)
    try {
      if (notifPrefs?.enabled) {
        await unsubscribeFromPush()
        const prefs = await fetchNotificationPrefs()
        setNotifPrefs(prefs ?? { user_id: '', ...DEFAULT_NOTIFICATION_PREFS, enabled: false })
        toast.show('Notifications off')
      } else {
        if (!pushSupported()) {
          toast.show(
            standalone
              ? 'Notifications are not supported here'
              : 'Add GRIND to your Home Screen to enable alerts',
            'error',
          )
          return
        }
        const result = await subscribeToPush()
        if (!result.ok) {
          toast.show(result.error || 'Could not enable notifications', 'error')
          return
        }
        const prefs = await fetchNotificationPrefs()
        setNotifPrefs(prefs ?? { user_id: '', ...DEFAULT_NOTIFICATION_PREFS, enabled: true })
        toast.show('Notifications on')
      }
    } finally {
      setNotifBusy(false)
    }
  }

  async function patchNotifPref<K extends keyof NotificationPrefs>(
    key: K,
    value: NotificationPrefs[K],
  ) {
    if (!notifPrefs || notifBusy) return
    const prev = notifPrefs
    setNotifPrefs({ ...notifPrefs, [key]: value })
    const saved = await saveNotificationPrefs({ [key]: value } as Partial<NotificationPrefs>)
    if (!saved) {
      setNotifPrefs(prev)
      toast.show("Couldn't save notification setting", 'error')
    } else {
      setNotifPrefs(saved)
    }
  }

  function commitRest(min: number, sec: number) {
    const m = Math.max(0, Math.floor(min) || 0)
    const s = Math.min(59, Math.max(0, Math.floor(sec) || 0))
    setRestMin(m)
    setRestSec(s)
    setDefaultRest(Math.max(5, m * 60 + s))
  }

  function togglePauseRestOnExit() {
    const next = !pauseRestOnExit
    setPauseRestOnExitState(next)
    setPauseRestOnExit(next)
  }

  async function toggleRestDay(dayOfWeek: number) {
    if (savingRestDay !== null) return
    const wasActive = restDays.has(dayOfWeek)
    setSavingRestDay(dayOfWeek)
    setRestDays(prev => {
      const next = new Set(prev)
      if (wasActive) next.delete(dayOfWeek); else next.add(dayOfWeek)
      return next
    })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSavingRestDay(null); return }

    const { error } = wasActive
      ? await supabase.from('user_rest_days').delete().eq('user_id', user.id).eq('day_of_week', dayOfWeek)
      : await supabase.from('user_rest_days').insert({ user_id: user.id, day_of_week: dayOfWeek })

    setSavingRestDay(null)
    if (error) {
      setRestDays(prev => {
        const next = new Set(prev)
        if (wasActive) next.add(dayOfWeek); else next.delete(dayOfWeek)
        return next
      })
      toast.show("Couldn't save rest day", 'error')
    } else {
      toast.show(wasActive ? 'Rest day removed' : 'Rest day saved')
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function handleExportData(format: 'json' | 'csv') {
    if (exporting) return
    setExporting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const [
        { data: sessions },
        { data: exercises },
        { data: bodyWeights },
        { data: badges },
        { data: restDayRows },
        { data: restDates },
        { data: statsRow },
      ] = await Promise.all([
        supabase.from('sessions').select('*').eq('user_id', user.id).order('started_at', { ascending: true }),
        supabase.from('exercises').select('*').eq('user_id', user.id),
        supabase.from('body_weights').select('*').eq('user_id', user.id).order('recorded_at', { ascending: true }),
        supabase.from('user_badges').select('*').eq('user_id', user.id),
        supabase.from('user_rest_days').select('*').eq('user_id', user.id),
        supabase.from('user_rest_dates').select('*').eq('user_id', user.id),
        supabase.from('user_stats').select('*').eq('user_id', user.id).maybeSingle(),
      ])

      const sessionIds = (sessions ?? []).map(s => s.id)
      const { data: logs } = sessionIds.length
        ? await supabase.from('session_logs').select('*').in('session_id', sessionIds)
        : { data: [] as unknown[] }

      if (format === 'csv') {
        const names: Record<string, string> = {}
        for (const ex of exercises ?? []) names[ex.id] = ex.name
        downloadText(
          exportFilename('grind-sets').replace(/\.json$/, '.csv'),
          sessionsLogsToCsv(sessions ?? [], (logs ?? []) as never[], names),
          'text/csv;charset=utf-8',
        )
        toast.show('Exported sets as CSV')
        return
      }

      const payload: GrindExportPayload = {
        exported_at: new Date().toISOString(),
        format_version: 1,
        profile: { username, display_name: displayName },
        stats: statsRow ?? null,
        sessions: sessions ?? [],
        session_logs: logs ?? [],
        exercises: exercises ?? [],
        body_weights: bodyWeights ?? [],
        badges: badges ?? [],
        rest_days: restDayRows ?? [],
        rest_dates: restDates ?? [],
      }
      downloadJson(exportFilename(), payload)
      toast.show('Exported your GRIND data')
    } catch (err) {
      reportError(err, { operation: 'exportData', route: '/profile/settings' })
      toast.show('Export failed — check your connection')
    } finally {
      setExporting(false)
    }
  }

  async function handleDeleteMyData() {
    if (deletingData) return
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }
    setDeletingData(true)
    try {
      const { error } = await supabase.rpc('delete_my_grind_data')
      if (error) throw error
      await supabase.auth.signOut()
      router.push('/login')
    } catch (err) {
      reportError(err, { operation: 'deleteMyData', route: '/profile/settings' })
      toast.show('Could not delete data — apply migration 29, then try again')
      setDeletingData(false)
      setDeleteConfirm(false)
    }
  }

  const settingsSteps: TourStep[] = [
    { target: 'profile-unit', title: 'Weight units', body: 'Switch how weights display app-wide. Everything is still stored consistently under the hood.' },
    { target: 'profile-rest', title: 'Default rest time', body: 'Set your default rest between sets — override per-exercise from the rest timer during a workout.' },
  ]
  const settingsTour = useTour('settings', settingsSteps, {
    active: !feedbackOpen && !deleteConfirm,
  })

  const { resetAllTours } = useOnboarding()
  function handleReplayTutorial() {
    resetAllTours()
    toast.show("Tutorial reset — it'll show again as you use the app")
    router.push('/home')
  }

  async function handleReplaySetup() {
    if (replayingSetup) return
    setReplayingSetup(true)
    try {
      const res = await fetch('/api/setup/replay', { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        toast.show(body?.error || "Couldn't reopen setup", 'error')
        setReplayingSetup(false)
        return
      }
      router.push('/setup')
      router.refresh()
    } catch {
      toast.show("Couldn't reopen setup", 'error')
      setReplayingSetup(false)
    }
  }

  const downloadIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
  const csvIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
  const feedbackIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
  const replayIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 2.6-6.36" />
      <path d="M3 4v5h5" />
    </svg>
  )
  const setupIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
    </svg>
  )
  const inboxIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v16H4z" />
      <polyline points="4 7 12 13 20 7" />
    </svg>
  )

  return (
    <div className="page page--profile" style={{
      fontFamily: "'DM Sans', sans-serif",
      padding: '0 16px 48px',
    }}>
      {settingsTour}

      <div style={{
        paddingTop: '24px', marginBottom: '24px',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}>
        <button
          type="button"
          onClick={() => router.push('/profile')}
          aria-label="Back to profile"
          data-haptic="light"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px', margin: '-4px',
            display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '32px', color: 'var(--text-primary)', letterSpacing: '1px',
          fontWeight: 'normal', margin: 0,
        }}>
          SETTINGS
        </h1>
      </div>

      {/* Appearance */}
      <Section label="Appearance">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={titleStyle}>Theme</div>
            <div style={hintStyle}>{theme === 'light' ? 'Light mode' : 'Dark mode'}</div>
          </div>
          <ThemeToggle size={32} />
        </div>
        <div style={dividerStyle} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={titleStyle}>Reduce Motion</div>
            <div style={hintStyle}>Instant UI — charts and celebrations skip animation</div>
          </div>
          <Switch
            checked={prefReduceMotion}
            onClick={toggleReduceMotion}
            ariaLabel="Reduce motion"
          />
        </div>
      </Section>

      {/* Units & tracking */}
      <Section label="Units & tracking">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={titleStyle}>Weight Unit</div>
            <div style={hintStyle}>{unit === 'metric' ? 'Kilograms (kg)' : 'Pounds (lbs)'}</div>
          </div>
          <button
            type="button"
            data-onboard="profile-unit"
            data-haptic="light"
            onClick={toggleUnit}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '9999px',
              padding: '3px',
              cursor: 'pointer',
              position: 'relative',
              width: '80px',
              height: '32px',
              flexShrink: 0,
            }}
          >
            <span style={{
              flex: 1, textAlign: 'center', fontSize: '11px', fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif",
              color: unit === 'metric' ? 'var(--on-accent)' : 'var(--text-muted)',
              position: 'relative', zIndex: 1, letterSpacing: '0.5px',
            }}>KG</span>
            <span style={{
              flex: 1, textAlign: 'center', fontSize: '11px', fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif",
              color: unit === 'imperial' ? 'var(--on-accent)' : 'var(--text-muted)',
              position: 'relative', zIndex: 1, letterSpacing: '0.5px',
            }}>LBS</span>
            <div style={{
              position: 'absolute',
              top: '3px',
              left: unit === 'metric' ? '3px' : 'calc(50% + 1px)',
              width: 'calc(50% - 4px)',
              height: 'calc(100% - 6px)',
              backgroundColor: 'var(--accent)',
              borderRadius: '9999px',
              transition: 'left 150ms ease',
            }} />
          </button>
        </div>

        <div style={dividerStyle} />

        <div data-onboard="profile-rest" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={titleStyle}>Default Rest Time</div>
            <div style={hintStyle}>Between sets unless changed per exercise</div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '9999px',
            padding: '3px 10px',
            height: '32px',
          }}>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={restMin}
              onChange={e => commitRest(Number(e.target.value), restSec)}
              aria-label="Default rest minutes"
              style={{
                width: '28px', background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace",
                fontSize: '16px', textAlign: 'right',
              }}
            />
            <span style={{ color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: '14px' }}>:</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              value={String(restSec).padStart(2, '0')}
              onChange={e => commitRest(restMin, Number(e.target.value))}
              aria-label="Default rest seconds"
              style={{
                width: '28px', background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace",
                fontSize: '16px', textAlign: 'left',
              }}
            />
          </div>
        </div>

        <div style={dividerStyle} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={titleStyle}>Pause Rest Timer on Exit</div>
            <div style={hintStyle}>
              {pauseRestOnExit
                ? 'Save & Exit freezes the timer'
                : 'Save & Exit keeps the timer running'}
            </div>
          </div>
          <Switch
            checked={pauseRestOnExit}
            onClick={togglePauseRestOnExit}
            ariaLabel="Pause rest timer on exit"
          />
        </div>

        <div style={dividerStyle} />

        <div>
          <div style={{ marginBottom: '10px' }}>
            <div style={titleStyle}>Rest Days</div>
            <div style={hintStyle}>Won&apos;t break your streak</div>
          </div>
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between' }}>
            {REST_DAY_LABELS.map((label, dayOfWeek) => {
              const active = restDays.has(dayOfWeek)
              return (
                <button
                  key={dayOfWeek}
                  type="button"
                  onClick={() => toggleRestDay(dayOfWeek)}
                  disabled={savingRestDay !== null}
                  aria-pressed={active}
                  aria-label={`${DAY_NAMES[dayOfWeek]} rest day`}
                  data-haptic="light"
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '9999px',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    backgroundColor: active ? 'var(--accent)' : 'var(--surface-elevated)',
                    color: active ? 'var(--on-accent)' : 'var(--text-muted)',
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: savingRestDay !== null ? 'default' : 'pointer',
                    opacity: savingRestDay !== null && savingRestDay !== dayOfWeek ? 0.6 : 1,
                    transition: 'all 150ms ease',
                    padding: 0,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </Section>

      {/* Notifications */}
      <Section label="Notifications">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={titleStyle}>Notifications</div>
            <div style={hintStyle}>
              {!standalone
                ? 'Add to Home Screen to enable alerts'
                : notifPrefs?.enabled
                  ? 'Lock-screen rest & streak alerts'
                  : 'Off — enable for rest & streak pings'}
            </div>
          </div>
          <Switch
            checked={!!notifPrefs?.enabled}
            onClick={() => void toggleNotificationsMaster()}
            disabled={notifBusy || notifPrefs === null}
            ariaLabel="Enable notifications"
          />
        </div>

        {notifPrefs?.enabled && (
          <>
            {(
              [
                ['rest_complete', 'Rest ended', 'Ping when your rest timer hits zero'] as const,
                ['rest_warning_10s', 'Rest warning (10s)', 'Optional heads-up before rest ends'] as const,
                ['workout_status', 'Workout status', 'One card while the app is in the background'] as const,
                ['streak_reminder', 'Streak reminder', 'Evening nudge if you have not trained'] as const,
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key}>
                <div style={{ ...dividerStyle, margin: '0 0 14px' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <div style={titleStyle}>{label}</div>
                    <div style={hintStyle}>{hint}</div>
                  </div>
                  <Switch
                    checked={notifPrefs[key]}
                    onClick={() => void patchNotifPref(key, !notifPrefs[key])}
                    ariaLabel={label}
                  />
                </div>
              </div>
            ))}

            {notifPrefs.streak_reminder && (
              <>
                <div style={{ ...dividerStyle, margin: '0 0 14px' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <div style={titleStyle}>Reminder time</div>
                    <div style={hintStyle}>Local hour (17–21)</div>
                  </div>
                  <select
                    value={notifPrefs.streak_reminder_hour}
                    onChange={e => void patchNotifPref('streak_reminder_hour', Number(e.target.value))}
                    aria-label="Streak reminder hour"
                    style={{
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '9999px',
                      color: 'var(--text-primary)',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '14px',
                      padding: '6px 12px',
                      height: '32px',
                    }}
                  >
                    {[17, 18, 19, 20, 21].map(h => (
                      <option key={h} value={h}>
                        {h === 12 ? '12:00 PM' : h > 12 ? `${h - 12}:00 PM` : `${h}:00`}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {!standalone && (
              <>
                <div style={{ ...dividerStyle, margin: '0 0 14px' }} />
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  On iPhone, alerts work after you add GRIND to your Home Screen.
                </div>
              </>
            )}
          </>
        )}
      </Section>

      {/* Data */}
      <Section label="Data">
        <NavRow
          title={exporting ? 'Exporting…' : 'Export Data'}
          hint="Download workouts, sets & body weight as JSON"
          onClick={() => void handleExportData('json')}
          disabled={exporting}
          icon={downloadIcon}
        />
        <div style={dividerStyle} />
        <NavRow
          title="Export Sets (CSV)"
          hint="Spreadsheet-friendly set history"
          onClick={() => void handleExportData('csv')}
          disabled={exporting}
          icon={csvIcon}
        />
      </Section>

      {/* Help */}
      <Section label="Help">
        <NavRow
          title="Send Feedback"
          hint="Report a bug or request a feature"
          onClick={() => setFeedbackOpen(true)}
          icon={feedbackIcon}
        />
        <div style={dividerStyle} />
        <NavRow
          title="Replay Tutorial"
          hint="Show the app walkthrough again from Home"
          onClick={handleReplayTutorial}
          icon={replayIcon}
        />
      </Section>

      {/* Account */}
      <Section label="Account">
        <button
          type="button"
          data-haptic="medium"
          onClick={handleSignOut}
          style={{
            position: 'relative',
            width: '100%', height: '48px',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '12px',
            color: 'var(--danger)',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '14px', fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >
          SIGN OUT
        </button>
        <button
          type="button"
          data-haptic={deleteConfirm ? 'heavy' : 'light'}
          onClick={() => void handleDeleteMyData()}
          disabled={deletingData}
          style={{
            position: 'relative',
            width: '100%', height: '48px',
            backgroundColor: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            color: deleteConfirm ? 'var(--danger)' : 'var(--text-muted)',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '13px', fontWeight: 600,
            cursor: deletingData ? 'default' : 'pointer',
            letterSpacing: '0.3px',
            opacity: deletingData ? 0.7 : 1,
          }}
        >
          {deletingData
            ? 'DELETING…'
            : deleteConfirm
              ? 'TAP AGAIN TO CONFIRM DELETE ALL DATA'
              : 'DELETE MY DATA'}
        </button>
      </Section>

      {isAdmin && (
        <Section label="Developer">
          <NavRow
            title={replayingSetup ? 'Opening Setup…' : 'Replay Setup'}
            hint="Run the first-run setup wizard again"
            onClick={() => void handleReplaySetup()}
            disabled={replayingSetup}
            icon={setupIcon}
          />
          <div style={dividerStyle} />
          <NavRow
            title="Feedback Inbox"
            hint="Everything users have sent in"
            href="/admin/feedback"
            icon={inboxIcon}
          />
        </Section>
      )}

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </div>
  )
}
