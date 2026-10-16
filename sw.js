/* Jum e-SIM — minimal offline service worker (Module 6).
 * App shell: cache-first (hashed assets never change).
 * pricing.json: network-first with cache fallback (24h freshness is enforced
 * app-side by lib/offline.ts).
 * API calls: never cached.
 */
const SHELL_CACHE = 'jum-shell-v1'
const DATA_CACHE = 'jum-data-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(['/', '/index.html', '/pricing.json'])),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  // app shell + hashed assets: cache-first
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) => hit ?? fetch(e.request).then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put(e.request, copy))
          return res
        }),
      ),
    )
    return
  }

  // pricing.json: network-first, cached fallback
  if (url.pathname === '/pricing.json') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(DATA_CACHE).then((c) => c.put(e.request, copy))
          return res
        })
        .catch(() => caches.match(e.request)),
    )
  }
})
