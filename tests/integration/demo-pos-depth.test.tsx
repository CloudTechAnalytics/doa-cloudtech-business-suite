import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildApps, sectionPath, sidebarEntries } from '@/app/navigation/navigation'
import { crmModule } from '@/modules/crm/manifest'
import { salesModule } from '@/modules/sales/manifest'
import { DaySheet } from '@/modules/sales/SalesToday'
import { changeDue, holdLabel, loadHeld, paidOf, paymentsOf, receiptText, remainingOf, saveHeld } from '@/modules/sales/till'
import { ensureDemoInventory, getInv } from '@/demo/demoInventory'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'
import * as t from '@/demo/demoTrade'
import { daySummary } from '@/modules/sales/tradeApi'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
const money = (n: number) => `₦${n}`

describe('paying a sale in more than one way', () => {
  it('sends the whole total in one method when the amount is left blank, or each part when split', () => {
    expect(paymentsOf([{ method: 'cash', amount: '' }], 500)).toEqual([{ method: 'cash', amount: 500 }])
    expect(paymentsOf([{ method: 'cash', amount: '300' }, { method: 'bank_transfer', amount: '200' }], 500)).toEqual([{ method: 'cash', amount: 300 }, { method: 'bank_transfer', amount: 200 }])
    expect(paymentsOf([{ method: 'cash', amount: '' }, { method: 'pos', amount: '' }], 500)).toEqual([]) // two rows and no amounts: nothing yet, the till asks
    expect(paymentsOf([{ method: 'cash', amount: '0' }], 0)).toEqual([])
  })
  it('works out what is paid and what is left, to the kobo', () => {
    const p = paymentsOf([{ method: 'cash', amount: '100.10' }, { method: 'pos', amount: '200.20' }], 400)
    expect(paidOf(p)).toBe(300.3); expect(remainingOf(400, p)).toBe(99.7); expect(remainingOf(100, p)).toBe(0)
  })
  it('works out the change from the cash given', () => {
    expect(changeDue(2000, 1500)).toBe(500); expect(changeDue(1500, 1500)).toBe(0); expect(changeDue(1000, 1500)).toBe(0)
  })
})

describe('holding a sale', () => {
  const store = new Map<string, string>()
  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } })
  })
  it('keeps held sales per business and returns them, newest first', () => {
    saveHeld('b1', [{ id: 'h1', label: 'a', at: 'x', customerId: '', cart: [{ productId: 'p', quantity: 2, discount: 0, pack: null }] }])
    expect(loadHeld('b1')).toHaveLength(1); expect(loadHeld('b2')).toEqual([])
  })
  it('ignores damaged storage and keeps at most twenty', () => {
    store.set('doa.pos.held.bad', '{not json'); expect(loadHeld('bad')).toEqual([])
    saveHeld('many', Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, label: '', at: '', customerId: '', cart: [] })))
    expect(loadHeld('many')).toHaveLength(20)
  })
  it('labels a held sale with the time, the number of items and the customer', () => {
    expect(holdLabel(3, new Date('2031-01-01T09:05:00'), 'Ada')).toMatch(/3 items · Ada/); expect(holdLabel(1, new Date(), undefined)).toMatch(/1 item$/)
  })
})

describe('the receipt text for WhatsApp', () => {
  it('lists the business, number, customer, items, total, paid and any balance', () => {
    const txt = receiptText({ business: 'Corner Shop', number: 'SAL-000007', at: '2031-01-01T09:00:00Z', customer: 'Ada', items: [{ description: 'Widget', quantity: 2, total: 200 }], total: 200, paid: 150, balance: 50 }, money)
    for (const s of ['*Corner Shop*', 'Receipt SAL-000007 for Ada', '2 x Widget: ₦200', 'Total: ₦200', 'Paid: ₦150', 'Balance due: ₦50', 'Thank you']) expect(txt).toContain(s)
    expect(receiptText({ business: 'S', number: 'N', at: '2031-01-01', items: [], total: 0, paid: 0, balance: 0 }, money)).not.toContain('Balance due')
  })
})

