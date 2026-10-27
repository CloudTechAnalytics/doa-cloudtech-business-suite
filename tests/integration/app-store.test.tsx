import { describe, expect, it } from 'vitest'
import { APP_CATEGORIES, STANDALONE_APPS, appState } from '@/core/app-catalogue/apps'
import { startWithApp } from '@/core/app-catalogue/startWithApp'
import { STORE_FILTERS, actionsFor, filterApps, installedCount, isInstalled } from '@/core/app-catalogue/storeLogic'
import { listIndustries } from '@/core/industry-registry'
import { demoCreateBusiness, demoModuleStatuses, demoSignIn, demoSignOut } from '@/demo/demoStore'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
const ids = (apps: { id: string }[]) => apps.map((a) => a.id)
const app = (id: string) => STANDALONE_APPS.find((a) => a.id === id)!

describe('the app catalogue as a store', () => {
  it('puts every app in a category and says how it works with the others', () => {
    const known = new Set(APP_CATEGORIES.map((c) => c.key))
    for (const a of STANDALONE_APPS) { expect(known.has(a.category), a.id).toBe(true); expect(a.worksWith.length, a.id).toBeGreaterThan(0) }
    expect(app('pos').worksWith.join(' ')).toMatch(/Inventory/)
  })
  it('offers a filter for each category, installed and not installed, and whole businesses', () => {
    expect(STORE_FILTERS.map((f) => f.key)).toEqual(['all', 'installed', 'not_installed', 'sell', 'stock', 'money', 'businesses'])
  })
})

describe('listing and searching apps', () => {
  it('lists everything for All, and by category; splits installed from not installed', async () => {
    as('owner@demo.test')
    const b = demoCreateBusiness('Freelance Co', 'general')
    expect(await startWithApp(b, 'invoices')).toBeNull()
    const st = demoModuleStatuses(b)
    expect(ids(filterApps(st, 'all', ''))).toHaveLength(6)
    expect(ids(filterApps(st, 'money', ''))).toEqual(['invoices', 'expenses', 'finance']); expect(ids(filterApps(st, 'stock', ''))).toEqual(['inventory']); expect(ids(filterApps(st, 'sell', ''))).toEqual(['crm', 'pos'])
    expect(ids(filterApps(st, 'installed', ''))).toEqual(['invoices']); expect(ids(filterApps(st, 'not_installed', ''))).toEqual(['crm', 'pos', 'inventory', 'expenses', 'finance'])
    expect(installedCount(st)).toBe(1)
    expect(filterApps(st, 'businesses', '')).toEqual([])
  })
  it('searches names, taglines, descriptions and what an app does, needing every word, together with a filter', async () => {
    as('owner@demo.test')
    const b = demoCreateBusiness('Freelance Co 2', 'general'); await startWithApp(b, 'invoices')
    const st = demoModuleStatuses(b)
    expect(ids(filterApps(st, 'all', 'quote'))).toContain('crm'); expect(ids(filterApps(st, 'all', 'receipt'))).toContain('pos')
    expect(ids(filterApps(st, 'all', 'STOCK counts'))).toEqual(['inventory']); expect(filterApps(st, 'all', 'zzzz')).toEqual([])
    expect(ids(filterApps(st, 'installed', 'quote'))).toEqual(['invoices']) // Invoices mentions quotes; CRM is not installed
    expect(ids(filterApps(st, 'all', '  '))).toHaveLength(6)
  })
  it('knows what counts as installed', () => {
    for (const s of ['active', 'needs_plan', 'no_permission'] as const) expect(isInstalled(s)).toBe(true)
    for (const s of ['available', 'unavailable'] as const) expect(isInstalled(s)).toBe(false)
  })
})

