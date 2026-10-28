import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { isChunkLoadError, mayReloadNow } from '@/shared/utilities/chunkReload'

describe('a page file that a new release removed', () => {
  it('is recognised from the browser\'s messages, and ordinary errors are not mistaken for it', () => {
    for (const m of [
      'Failed to fetch dynamically imported module: https://x.app/assets/StaffPage-abc.js',
      'TypeError: error loading dynamically imported module',
      'Importing a module script failed.',
      'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
      'Loading chunk 7 failed.',
    ]) expect(isChunkLoadError(new Error(m)), m).toBe(true)
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true)
    for (const m of ['Cannot read properties of undefined', 'Network request failed', 'permission denied']) expect(isChunkLoadError(new Error(m)), m).toBe(false)
    expect(isChunkLoadError(null)).toBe(false); expect(isChunkLoadError(undefined)).toBe(false)
  })
  it('reloads the app once, not in a loop', () => {
    expect(mayReloadNow(1_000_000, null)).toBe(true)
    expect(mayReloadNow(1_000_000, 960_000)).toBe(false)
    expect(mayReloadNow(1_000_000, 900_000)).toBe(true)
  })
})

describe('the service worker', () => {
  type Listener = (e: Record<string, unknown>) => void
  const answer = (type: string, ok = true) => ({ ok, headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null) }, clone() { return this } })

  /** Runs the real public/sw.js with a stand-in for the browser, asks it for a script and says what it chose to keep. */
  async function kept(reply: unknown): Promise<string[]> {
    const listeners: Record<string, Listener> = {}; const puts: string[] = []; const store = new Map<string, unknown>()
    const cache = { put: (k: { url: string }, v: unknown) => { store.set(k.url, v); puts.push(k.url); return Promise.resolve() }, addAll: () => Promise.resolve() }
    const caches = { open: () => Promise.resolve(cache), match: (k: { url: string }) => Promise.resolve(store.get(k.url)), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) }
    const self = { addEventListener: (n: string, f: Listener) => { listeners[n] = f }, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() }, location: { origin: 'https://app.test' } }
    runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, caches, URL, fetch: () => Promise.resolve(reply), Response: class {} })
    let given: Promise<unknown> = Promise.resolve()
    listeners.fetch({ request: { method: 'GET', url: 'https://app.test/assets/StaffPage-abc.js', mode: 'cors' }, respondWith: (p: Promise<unknown>) => { given = p } })
    await given; await new Promise((r) => setTimeout(r, 5))
    return puts
  }
  it('keeps a script it fetched, so the app opens fast and offline', async () => { expect(await kept(answer('text/javascript'))).toEqual(['https://app.test/assets/StaffPage-abc.js']) })
  it('never keeps the front page under the name of a script: a removed file is answered with it, and keeping it broke the page for good', async () => {
    expect(await kept(answer('text/html; charset=utf-8'))).toEqual([])
  })
  it('keeps nothing from a failed answer, and has a new version name so old saved copies are dropped', async () => {
    expect(await kept(answer('text/javascript', false))).toEqual([])
    expect(readFileSync('public/sw.js', 'utf8')).toMatch(/const VERSION = 'doa-v2'/)
  })
})
