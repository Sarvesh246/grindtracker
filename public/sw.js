// Minimal offline-shell service worker. Not a full precache/workbox setup —
// just enough that a dead spot in the gym (dropped wifi/cell signal) shows a
// branded retry screen instead of the browser's native connection-error page,
// and that already-fetched JS/CSS bundles keep working without a network.
const CACHE_NAME = 'grind-shell-v1'
const PRECACHE_URLS = ['/offline.html', '/manifest.json', '/icon-192.png', '/icon-512.png']

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
  if (url.pathname.startsWith('/auth/')) return

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
