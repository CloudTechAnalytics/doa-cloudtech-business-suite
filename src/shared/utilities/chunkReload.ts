/**
 * A page of the app is a separate file that is fetched when it is first opened. If the app was updated while someone had it open, the file they ask for no longer
 * exists and the page would stay blank. These recognise that case so the app can fetch the new version once, by itself, instead of leaving a blank screen.
 */
export const isChunkLoadError = (e: unknown): boolean => {
  const m = typeof e === 'string' ? e : e instanceof Error ? `${e.name} ${e.message}` : ''
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed|Unable to preload CSS|Expected a JavaScript.*module script but the server responded with a MIME type/i.test(m)
}

/** Reload at most once in a while, so a page that is truly broken does not reload in a loop. */
export const mayReloadNow = (now: number, last: number | null, windowMs = 60_000): boolean => last === null || !(now - last < windowMs)

const KEY = 'doa.chunkReload'
export function reloadForNewVersion(): boolean {
  let last: number | null = null
  try { const v = sessionStorage.getItem(KEY); last = v ? Number(v) : null } catch { /* storage blocked */ }
  if (!mayReloadNow(Date.now(), last)) return false
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* storage blocked */ }
  window.location.reload()
  return true
}

/** Called once at start: a failed page file, from a build that was replaced, reloads the app to the new version. */
export function installChunkReload() {
  window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); reloadForNewVersion() })
  window.addEventListener('unhandledrejection', (e) => { if (isChunkLoadError(e.reason)) reloadForNewVersion() })
}