describe('what a person can do with an app', () => {
  it('lets someone who manages the business install an app that is not on, and open and remove one that is', async () => {
    as('owner@demo.test')
    const b = demoCreateBusiness('Shop Co', 'general'); await startWithApp(b, 'crm')
    const st = demoModuleStatuses(b)
    expect(actionsFor(app('invoices'), st, true)).toEqual({ primary: { kind: 'install' }, secondary: null })
    expect(actionsFor(app('crm'), st, true)).toEqual({ primary: { kind: 'open' }, secondary: { kind: 'remove' } })
  })
  it('tells people who cannot manage the business to ask the owner, and still lets them open an installed app', async () => {
    as('owner@demo.test')
    const b = demoCreateBusiness('Shop Co 2', 'general'); await startWithApp(b, 'crm')
    const st = demoModuleStatuses(b)
    expect(actionsFor(app('invoices'), st, false).primary).toMatchObject({ kind: 'none', note: expect.stringMatching(/Ask the business owner/) })
    expect(actionsFor(app('crm'), st, false)).toEqual({ primary: { kind: 'open' }, secondary: null })
  })
  it('does not offer to remove an app that another app needs, and says which', async () => {
    as('owner@demo.test')
    const b = demoCreateBusiness('Shop Co 3', 'general'); await startWithApp(b, 'pos')
    const r = actionsFor(app('inventory'), demoModuleStatuses(b), true)
    expect(r.primary).toEqual({ kind: 'open' }); expect(r.secondary).toMatchObject({ kind: 'none', note: expect.stringMatching(/Needed by DOA POS/) })
  })
  it('does not offer to remove what the business type requires, and offers an extra app to a shop', () => {
    as('owner@demo.test')
    const st = demoModuleStatuses(demoCreateBusiness('Corner Shop', 'retail'))
    expect(actionsFor(app('pos'), st, true).secondary).toMatchObject({ kind: 'none', note: expect.stringMatching(/stays on/) })
    expect(appState(app('invoices'), st)).toBe('available'); expect(actionsFor(app('invoices'), st, true).primary).toEqual({ kind: 'install' })
  })
  it('explains that an app is not for a business type that has its own tools', () => {
    as('owner@demo.test')
    expect(actionsFor(app('pos'), demoModuleStatuses(demoCreateBusiness('Bright School', 'school')), true).primary).toMatchObject({ kind: 'none', note: expect.stringMatching(/own tools/) })
  })
})

describe('whole businesses', () => {
  it('are the real business types, not the Business apps type', () => {
    const names = listIndustries().filter((d) => d.status === 'active' && d.id !== 'general').map((d) => d.id)
    expect(names).toEqual(expect.arrayContaining(['retail', 'farm', 'bakery', 'pharmacy', 'school'])); expect(names).not.toContain('general')
  })
})

describe('the public Apps page matches the store', () => {
  it('filters and searches with the same rules, without an installed state', async () => {
    const { publicApps } = await import('@/app/landing/AppsPage')
    expect(ids(publicApps('all', ''))).toEqual(['crm', 'pos', 'inventory', 'invoices', 'expenses', 'finance'])
    expect(ids(publicApps('money', ''))).toEqual(['invoices', 'expenses', 'finance']); expect(ids(publicApps('stock', ''))).toEqual(['inventory']); expect(ids(publicApps('sell', ''))).toEqual(['crm', 'pos'])
    expect(publicApps('businesses', '')).toEqual([]); expect(publicApps('all', 'zzzz')).toEqual([]); expect(ids(publicApps('money', 'stock'))).toEqual([])
    expect(ids(publicApps('all', 'receipt'))).toContain('pos')
  })
  it('uses the same search words as the store for any app', async () => {
    const { appMatches } = await import('@/core/app-catalogue/storeLogic')
    const { publicApps } = await import('@/app/landing/AppsPage')
    for (const w of ['invoice', 'stock', 'quote', 'cash', 'lead']) expect(ids(publicApps('all', w))).toEqual(ids(STANDALONE_APPS.filter((a) => appMatches(a, w))))
  })
  it('sends every app to its own sign-in, so the workspace opens with only that app', async () => {
    const { startPath } = await import('@/core/app-catalogue/apps')
    expect(STANDALONE_APPS.map((a) => startPath(a))).toEqual(STANDALONE_APPS.map((a) => `/sign-in?app=${a.id}`))
  })
})
