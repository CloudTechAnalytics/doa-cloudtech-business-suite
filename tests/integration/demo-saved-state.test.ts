import { describe, expect, it } from 'vitest'

describe('demo data saved by an older version', () => {
  it('still gets the demo accounts added since, so every listed login works', async () => {
    // A browser that saved the demo data before the platform accounts existed.
    const store = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    store.set('doa.demo.v2', JSON.stringify({ userId: null, modules: {}, users: [{ id: 'u-owner', email: 'owner@demo.test', password: 'demo1234', name: 'Demo Owner' }], businesses: [{ id: 'b-farm', name: 'Greenfield Farms', industry: 'farm' }], members: [] }))
    const { DEMO_LOGINS, demoSignIn, getDemoState } = await import('@/demo/demoStore')
    for (const l of DEMO_LOGINS) expect(demoSignIn(l.email, l.password), l.email).toBeNull()
    expect(getDemoState().businesses[0].createdAt).toBeTruthy()
  })
})
