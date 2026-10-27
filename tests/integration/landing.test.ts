import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { landingApps, landingMenus } from '@/app/navigation/navigation'
import { INDUSTRIES } from '@/core/industry-registry'
import { clearDraft, loadDraft, saveDraft } from '@/core/businesses/draft'
import type { OnboardingDraft } from '@/core/businesses/draft'

describe('landing page content comes from the registries', () => {
  it('lists the shared apps (no settings) and one app per active industry that owns modules', () => {
    const { shared, industries } = landingApps()
    expect(shared.map((a) => a.id)).toEqual(['sales', 'crm', 'invoices', 'inventory', 'purchase', 'finance', 'staff'])
    expect(shared.every((a) => a.blurb.length > 0)).toBe(true)
    expect(industries.map((a) => a.id)).toEqual(['retail', 'farm', 'bakery', 'pharmacy', 'school'])
    expect(industries.map((a) => a.label)).toEqual(['Mart', 'Farm operations', 'Bakery production', 'Pharmacy', 'School'])
  })

  it('never advertises an unavailable industry', () => {
    expect(landingApps().industries.every((a) => INDUSTRIES[a.id].status === 'active')).toBe(true)
  })
})

describe('the Apps and Industries menus come from the registries', () => {
  const { apps, industries } = landingMenus()
  const labels = (id: string) => apps.find((c) => c.id === id)!.items.map((i) => i.label)

  it('lists each standalone app on its own, not industries or a bundle; industries have their own menu', () => {
    expect(apps.map((c) => c.id)).toEqual(['crm', 'pos', 'inventory', 'invoices', 'expenses', 'finance'])
    expect(apps.map((c) => c.title)).toEqual(['CRM', 'POS', 'Inventory', 'Invoices', 'Expenses', 'Finance'])
    expect(labels('crm')).toEqual(['Contacts & customers', 'Leads', 'Deals pipeline', 'Quotes', 'Follow-ups', 'CRM reports'])
    expect(apps.some((c) => ['retail', 'farm', 'bakery', 'pharmacy', 'school'].includes(c.id))).toBe(false)
  })

  it('sends each app link to the sign-in page for that app: every link and button carries that app', () => {
    for (const c of apps) {
      expect(c.cta?.to).toBe(`/sign-in?app=${c.id}`)
      expect(c.items.length).toBeGreaterThan(0)
      expect(c.items.every((i) => i.to === `/sign-in?app=${c.id}`)).toBe(true)
    }
  })

  it('lists every industry, each linking to a pre-selected picker', () => {
    expect(industries.map((c) => c.id)).toEqual(['retail', 'farm', 'bakery', 'pharmacy', 'school'])
    for (const c of industries) {
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
    saveDraft({ ...draft, selected: ['spaceship', 'farm'] as unknown as OnboardingDraft['selected'] })
    expect(loadDraft()?.selected).toEqual(['farm'])
    saveDraft({ ...draft, selected: ['spaceship'] as unknown as OnboardingDraft['selected'] })
    expect(loadDraft()).toBeNull()
  })

  it('fills in safe defaults for missing fields', () => {
    store.set('doa.onboarding.draft', JSON.stringify({ selected: ['retail'] }))
    expect(loadDraft()).toEqual({ selected: ['retail'], names: {}, answers: {}, addons: {}, currency: 'NGN', tz: 'Africa/Lagos' })
  })
})
