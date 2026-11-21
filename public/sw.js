// Minimal offline-shell + Web Push service worker. Not a full precache/workbox
// setup — just enough that a dead spot in the gym shows a branded retry screen,
// already-fetched JS/CSS keep working, and lock-screen rest/streak pushes land.
const CACHE_NAME = 'grind-shell-v11'
// Content-hashed /_next/static/ bundles live in their own cache so they can be
// trimmed without touching the shell, and survive CACHE_NAME bumps cleanly.
const STATIC_CACHE = 'grind-static-v1'
const OFFLINE_WORKOUT = '/offline-workout'
const STATIC_CACHE_MAX_ENTRIES = 150
const PRECACHE_URLS = ['/offline.html', '/manifest.json', '/icon-192.png', '/icon-512.png']
const PUBLIC_NAV_PATHS = new Set(['/', '/login'])

/** In-SW rest timers so rest-end can fire while the page is alive but cron hasn't. */
const restTimeouts = new Map()
/** Matches page-owned deliver dedupe so SW secondary timer doesn't double-buzz. */
let lastRestEndDedupeKey = null

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k !== CACHE_NAME && k !== STATIC_CACHE)
            .map(k => caches.delete(k)),
        ),
      )
      .then(trimStaticCache)
      .then(() => self.clients.claim()),
  )
})

/** Evict the oldest static bundles beyond the cap (Cache keys are insertion-ordered). */
async function trimStaticCache() {
  try {
    const cache = await caches.open(STATIC_CACHE)
    const keys = await cache.keys()
    const excess = keys.length - STATIC_CACHE_MAX_ENTRIES
    for (let i = 0; i < excess; i++) await cache.delete(keys[i])
  } catch {
    /* best-effort housekeeping */
  }
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Supabase/API calls need real network errors to reach the app's own
  // retry/error-toast logic — never let the service worker mask those.
  if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/')) return

  // Content-hashed Next.js bundles are immutable — safe to serve straight
  // from cache and only touch the network on a genuine miss.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        cached =>
          cached ||
          // One quick retry: a single dropped packet on a weak signal used to
          // reject the chunk and crash the route (ChunkLoadError).
          fetch(request).catch(() => new Promise(r => setTimeout(r, 400)).then(() => fetch(request))).then(res => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(STATIC_CACHE).then(cache => cache.put(request, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  // Page navigations: always prefer the network (this is a signed-in app,
  // content changes per session). Only public routes are cached-and-replayed
  // offline; private/authenticated routes fall straight back to the offline
  // shell so a signed-out or different user on this device never sees a
  // stale copy of someone else's dashboard.
  if (request.mode === 'navigate') {
    if (url.pathname === OFFLINE_WORKOUT || url.pathname === '/log') {
      event.respondWith((async () => {
        try {
          const response = await fetch(request, { signal: AbortSignal.timeout(4500) })
          if (response.status < 500) return response
        } catch {
          // Use the generic workout entry when the network is unavailable.
        }
        const shell = await caches.match(OFFLINE_WORKOUT)
        if (shell) {
          if (url.pathname === OFFLINE_WORKOUT) return shell
          return Response.redirect(new URL(OFFLINE_WORKOUT + url.search, url.origin).href)
        }
        return caches.match('/offline.html')
      })())
      return
    }
    const isPublic = PUBLIC_NAV_PATHS.has(url.pathname)
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok && !res.redirected && isPublic) {
            const copy = res.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
          }
          return res
        })
        .catch(async () => {
          if (isPublic) {
            const cached = await caches.match(request)
            if (cached) return cached
          }
          return caches.match('/offline.html')
        }),
    )
  }
})

