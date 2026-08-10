'use client'

import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  type RestScheduleInput,
  type ScheduleAction,
} from './types'

const COACH_SEEN_KEY = 'grind.push.coach_seen'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  )
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

function postToSw(msg: unknown) {
  const ctrl = navigator.serviceWorker?.controller
  if (ctrl) {
    ctrl.postMessage(msg)
    return
  }
  void getRegistration().then(reg => {
    reg?.active?.postMessage(msg)
  })
}

export async function closeGrindNotifications(opts?: { clearBadge?: boolean; tags?: string[] }) {
  postToSw({
    type: 'CLOSE_NOTIFICATIONS',
    tags: opts?.tags ?? ['grind-rest', 'grind-workout', 'grind-streak'],
    clearBadge: opts?.clearBadge !== false,
  })
  if (opts?.clearBadge !== false && 'clearAppBadge' in navigator) {
    try {
      await (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.()
    } catch {
      /* unsupported */
    }
  }
}

export async function setAppBadge(count = 1) {
  if ('setAppBadge' in navigator) {
    try {
      await (navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void> }).setAppBadge?.(count)
    } catch {
      /* unsupported */
    }
  }
}

export function showLocalNotification(payload: {
  title: string
  body?: string
  tag?: string
  url?: string
  badge?: number
  renotify?: boolean
}) {
  postToSw({ type: 'SHOW_NOTIFICATION', payload })
}

/** Page-owned timers — SW setTimeout dies when the worker is killed (~30s idle). */
let pageRestEndId: ReturnType<typeof setTimeout> | null = null
let pageRestWarnId: ReturnType<typeof setTimeout> | null = null

function clearPageRestTimers() {
  if (pageRestEndId != null) {
    clearTimeout(pageRestEndId)
    pageRestEndId = null
  }
  if (pageRestWarnId != null) {
    clearTimeout(pageRestWarnId)
    pageRestWarnId = null
  }
}

function restEndPayload(exerciseName: string) {
  return {
    title: 'Rest over',
    body: exerciseName ? `${exerciseName} — back to work` : 'Back to work',
    tag: 'grind-rest',
    url: '/log',
    badge: 1,
  }
}

function restWarnPayload(exerciseName: string) {
  return {
    title: 'Rest ending soon',
    body: exerciseName ? `~10s on ${exerciseName}` : '~10 seconds left',
    tag: 'grind-rest',
    url: '/log',
  }
}

/**
 * Arm prompt rest-end while the page (and best-effort SW) can still run timers.
 * Cron is 15-minute coarse — without this, 60–180s rests only notify when JS is
 * frozen and the next cron tick arrives (or never, if the phone stays locked).
 */
export function scheduleLocalRestFallback(opts: {
  endsAtMs: number
  exerciseName: string
  warnAtMs?: number | null
}) {
  clearPageRestTimers()

  const endPayload = restEndPayload(opts.exerciseName)
  const warnPayload = restWarnPayload(opts.exerciseName)
  const now = Date.now()
  const endDelay = Math.max(0, opts.endsAtMs - now)

  // Don't arm timer if the end time has already passed - prevents immediate spam.
  if (endDelay === 0) {
    return
  }

  pageRestEndId = setTimeout(() => {
    pageRestEndId = null
    showLocalNotification(endPayload)
  }, endDelay)

  if (opts.warnAtMs != null && opts.warnAtMs > now) {
    pageRestWarnId = setTimeout(() => {
      pageRestWarnId = null
      showLocalNotification(warnPayload)
    }, opts.warnAtMs - now)
  }

  // Best-effort SW timers too (may be dropped if the worker is killed idle).
  postToSw({
    type: 'SCHEDULE_LOCAL_REST',
    endsAt: opts.endsAtMs,
    warnAt: opts.warnAtMs ?? null,
    payload: endPayload,
    warnPayload,
  })
}

export function cancelLocalRestFallback() {
  clearPageRestTimers()
  postToSw({ type: 'CANCEL_LOCAL_REST' })
}

/** Fire rest-end from the page tick when remaining hits 0 (belt-and-suspenders). */
export function notifyRestEndedLocally(exerciseName: string) {
  showLocalNotification(restEndPayload(exerciseName))
}

export async function fetchNotificationPrefs(): Promise<NotificationPrefs | null> {
  const res = await fetch('/api/push/prefs', { credentials: 'same-origin' })
  if (!res.ok) return null
  const data = (await res.json()) as { prefs: NotificationPrefs | null }
  return data.prefs
}

export async function saveNotificationPrefs(
  patch: Partial<Omit<NotificationPrefs, 'user_id' | 'updated_at'>>,
): Promise<NotificationPrefs | null> {
  const res = await fetch('/api/push/prefs', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...patch,
      timezone: patch.timezone ?? getBrowserTimezone(),
    }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { prefs: NotificationPrefs }
  return data.prefs
}

