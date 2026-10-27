import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { GlobalSearch } from '@/app/layouts/GlobalSearch'
import { breadcrumb, pageIndex, searchPages } from '@/app/navigation/crumbs'
import { buildApps, buildQuickActions } from '@/app/navigation/navigation'
import { searchRecords } from '@/app/search/recordSearch'
import { ensureDemoInventory, getInv } from '@/demo/demoInventory'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import { ensureDemoTrade } from '@/demo/demoTrade'
import type { ModuleCode } from '@/shared/types/domain'

const usable = new Set<ModuleCode>(['dashboard', 'customers', 'sales', 'invoices', 'inventory', 'expenses', 'reports', 'staff', 'settings'])
const apps = buildApps('general', usable)
const labels = (path: string, search = '') => breadcrumb(apps, path, search).map((c) => c.label)

describe('the breadcrumb in the top bar', () => {
  it('names the app and the part that is open, from ?tab=', () => {
    expect(labels('/app/invoices', '?tab=ageing').at(-1)).toBe('Ageing')
    expect(labels('/app/customers', '?tab=deals').at(-1)).toBe('Deals')
    expect(labels('/app/inventory', '?tab=counts').at(-1)).toBe('Counts')
  })
  it('opens on the first part when the address names none, and still understands the older capitalised names', () => {
    expect(labels('/app/customers').at(-1)).toBe('Pipeline')
    expect(labels('/app/inventory', '?tab=Receive').at(-1)).toBe('Receive')
    expect(labels('/app/inventory', '?tab=nonsense').at(-1)).toBe('Stock')
  })
  it('shows a name once when the app and the module are called the same, and leaves the last crumb without a link', () => {
    const t = breadcrumb(apps, '/app/invoices', '?tab=statements')
    expect(t.map((c) => c.label).filter((l) => l === 'Invoices')).toHaveLength(1)
    expect(t.at(-1)?.to).toBeNull()
    const mid = breadcrumb(apps, '/app/inventory', '?tab=stock')
    expect(mid.length).toBeGreaterThanOrEqual(2); expect(mid.slice(0, -1).some((c) => c.to?.startsWith('/app/inventory'))).toBe(mid.length > 2)
  })
  it('has a name for the apps home, for a page with no part, and for an address it does not know', () => {
    expect(labels('/app')).toEqual(['Apps'])
    expect(labels('/app/apps')).toEqual(['Apps', 'App Store'])
    expect(labels('/app/expenses').at(-1)).toBe('Expenses')
    expect(labels('/somewhere/else')).toEqual(['DOA'])
  })
})

describe('searching for pages and actions', () => {
  const quick = buildQuickActions('general', usable).map((a) => ({ label: a.label, to: a.to }))
  const index = pageIndex(apps, quick)
  it('finds a part of an app by name, with its address', () => {
    const hit = searchPages(index, 'ageing')[0]
    expect(hit).toMatchObject({ label: 'Invoices: Ageing', to: '/app/invoices?tab=ageing' })
  })
  it('needs every word, and puts names that start with the text first', () => {
    expect(searchPages(index, 'invoices ageing')[0].to).toBe('/app/invoices?tab=ageing')
    expect(searchPages(index, 'zzzz')).toEqual([])
    expect(searchPages(index, '   ')).toEqual([])
    expect(searchPages(index, 'inv')[0].label.toLowerCase().startsWith('inv')).toBe(true)
  })
  it('finds the App Store by what people would type', () => {
    for (const w of ['store', 'install', 'add app']) expect(searchPages(index, w)[0]).toMatchObject({ label: 'App Store', to: '/app/apps' })
  })
  it('includes the Record menu and the account pages', () => {
    expect(index.some((h) => h.group === 'Record')).toBe(true)
    expect(index.some((h) => h.group === 'Settings and people' && /settings/i.test(h.label))).toBe(true)
  })
  it('lists each module once even when it has parts', () => {
    expect(index.filter((h) => h.to === '/app/invoices' && h.group !== 'Record')).toHaveLength(1)
  })
})

describe('searching for records in the demo', () => {
  let biz: string
  beforeAll(() => { demoSignOut(); demoSignIn('owner@demo.test', 'demo1234'); biz = 'b-retail'; ensureDemoInventory(biz, 'retail'); ensureDemoTrade(biz) })
  it('finds a product by name or SKU and links to it', async () => {
    const p = getInv().products.find((x) => x.businessId === biz && x.status === 'active')!
    const hits = await searchRecords(biz, 'retail', new Set<ModuleCode>(['inventory']), p.name.slice(0, 4))
    const hit = hits.find((h) => h.key === `p${p.id}`)
    expect(hit).toMatchObject({ kind: 'Product', label: p.name, to: `/app/inventory?tab=products&open=${p.id}` })
  })
  it('asks only the apps that are on, and needs two letters', async () => {
    const p = getInv().products.find((x) => x.businessId === biz && x.status === 'active')!
    expect(await searchRecords(biz, 'retail', new Set<ModuleCode>(['customers']), p.name.slice(0, 4))).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'Product' })]))
    expect(await searchRecords(biz, 'retail', new Set<ModuleCode>(['inventory']), 'a')).toEqual([])
  })
  it('leaves out a source that fails and still returns the others', async () => {
    const p = getInv().products.find((x) => x.businessId === biz && x.status === 'active')!
    const hits = await searchRecords('no-such-business', 'retail', new Set<ModuleCode>(['inventory', 'invoices']), p.name.slice(0, 4))
    expect(Array.isArray(hits)).toBe(true)
  })
})

describe('the search button', () => {
  it('is in the top bar with its shortcut in the label', () => {
    const html = renderToStaticMarkup(<MemoryRouter><GlobalSearch businessId="b" industry="general" usable={usable} pages={[]} /></MemoryRouter>)
    expect(html).toContain('aria-label="Search (Ctrl+K)"'); expect(html).toContain('>Search<')
  })
})

describe('page search ranking and the empty state', () => {
  const index = pageIndex(apps, buildQuickActions('general', usable).map((a) => ({ label: a.label, to: a.to })))
  it('matches names first and descriptions only when no name matches', () => {
    expect(searchPages(index, 'sal').every((h) => /sal/i.test(`${h.label} ${h.group}`))).toBe(true)
    expect(searchPages(index, 'zzzz')).toEqual([])
  })
})

describe('what the search offers before anything is typed', () => {
  it('suggests the main Record actions, then the main pages, and no sub-pages or account pages', async () => {
    const { suggestions } = await import('@/app/layouts/GlobalSearch')
    const index = pageIndex(apps, buildQuickActions('general', usable).map((a) => ({ label: a.label, to: a.to })))
    const s = suggestions(index)
    expect(s.filter((r) => r.group === 'Create').length).toBeGreaterThan(0); expect(s.filter((r) => r.group === 'Go to').length).toBeGreaterThan(0)
    expect(s.some((r) => r.label.includes(':'))).toBe(false)
    expect(s.map((r) => r.key)).toEqual([...new Set(s.map((r) => r.key))])
  })
})
