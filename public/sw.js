// Minimal offline-shell + Web Push service worker. Not a full precache/workbox
// setup — just enough that a dead spot in the gym shows a branded retry screen,
// already-fetched JS/CSS keep working, and lock-screen rest/streak pushes land.
const CACHE_NAME = 'grind-shell-v3'
const PRECACHE_URLS = ['/offline.html', '/manifest.json', '/icon-192.png', '/icon-512.png']

/** In-SW rest timers so rest-end can fire while the page is alive but cron hasn't. */
const restTimeouts = new Map()

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

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
          fetch(request).then(res => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  // Page navigations: always prefer the network (this is a signed-in app,
  // content changes per session) and only fall back to whatever was last
  // cached for this URL — or the offline shell — when the network is
  // genuinely unreachable.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
          }
          return res
        })
        .catch(async () => (await caches.match(request)) || caches.match('/offline.html')),
    )
  }
})

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

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/home'
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

  if (msg.type === 'SHOW_NOTIFICATION') {
    event.waitUntil(showGrindNotification(msg.payload || {}))
    return
  }

  if (msg.type === 'CLOSE_NOTIFICATIONS') {
    const tags = Array.isArray(msg.tags) ? msg.tags : ['grind-rest', 'grind-workout', 'grind-streak']
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
    const { endsAt, payload, warnAt, warnPayload } = msg
    const key = 'rest'
    const prev = restTimeouts.get(key)
    if (prev) {
      clearTimeout(prev.endId)
      if (prev.warnId) clearTimeout(prev.warnId)
    }
    const now = Date.now()
    const endDelay = Math.max(0, (endsAt || 0) - now)
    const endId = setTimeout(() => {
      void showGrindNotification(payload || { title: 'Rest over', tag: 'grind-rest', url: '/log', badge: 1 })
      restTimeouts.delete(key)
    }, endDelay)

    let warnId = null
    if (warnAt && warnAt > now) {
      warnId = setTimeout(() => {
        void showGrindNotification(warnPayload || { title: 'Rest ending soon', tag: 'grind-rest', url: '/log' })
      }, warnAt - now)
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
    event.waitUntil(
      self.registration.getNotifications({ tag: 'grind-rest' }).then(notes => {
        for (const n of notes) n.close()
      }),
    )
  }
})
