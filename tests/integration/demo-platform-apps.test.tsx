import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { appsOn } from '@/core/app-catalogue/apps'
import { startWithApp } from '@/core/app-catalogue/startWithApp'
import { AppsCard } from '@/core/platform-admin/PlatformApps'
import { AppChips, industryName } from '@/core/platform-admin/platformUi'
import * as pl from '@/demo/demoPlatform'
import * as inv from '@/demo/demoInvoices'
import { demoCreateBusiness, demoDisableModule, demoEnableModule, demoSetStartedWithApp, demoSignIn, demoSignOut, getDemoState } from '@/demo/demoStore'
import { demoCreateCustomer, getTrade } from '@/demo/demoTrade'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
const workspace = (name: string) => demoCreateBusiness(name, 'general')
const detail = (b: string) => { as('platform@demo.test'); const d = pl.demoPlatformBusiness(b); as('owner@demo.test'); return d }

beforeAll(() => { as('owner@demo.test') })

describe('the demo console shows apps, like the database one', () => {
  it('records the starting app once, replaces the setup noise with a start entry, and lists only the app that is on', async () => {
    const b = workspace('Acme CRM')
    expect(await startWithApp(b, 'crm')).toBeNull()
    const d = detail(b)
    expect(d.startedWithApp).toBe('crm'); expect(d.apps).toEqual(['crm'])
    expect(d.appEvents.map((e) => `${e.module}:${e.action}`)).toEqual(['customers:start'])
    expect(demoSetStartedWithApp(b, 'pos')).toMatch(/already has a starting app/)
  })

  it('refuses the starting app for other people, other kinds of business and unknown apps', () => {
    const b = workspace('Other')
    expect(demoSetStartedWithApp(b, 'nope')).toMatch(/unknown app/)
    const shop = demoCreateBusiness('Shop', 'retail')
    expect(demoSetStartedWithApp(shop, 'crm')).toMatch(/only a Business apps workspace/)
    as('viewer@demo.test'); expect(demoSetStartedWithApp(b, 'crm')).toMatch(/permission denied/); as('owner@demo.test')
  })

  it('keeps a history of later changes with who made them, newest first', async () => {
    const b = workspace('Growing')
    await startWithApp(b, 'crm')
    // setup is over: age the workspace so changes now count as changes
    const st = getDemoState(); st.businesses.find((x) => x.id === b)!.createdAt = new Date(Date.now() - 600000).toISOString()
    expect(demoEnableModule(b, 'invoices')).toBeNull(); expect(demoDisableModule(b, 'invoices')).toBeNull(); expect(demoEnableModule(b, 'expenses')).toBeNull()
    const d = detail(b)
    expect(d.appEvents.map((e) => `${e.module}:${e.action}`)).toEqual(['expenses:on', 'invoices:off', 'invoices:on', 'customers:start'])
    expect(d.appEvents[0].by).toBeTruthy(); expect(d.apps).toEqual(['crm', 'expenses'])
  })

  it('counts records and the latest use per app, and shows an app that is on but unused', async () => {
    const b = workspace('Busy')
    expect(demoCreateCustomer(b, 'Acme', '0800')).toBeNull()
    const c = getTrade().customers.find((x) => x.businessId === b)!.id
    expect(inv.demoSaveInvoice(b, { id: null, customerId: c, dueOn: null, lines: [{ description: 'J', quantity: 1, unitPrice: 10 }], discount: 0, taxPercent: 0, notes: '' })).toBeNull()
    const d = detail(b)
    expect(d.appActivity.crm.records).toBe(1); expect(d.appActivity.crm.lastAt).not.toBeNull(); expect(d.appActivity.invoices.records).toBe(1)
    expect(d.appActivity.expenses).toEqual({ records: 0, lastAt: null })
  })

  it('works out adoption per app: using, started, grew and active, for Business apps workspaces only', async () => {
    const a = workspace('Only CRM'); await startWithApp(a, 'crm')
    const g = workspace('Grew'); await startWithApp(g, 'crm'); demoEnableModule(g, 'invoices'); demoCreateCustomer(g, 'Used', '0801')
    as('platform@demo.test')
    const adoption = Object.fromEntries(pl.demoPlatformAppAdoption().map((x) => [x.app, x]))
    expect(Object.keys(adoption)).toEqual(['crm', 'pos', 'inventory', 'invoices', 'expenses', 'finance', 'calendar'])
    expect(adoption.crm.started).toBeGreaterThanOrEqual(2); expect(adoption.crm.grew).toBeGreaterThanOrEqual(1); expect(adoption.crm.active30d).toBeGreaterThanOrEqual(1)
    const before = JSON.stringify(adoption)
    as('owner@demo.test'); demoCreateBusiness('A Pharmacy', 'pharmacy'); as('platform@demo.test')
    expect(JSON.stringify(Object.fromEntries(pl.demoPlatformAppAdoption().map((x) => [x.app, x])))).toBe(before)
    as('support@demo.test'); expect(pl.demoPlatformAppAdoption().length).toBe(7)
    as('owner@demo.test'); expect(() => pl.demoPlatformAppAdoption()).toThrow(/permission denied/)
  })

  it('lists a workspace with its apps and starting app', async () => {
    const b = workspace('Listed'); await startWithApp(b, 'invoices')
    as('platform@demo.test')
    expect(pl.demoPlatformBusinesses().find((x) => x.id === b)).toMatchObject({ apps: ['invoices'], startedWithApp: 'invoices', industry: 'general' })
    as('owner@demo.test')
  })
})

describe('what the platform team reads', () => {
  it('calls a Business apps workspace an apps workspace, not an industry, and lists its apps', () => {
    expect(industryName('general')).toBe('Apps workspace'); expect(industryName('retail')).toBe('Retail & Supermarket')
    const html = renderToStaticMarkup(<AppChips apps={['crm', 'invoices']} startedWith="crm" />)
    expect(html).toContain('CRM (started)'); expect(html).toContain('Invoices'); expect(html).not.toContain('Invoices (started)')
  })

  it('shows the apps card: the starting app, what is on, what is used, and the history', () => {
    const d: pl.PBusinessDetail = {
      id: 'x', name: 'Acme', legalName: null, industry: 'general', status: 'active', createdAt: '2026-10-01T00:00:00Z', country: 'NG', currency: 'NGN', timezone: 'Africa/Lagos', owner: null, subscription: null, members: [],
      modules: [], activity: [], platformActions: [], startedWithApp: 'crm', apps: ['crm', 'invoices'],
      appActivity: { crm: { records: 12, lastAt: '2026-10-20T10:00:00Z' }, invoices: { records: 0, lastAt: null }, pos: { records: 0, lastAt: null }, inventory: { records: 0, lastAt: null }, expenses: { records: 0, lastAt: null }, finance: { records: 0, lastAt: null } },
      appEvents: [{ at: '2026-10-21T10:00:00Z', module: 'invoices', action: 'on', by: 'Ada' }, { at: '2026-10-01T00:00:00Z', module: 'customers', action: 'start', by: 'Ada' }],
    }
    const html = renderToStaticMarkup(<MemoryRouter><AppsCard b={d} /></MemoryRouter>)
    for (const t of ['Started with', 'DOA CRM', 'now uses 2 apps', 'Not used yet', 'switched on', 'was the starting app', 'by Ada', 'Reads the other apps']) expect(html).toContain(t)
  })

  it('knows the same apps as the module list does', () => {
    expect(appsOn(['sales', 'inventory', 'customers'])).toEqual(['crm', 'pos', 'inventory'])
    expect(appsOn(['sales'])).toEqual([]) // POS needs its product list too
  })
})
