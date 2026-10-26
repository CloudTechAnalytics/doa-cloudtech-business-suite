/*
 * DOA service worker. It does three things and nothing more:
 *  1. keeps the app's own files (hashed scripts, styles, icons) so the app opens fast and opens at all without a signal;
 *  2. loads pages from the network first, falling back to the saved app shell, then to a plain "you are offline" page;
 *  3. never touches anything that is not this site's own files: the database, sign-in, and every POST go straight to the network, so no business data is ever
 *     stored by the service worker.
 */
const VERSION = 'doa-v1'
const SHELL = `${VERSION}-shell`
const FILES = `${VERSION}-files`

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/offline.html', '/icons/icon-192.png'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return // database, auth and other sites: network only

  // Pages: network first, so people always get the newest version when they are online.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/index.html', copy)); return res })
        .catch(async () => (await caches.match('/index.html')) || (await caches.match('/offline.html')) || Response.error()),
    )
    return
  }

  // The app's own built files and icons never change under the same name: serve the saved copy, and save it the first time.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/favicon.svg') {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(FILES).then((c) => c.put(req, copy)) } return res })),
    )
  }
})
