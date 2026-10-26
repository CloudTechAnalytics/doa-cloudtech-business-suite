/**
 * Registers the service worker (public/sw.js) in the real, built app only: never while developing, in the browser demo, or under tests, where a cached copy
 * of the app would only get in the way.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
}
