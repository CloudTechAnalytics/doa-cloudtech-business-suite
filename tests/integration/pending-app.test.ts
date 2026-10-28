import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { afterAuthPath, afterSignInPath, clearPendingApp, pendingApp, rememberApp } from '@/core/app-catalogue/pendingApp'

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), has: (k: string) => m.has(k) } }
let store: ReturnType<typeof memory>
beforeEach(() => { store = memory(); Object.assign(globalThis, { localStorage: store }) })
afterEach(() => { Reflect.deleteProperty(globalThis, 'localStorage') })

describe('an app chosen on the public site', () => {
  it('is remembered for a day, so signing up and confirming an email still lands on that app', () => {
    rememberApp('invoices', 1_000)
    expect(pendingApp(1_000 + 60_000)?.id).toBe('invoices'); expect(pendingApp(1_000 + 23 * 3_600_000)?.id).toBe('invoices')
  })
  it('is forgotten after a day, and forgotten for good once it has expired', () => {
    rememberApp('invoices', 1_000)
    expect(pendingApp(1_000 + 25 * 3_600_000)).toBeNull(); expect(store.has('doa.pendingApp')).toBe(false)
  })
  it('ignores an old plain value from before, and an app that does not exist', () => {
    store.setItem('doa.pendingApp', 'invoices'); expect(pendingApp()).toBeNull(); expect(store.has('doa.pendingApp')).toBe(false)
    rememberApp('nonsense'); expect(pendingApp()).toBeNull()
  })
})

describe('where signing in leads', () => {
  it('takes someone who simply signs in to their businesses, and forgets a choice left over from an earlier visit', () => {
    rememberApp('invoices')
    expect(afterSignInPath(false)).toBe('/businesses'); expect(pendingApp()).toBeNull()
  })
  it('follows the app only when they came from that app\'s own link this time', () => {
    rememberApp('invoices')
    expect(afterSignInPath(true)).toBe('/start/invoices')
  })
  it('still sends a new account to the app it signed up from', () => {
    rememberApp('pos'); expect(afterAuthPath()).toBe('/start/pos'); clearPendingApp(); expect(afterAuthPath()).toBe('/businesses')
  })
})