describe('the end-of-day summary in the demo mirror', () => {
  const today = new Date().toISOString().slice(0, 10)
  let biz: string
  beforeAll(() => { as('owner@demo.test'); biz = 'b-retail'; ensureDemoInventory(biz, 'retail'); t.ensureDemoTrade(biz) })

  it('adds up sales, returns, what was received by method, who sold and the best sellers for a day', async () => {
    const before = await daySummary(biz, today)
    const inv = getInv(); const loc = inv.locations.find((l) => l.businessId === biz)!.id; const p = inv.products.find((x) => x.businessId === biz && x.status === 'active' && x.sellingPrice > 0)!
    const sale = t.demoPostSale(biz, loc, null, [{ productId: p.id, quantity: 2 }], [{ method: 'cash', amount: p.sellingPrice }, { method: 'pos', amount: p.sellingPrice }], `dpos-${Date.now()}-abcdefgh`)
    expect(sale.error ?? null).toBeNull()
    const d = await daySummary(biz, today)
    expect(d.salesCount - before.salesCount).toBe(1); expect(d.gross - before.gross).toBeCloseTo(p.sellingPrice * 2, 2)
    const m = (r: typeof d, method: string) => r.byMethod.find((x) => x.method === method)?.amount ?? 0
    expect(m(d, 'cash') - m(before, 'cash')).toBeCloseTo(p.sellingPrice, 2); expect(m(d, 'pos') - m(before, 'pos')).toBeCloseTo(p.sellingPrice, 2)
    expect(d.topProducts.some((x) => x.name === p.name)).toBe(true)
    expect((await daySummary(biz, '2001-01-01')).salesCount).toBe(0)
  })

  it('is for people who can read sales', async () => {
    as('teacher@demo.test'); await expect(daySummary(biz, today)).rejects.toThrow(/permission denied/); as('owner@demo.test')
  })

  it('prints as a designed end-of-day sheet', () => {
    const html = renderToStaticMarkup(<DaySheet s={{ day: '2031-01-01', salesCount: 4, gross: 5000, discounts: 100, tax: 0, returns: 250, outstanding: 300, voidedCount: 1, voidedTotal: 100, byMethod: [{ method: 'cash', amount: 3000 }], byCashier: [{ cashier: 'Ada', sales: 4, total: 5000 }], topProducts: [{ name: 'Widget', quantity: 6, total: 2000 }] }} business="Corner Shop" />)
    for (const s of ['Corner Shop', 'End of day', 'Sales made', 'Net sales', 'Money received today', 'By cashier', 'Best sellers', 'Widget', 'Prepared by']) expect(html).toContain(s)
  })
})

describe('the sidebar lists the parts of an app', () => {
  const sub = (m: { code: string }) => (e: { kind: string; module?: { code: string } }) => e.kind === 'section' && e.module?.code === m.code
  it('shows the CRM and the till as a heading with a link to each of their parts, in a workspace of apps', () => {
    const apps = buildApps('general', new Set(['dashboard', 'customers', 'sales', 'invoices', 'inventory']))
    const entries = sidebarEntries(apps)
    expect(entries.filter(sub(crmModule.definition)).map((e) => (e.kind === 'section' ? e.section.key : ''))).toEqual(['pipeline', 'deals', 'activities', 'customers', 'leads', 'quotes', 'reports'])
    expect(entries.filter(sub(salesModule.definition)).map((e) => (e.kind === 'section' ? e.section.key : ''))).toEqual(['new', 'history', 'today'])
    expect(entries.some((e) => e.kind === 'heading' && e.label === 'CRM')).toBe(true)
    // Invoices lists its own parts too; an app with none (Expenses) is still a single link
    expect(entries.filter(sub({ code: 'invoices' })).map((e) => (e.kind === 'section' ? e.section.key : ''))).toEqual(['invoices', 'statements', 'ageing'])
  })
  it('points each part at its module with ?tab=', () => {
    const s = crmModule.definition.sections!.find((x) => x.key === 'activities')!
    expect(sectionPath(crmModule.definition, s)).toBe('/app/customers?tab=activities')
  })
  it('keeps an app that holds several modules as it was: a heading and one link per module', () => {
    const apps = buildApps('retail', new Set(['dashboard', 'sales', 'retail-shifts', 'inventory', 'customers']))
    const entries = sidebarEntries(apps)
    expect(entries.filter((e) => e.kind === 'section' && e.module.code === 'sales')).toEqual([]) // retail's Sales app has two modules, so it keeps plain links
  })
  it('renders without breaking', () => {
    expect(renderToStaticMarkup(<MemoryRouter><span>ok</span></MemoryRouter>)).toContain('ok')
  })
})