/** Warm the public, credential-free workout shell and its client bundles. */
async function warmWorkoutShell() {
  const conn = self.navigator?.connection
  if (conn && (conn.saveData || /^(slow-2g|2g)$/.test(conn.effectiveType || ''))) return
  const shell = await fetch(OFFLINE_WORKOUT, { credentials: 'omit' })
  if (!shell.ok || shell.redirected) return
  const html = await shell.clone().text()
  const urls = [...new Set(html.match(/\/_next\/static\/[^"'\s\)]+?\.(?:js|css)/g) || [])]
  const assets = await caches.open(STATIC_CACHE)
  await Promise.all(urls.map(async url => {
    if (await assets.match(url)) return
    const response = await fetch(url)
    if (!response.ok) throw new Error('Offline workout bundle unavailable')
    await assets.put(url, response)
  }))
  const cache = await caches.open(CACHE_NAME)
  await cache.put(OFFLINE_WORKOUT, shell)
}

async function anyClientFocused() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return clients.some(c => c.visibilityState === 'visible' && c.focused)
}

async function showGrindNotification(data) {
  const title = data.title || 'GRIND'
  const tag = data.tag || 'grind'
  const options = {
    body: data.body || '',
    tag,
    data: { url: data.url || '/home', tag },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    renotify: !!data.renotify,
  }

  // Suppress while a GRIND window is focused (anti-spam).
  if (await anyClientFocused()) {
    const existing = await self.registration.getNotifications({ tag })
    for (const n of existing) n.close()
    return
  }

  await self.registration.showNotification(title, options)

  if (typeof self.registration.setAppBadge === 'function' && data.badge) {
    try {
      await self.registration.setAppBadge(Number(data.badge) || 1)
    } catch {
      /* unsupported */
    }
  }
}

self.addEventListener('push', event => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'GRIND', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(showGrindNotification(data))
})

function safeAppPath(url) {
  if (typeof url !== 'string') return '/home'
  const trimmed = url.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/home'
  if (trimmed.includes('\\') || trimmed.includes('://')) return '/home'
  return trimmed
}

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = safeAppPath((event.notification.data && event.notification.data.url) || '/home')
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client && url) {
            try {
              await client.navigate(url)
            } catch {
              /* navigate may fail on older browsers */
            }
          }
          return
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url)
      }
    }),
  )
})

self.addEventListener('message', event => {
  const msg = event.data
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'WARM_WORKOUT_SHELL') {
    event.waitUntil(warmWorkoutShell().catch(() => {}))
    return
  }

  if (msg.type === 'SHOW_NOTIFICATION') {
    event.waitUntil(showGrindNotification(msg.payload || {}))
    return
  }

  if (msg.type === 'CLOSE_NOTIFICATIONS') {
    const tags = Array.isArray(msg.tags)
      ? msg.tags
      : ['grind-rest', 'grind-rest-warn', 'grind-workout', 'grind-streak']
    event.waitUntil(
      (async () => {
        for (const tag of tags) {
          const notes = await self.registration.getNotifications({ tag })
          for (const n of notes) n.close()
        }
        if (msg.clearBadge && typeof self.registration.clearAppBadge === 'function') {
          try {
            await self.registration.clearAppBadge()
          } catch {
            /* unsupported */
          }
        }
      })(),
    )
    return
  }

  if (msg.type === 'SCHEDULE_LOCAL_REST') {
    // Best-effort only: idle SWs are killed (~30s), so long rests rely on the
    // page-owned timers in src/lib/push/client.ts. Keep this as a secondary
    // path when the worker stays alive (e.g. short remaining time).
    const { endsAt, payload, warnAt, warnPayload, dedupeKey } = msg
    const key = 'rest'
    const prev = restTimeouts.get(key)
    if (prev) {
      clearTimeout(prev.endId)
      if (prev.warnId) clearTimeout(prev.warnId)
    }
    const now = Date.now()
    const endDelay = (endsAt || 0) - now

    // Don't arm if already past — page path handles the short grace window.
    if (endDelay <= 0) {
      restTimeouts.delete(key)
      return
    }

    // +150ms so the page-owned timer wins; skip if page already delivered.
    const endId = setTimeout(() => {
      if (dedupeKey && lastRestEndDedupeKey === dedupeKey) {
        restTimeouts.delete(key)
        return
      }
      if (dedupeKey) lastRestEndDedupeKey = dedupeKey
      void showGrindNotification(
        payload || { title: 'Rest over', tag: 'grind-rest', url: '/log', badge: 1, renotify: true },
      )
      restTimeouts.delete(key)
    }, endDelay + 150)

    let warnId = null
    if (warnAt && warnAt > now) {
      const warnDelay = warnAt - now
      warnId = setTimeout(() => {
        void showGrindNotification(
          warnPayload || { title: 'Rest ending soon', tag: 'grind-rest-warn', url: '/log' },
        )
      }, warnDelay + 150)
    }
    restTimeouts.set(key, { endId, warnId })
    return
  }

  if (msg.type === 'CANCEL_LOCAL_REST') {
    const prev = restTimeouts.get('rest')
    if (prev) {
      clearTimeout(prev.endId)
      if (prev.warnId) clearTimeout(prev.warnId)
      restTimeouts.delete('rest')
    }
    // Don't close grind-rest here — cancel often runs right after a successful
    // local deliver, and closing would eat the alert the user needs.
  }
})
