import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { landingApps, landingMenus } from '@/app/navigation/navigation'
import { clearDraft, loadDraft, saveDraft } from '@/core/businesses/draft'
import type { OnboardingDraft } from '@/core/businesses/draft'

describe('landing page content comes from the registries', () => {
  it('lists the shared apps (no settings) and one app per active industry that owns modules', () => {
    const { shared, industries } = landingApps()
    expect(shared.map((a) => a.id)).toEqual(['sales', 'crm', 'inventory', 'purchase', 'finance', 'staff'])
    expect(shared.every((a) => a.blurb.length > 0)).toBe(true)
    expect(industries.map((a) => a.id)).toEqual(['farm', 'bakery'])
    expect(industries.map((a) => a.label)).toEqual(['Farm operations', 'Bakery production'])
  })

  it('never advertises an unavailable industry', () => {
    expect(landingApps().industries.map((a) => a.id)).not.toContain('pharmacy')
  })
})

describe('the Apps and Industries menus come from the registries', () => {
  const { apps, industries } = landingMenus()
  const labels = (id: string) => apps.find((c) => c.id === id)!.items.map((i) => i.label)

  it('groups shared modules by area and gives each active industry its own column', () => {
    expect(apps.map((c) => c.title)).toEqual(['Sales', 'Stock and purchasing', 'Farm operations', 'Bakery production', 'Finance', 'Administration'])
    expect(labels('Sales and customers')).toEqual(['Sales / POS', 'CRM'])
    expect(labels('farm')).toContain('Farm Batches')
    expect(labels('Stock and purchasing')).toEqual(['Inventory', 'Purchases', 'Suppliers'])
  })

  it('labels unfinished modules honestly and finished ones not at all', () => {
    const tag = (col: string, label: string) => apps.find((c) => c.id === col)!.items.find((i) => i.label === label)!.tag
    expect(tag('bakery', 'Recipes')).toBe('Preview')
    expect(tag('Finance', 'Expenses')).toBeUndefined() // built
    expect(tag('farm', 'Farm Expenses')).toBeUndefined() // built
    expect(tag('farm', 'Farm Batches')).toBeUndefined()
    expect(tag('Sales and customers', 'Sales / POS')).toBeUndefined()
  })

  it('lists every industry, with pharmacy as coming soon and the others linking to a pre-selected picker', () => {
    expect(industries.map((c) => c.id)).toEqual(['retail', 'farm', 'bakery', 'pharmacy'])
    const pharmacy = industries.find((c) => c.id === 'pharmacy')!
    expect(pharmacy.items).toEqual([])
    expect(pharmacy.cta).toBeUndefined()
    for (const c of industries.filter((x) => x.id !== 'pharmacy')) {
      expect(c.cta?.to).toBe(`/start?type=${c.id}`)
      expect(c.items.length).toBeGreaterThan(0)
      expect(c.items.every((i) => i.to === `/start?type=${c.id}`)).toBe(true)
    }
  })
})

describe('the onboarding draft survives sign-up', () => {
  const store = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    })
  })
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  })

  const draft: OnboardingDraft = {
    selected: ['farm', 'bakery'], names: { farm: 'Green Valley', bakery: 'Sunrise' },
    answers: { farm: { has_poultry: true, tax_rate_percent: 7.5 } }, addons: { farm: ['suppliers'] }, currency: 'NGN', tz: 'Africa/Lagos',
  }

  it('round-trips choices and clears', () => {
    saveDraft(draft)
    expect(loadDraft()).toEqual(draft)
    clearDraft()
    expect(loadDraft()).toBeNull()
  })

  it('stores no credentials', () => {
    saveDraft(draft)
    expect([...store.values()].join()).not.toMatch(/password|email|token/i)
  })

  it('ignores corrupt data, empty selections and unavailable business types', () => {
    store.set('doa.onboarding.draft', '{not json')
    expect(loadDraft()).toBeNull()
    saveDraft({ ...draft, selected: [] })
    expect(loadDraft()).toBeNull()
    saveDraft({ ...draft, selected: ['pharmacy', 'farm'] as OnboardingDraft['selected'] })
    expect(loadDraft()?.selected).toEqual(['farm'])
    saveDraft({ ...draft, selected: ['pharmacy'] as OnboardingDraft['selected'] })
    expect(loadDraft()).toBeNull()
  })

  it('fills in safe defaults for missing fields', () => {
    store.set('doa.onboarding.draft', JSON.stringify({ selected: ['retail'] }))
    expect(loadDraft()).toEqual({ selected: ['retail'], names: {}, answers: {}, addons: {}, currency: 'NGN', tz: 'Africa/Lagos' })
  })
})
