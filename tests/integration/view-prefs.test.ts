import { describe, expect, it, vi } from 'vitest'

function stubStorage(initial?: string) {
  const store = new Map<string, string>()
  if (initial !== undefined) store.set('doa.view.v1', initial)
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  return store
}

describe('how a person likes to see lists and records', () => {
  it('starts with a table and full pages', async () => {
    stubStorage(); vi.resetModules()
    const { useViewPrefs, setViewPrefs } = await import('@/shared/view/viewPrefs')
    expect(typeof useViewPrefs).toBe('function')
    const store = stubStorage(); vi.resetModules()
    const m = await import('@/shared/view/viewPrefs')
    m.setViewPrefs({ list: 'grid' })
    expect(JSON.parse(store.get('doa.view.v1')!)).toEqual({ list: 'grid', detail: 'page' })
    setViewPrefs({})
  })

  it('remembers the choice, and ignores anything it does not recognise', async () => {
    stubStorage(JSON.stringify({ list: 'grid', detail: 'panel' })); vi.resetModules()
    await import('@/shared/view/viewPrefs')
    const store = stubStorage(JSON.stringify({ list: 'banana', detail: 42 })); vi.resetModules()
    const m = await import('@/shared/view/viewPrefs')
    m.setViewPrefs({ detail: 'panel' })
    expect(JSON.parse(store.get('doa.view.v1')!)).toEqual({ list: 'table', detail: 'panel' })
  })
})
