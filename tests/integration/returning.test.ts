import { describe, expect, it } from 'vitest'
import { homeRedirect, takeSignedOut, markSignedOut, isReturning, markReturning, firstEntry } from '@/core/auth/returning'

describe('where the website address leads', () => {
  it('shows the front page to someone who has never signed in', () => { expect(homeRedirect(false, true, false)).toBeNull() })
  it('sends someone who signed in before, and is signed out, to the sign-in page', () => { expect(homeRedirect(false, true, true)).toBe('/sign-in') })
  it('sends someone still signed in to their businesses', () => { expect(homeRedirect(true, true, true)).toBe('/businesses'); expect(homeRedirect(true, true, false)).toBe('/businesses') })
  it('shows the page on later visits to it within the same tab, so website links still work', () => { expect(homeRedirect(true, false, true)).toBeNull(); expect(homeRedirect(false, false, true)).toBeNull() })
})

describe('what the browser remembers', () => {
  it('does not fail when storage is not there, and says nothing was remembered', () => {
    expect(isReturning()).toBe(false); expect(() => markReturning()).not.toThrow(); expect(takeSignedOut()).toBe(false); expect(() => markSignedOut()).not.toThrow(); expect(typeof firstEntry()).toBe('boolean')
  })
  it('remembers a sign-in and one sign-out message when storage works', () => {
    const mem = new Map<string, string>(); const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
    Object.assign(globalThis, { localStorage: store, sessionStorage: store })
    try {
      expect(isReturning()).toBe(false); markReturning(); expect(isReturning()).toBe(true)
      expect(takeSignedOut()).toBe(false); markSignedOut(); expect(takeSignedOut()).toBe(true); expect(takeSignedOut()).toBe(false)
    } finally { Reflect.deleteProperty(globalThis, 'localStorage'); Reflect.deleteProperty(globalThis, 'sessionStorage') }
  })
})

describe('the first visit', () => {
  it('counts only until the front page has been dealt with', async () => {
    const { entryDone } = await import('@/core/auth/returning')
    entryDone(); expect(firstEntry()).toBe(false)
  })
})