export async function syncTimezoneIfEnabled() {
  if (!pushSupported()) return
  try {
    const prefs = await fetchNotificationPrefs()
    if (!prefs?.enabled) return
    const tz = getBrowserTimezone()
    if (prefs.timezone !== tz) {
      await saveNotificationPrefs({ timezone: tz })
    }
  } catch {
    /* ignore */
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

export async function subscribeToPush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) {
    return { ok: false, error: 'Push is not supported in this browser' }
  }
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!publicKey) {
    return { ok: false, error: 'Push is not configured' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, error: 'Notification permission denied' }
  }

  const reg = await getRegistration()
  if (!reg) return { ok: false, error: 'Service worker not ready' }

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    })
  }

  const json = sub.toJSON()
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      expirationTime: sub.expirationTime,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return { ok: false, error: (body as { error?: string }).error || 'Subscribe failed' }
  }

  await saveNotificationPrefs({
    enabled: true,
    timezone: getBrowserTimezone(),
  })

  return { ok: true }
}

export async function unsubscribeFromPush(): Promise<{ ok: boolean }> {
  const sub = await currentSubscription()
  if (sub) {
    const endpoint = sub.endpoint
    try {
      await sub.unsubscribe()
    } catch {
      /* ignore */
    }
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => null)
  }
  await saveNotificationPrefs({ enabled: false })
  await closeGrindNotifications({ clearBadge: true })
  cancelLocalRestFallback()
  return { ok: true }
}

async function postSchedule(actions: ScheduleAction[]): Promise<boolean> {
  if (actions.length === 0) return true
  const res = await fetch('/api/push/schedule', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actions }),
  })
  return res.ok
}

/**
 * Cancel previous rest schedules for the session, then upsert rest_end (+ optional warn).
 * Arms page + SW local timers first (prompt for 60–180s rests); server schedule
 * remains the fallback when JS is frozen (locked phone / suspended tab).
 */
export async function scheduleRestNotifications(input: RestScheduleInput): Promise<void> {
  const { sessionId, exerciseId, exerciseName, endsAtMs, durationSec, prefs } = input

  cancelLocalRestFallback()

  if (!prefs.enabled || !prefs.rest_complete) {
    await postSchedule([{ action: 'cancel', sessionId }])
    return
  }

  let warnAtMs: number | null = null
  if (prefs.rest_warning_10s && durationSec > 15) {
    const candidate = endsAtMs - 10_000
    if (candidate > Date.now()) warnAtMs = candidate
  }

  // Local path first — do not wait on the network before arming timers.
  scheduleLocalRestFallback({ endsAtMs, exerciseName, warnAtMs })

  const actions: ScheduleAction[] = [
    { action: 'cancel', sessionId },
    {
      action: 'upsert',
      kind: 'rest_end',
      fireAt: new Date(endsAtMs).toISOString(),
      dedupeKey: `rest:${sessionId}:${exerciseId}:end:${endsAtMs}`,
      payload: restEndPayload(exerciseName),
    },
  ]

  if (warnAtMs != null) {
    actions.push({
      action: 'upsert',
      kind: 'rest_warn',
      fireAt: new Date(warnAtMs).toISOString(),
      dedupeKey: `rest:${sessionId}:${exerciseId}:warn:${endsAtMs}`,
      payload: restWarnPayload(exerciseName),
    })
  }

  await postSchedule(actions)
}

export async function cancelRestNotifications(sessionId: string): Promise<void> {
  cancelLocalRestFallback()
  await postSchedule([{ action: 'cancel', sessionId }])
  await closeGrindNotifications({ tags: ['grind-rest'], clearBadge: false })
}

/** Static hybrid status card — not a ticking countdown. */
export function updateWorkoutStatusNotification(opts: {
  resting: boolean
  exerciseName?: string
  remainingMs?: number
  doneSets: number
  totalSets: number
}) {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    return
  }
  const mins = opts.remainingMs != null ? Math.max(1, Math.ceil(opts.remainingMs / 60_000)) : null
  if (opts.resting && opts.exerciseName) {
    showLocalNotification({
      title: 'Resting',
      body: `${opts.exerciseName} · ~${mins ?? '?'}m`,
      tag: 'grind-workout',
      url: '/log',
    })
  } else {
    showLocalNotification({
      title: 'Workout in progress',
      body: `${opts.doneSets}/${opts.totalSets} sets`,
      tag: 'grind-workout',
      url: '/log',
    })
  }
}

export function clearWorkoutNotifications() {
  void closeGrindNotifications({ tags: ['grind-workout'], clearBadge: false })
}

export function hasSeenPushCoach(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(COACH_SEEN_KEY) === '1'
}

export function markPushCoachSeen() {
  if (typeof window === 'undefined') return
  localStorage.setItem(COACH_SEEN_KEY, '1')
}

export { DEFAULT_NOTIFICATION_PREFS }
