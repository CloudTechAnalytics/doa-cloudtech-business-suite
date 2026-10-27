import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { STANDALONE_APPS, appState, canSwitchOff } from '@/core/app-catalogue/apps'
import { getIndustry } from '@/core/industry-registry'
import { InvoiceSheet } from '@/modules/invoices/InvoicesPage'
import type { InvoiceRow } from '@/modules/invoices/invoicesApi'
import * as crm from '@/demo/demoCrm'
import * as fin from '@/demo/demoFinance'
import * as inv from '@/demo/demoInvoices'
import { startWithApp } from '@/core/app-catalogue/startWithApp'
import { demoCreateBusiness, demoModuleStatuses, demoSignIn, demoSignOut } from '@/demo/demoStore'
import { demoCreateCustomer, getTrade } from '@/demo/demoTrade'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let biz: string, customer: string
let n = 0
const key = () => `dinv-${n++}-abcdefgh`
const line = (description: string, quantity: number, unitPrice: number) => ({ description, quantity, unitPrice })
const save = (o: Partial<Parameters<typeof inv.demoSaveInvoice>[1]> = {}) => inv.demoSaveInvoice(biz, { id: null, customerId: customer, dueOn: null, lines: [line('Consulting', 2, 5000)], discount: 0, taxPercent: 0, notes: '', ...o })
const last = () => inv.demoInvoiceList(biz).at(-1)!
const sent = () => { expect(save()).toBeNull(); const id = last().id; expect(inv.demoSendInvoice(biz, id)).toBeNull(); return id }
const get = (id: string) => inv.demoInvoiceList(biz).find((i) => i.id === id)!

beforeAll(async () => {
  as('owner@demo.test')
  biz = demoCreateBusiness('Consulting Co', 'general')
  await getIndustry('general').afterCreate?.(biz, {})
  expect(demoCreateCustomer(biz, 'Acme Ltd', '0800')).toBeNull()
  customer = getTrade().customers.find((c) => c.businessId === biz && c.name === 'Acme Ltd')!.id
})

describe('invoices in the demo mirror', () => {
  it('are numbered and add up like the database', () => {
    expect(save({ lines: [line('Design', 2, 1500.5), line('Hosting', 1, 999.99)], discount: 100, taxPercent: 7.5 })).toBeNull()
    expect(last()).toMatchObject({ number: 'INV-000001', status: 'draft', subtotal: 4000.99, taxAmount: 292.57, total: 4193.56 })
    expect(save()).toBeNull()
    expect(last().number).toBe('INV-000002')
  })

  it('check what they are given', () => {
    expect(save({ customerId: '' })).toMatch(/choose the customer/)
    expect(save({ lines: [] })).toMatch(/at least one line/)
    expect(save({ lines: [line('', 1, 1)] })).toMatch(/needs a description/)
    expect(save({ lines: [line('A', 0, 1)] })).toMatch(/quantity above zero/)
    expect(save({ discount: 999999 })).toMatch(/discount cannot be more/)
    expect(save({ taxPercent: 101 })).toMatch(/tax rate/)
    expect(save({ dueOn: '2000-01-01' })).toMatch(/due date cannot be before/)
  })

  it('can be changed as a draft and not after sending', () => {
    const id = sent()
    expect(inv.demoSaveInvoice(biz, { id, customerId: customer, dueOn: null, lines: [line('x', 1, 1)], discount: 0, taxPercent: 0, notes: '' })).toMatch(/can no longer be changed/)
    expect(inv.demoSendInvoice(biz, id)).toMatch(/only a draft/)
  })

  it('are for people who manage invoices', () => {
    as('viewer@demo.test')
    expect(save()).toMatch(/permission denied/)
    as('owner@demo.test')
  })
})

describe('payments in the demo mirror', () => {
  const payIt = (id: string, amount: number, k = key(), method = 'bank_transfer') => inv.demoRecordInvoicePayment(biz, id, { amount, method, paidOn: null, reference: '' }, k)

  it('move an invoice to part paid and paid, and cannot exceed the balance', () => {
    expect(save({ lines: [line('Work', 1, 1000)] })).toBeNull(); const id = last().id; inv.demoSendInvoice(biz, id)
    expect(payIt(id, 400)).toBeNull(); expect(get(id)).toMatchObject({ status: 'partially_paid', amountPaid: 400 })
    expect(payIt(id, 700)).toMatch(/more than the balance/)
    expect(payIt(id, 600)).toBeNull(); expect(get(id)).toMatchObject({ status: 'paid', amountPaid: 1000 })
    expect(payIt(id, 1)).toMatch(/sent invoice that is not fully paid/)
  })

  it('are booked once for the same key', () => {
    expect(save({ lines: [line('Work', 1, 1000)] })).toBeNull(); const id = last().id; inv.demoSendInvoice(biz, id)
    const k = key()
    expect(payIt(id, 300, k)).toBeNull(); expect(payIt(id, 300, k)).toBeNull()
    expect(inv.demoInvoicePayments(biz, id)).toHaveLength(1)
    expect(payIt(id, 10, 'short')).toMatch(/idempotency key/)
    expect(payIt(id, 0)).toMatch(/enter the amount/); expect(payIt(id, 10, key(), 'bitcoin')).toMatch(/choose how it was paid/)
  })

  it('are reversed, and an invoice with live payments cannot be cancelled', () => {
    const id = sent(); expect(payIt(id, 100)).toBeNull()
    const p = inv.demoInvoicePayments(biz, id)[0]
    expect(inv.demoCancelInvoice(biz, id, 'left')).toMatch(/reverse the payments/)
    expect(inv.demoReverseInvoicePayment(biz, p.id, ' ')).toMatch(/reason is required/)
    expect(inv.demoReverseInvoicePayment(biz, p.id, 'Entered twice')).toBeNull(); expect(get(id)).toMatchObject({ status: 'sent', amountPaid: 0 })
    expect(inv.demoReverseInvoicePayment(biz, p.id, 'again')).toMatch(/already reversed/)
    expect(inv.demoCancelInvoice(biz, id, 'Customer left')).toBeNull(); expect(get(id).status).toBe('cancelled')
  })
})

describe('quotes become invoices in the demo mirror', () => {
  it('once, from an accepted quote for a customer', () => {
    crm.ensureDemoCrm(biz)
    expect(crm.demoSaveQuote(biz, { id: null, dealId: null, customerId: customer, leadId: null, validUntil: null, lines: [{ description: 'Service', quantity: 2, unitPrice: 500 }], discount: 50, notes: 'Thanks' })).toBeNull()
    const q = crm.demoQuotes(biz).at(-1)!
    expect(inv.demoInvoiceFromQuote(biz, q.id)).toMatch(/only an accepted quote/)
    crm.demoSetQuoteStatus(biz, q.id, 'sent'); crm.demoSetQuoteStatus(biz, q.id, 'accepted')
    expect(inv.demoInvoiceFromQuote(biz, q.id)).toBeNull()
    expect(last()).toMatchObject({ quoteId: q.id, status: 'draft', subtotal: 1000, total: 950, notes: 'Thanks' })
    expect(inv.demoInvoiceFromQuote(biz, q.id)).toMatch(/already been invoiced/)
  })

  it('not for a lead that is not yet a customer', () => {
    const lead = crm.getCrm().leads.find((l) => l.businessId === biz)!.id
    expect(crm.demoSaveQuote(biz, { id: null, dealId: null, customerId: null, leadId: lead, validUntil: null, lines: [{ description: 'S', quantity: 1, unitPrice: 1 }], discount: 0, notes: '' })).toBeNull()
    const q = crm.demoQuotes(biz).at(-1)!
    crm.demoSetQuoteStatus(biz, q.id, 'sent'); crm.demoSetQuoteStatus(biz, q.id, 'accepted')
    expect(inv.demoInvoiceFromQuote(biz, q.id)).toMatch(/convert the lead/)
  })
})

describe('Finance reads invoices from the same ledgers', () => {
  it('shows a payment once in the cashbook and unpaid balances as receivables, and drops them when reversed', () => {
    const b = demoCreateBusiness('Finance Co', 'general')
    const c = (demoCreateCustomer(b, 'Payer', '0801'), getTrade().customers.find((x) => x.businessId === b)!.id)
    const mk = (price: number) => { inv.demoSaveInvoice(b, { id: null, customerId: c, dueOn: null, lines: [line('Job', 1, price)], discount: 0, taxPercent: 0, notes: '' }); const i = inv.demoInvoiceList(b).at(-1)!; inv.demoSendInvoice(b, i.id); return i.id }
    const a = mk(1000); mk(500)
    expect(inv.demoRecordInvoicePayment(b, a, { amount: 400, method: 'cash', paidOn: null, reference: '' }, key())).toBeNull()
    const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10); const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    expect(fin.demoCashbook(b).map((e) => [e.kind, e.direction, e.amount, e.reference])).toEqual([['invoice_receipt', 'in', 400, 'INV-000001']])
    expect(fin.demoReceivables(b).map((r) => [r.source, r.balanceDue]).sort()).toEqual([['invoice', 500], ['invoice', 600]])
    expect(fin.demoReportSummary(b, from, to)).toMatchObject({ cashIn: 400, receivablesOpen: 1100, invoicedTotal: 1500 })
    inv.demoReverseInvoicePayment(b, inv.demoInvoicePayments(b, a)[0].id, 'Entered twice')
    expect(fin.demoReportSummary(b, from, to)).toMatchObject({ cashIn: 0, receivablesOpen: 1500 })
  })
})

describe('the printable invoice', () => {
  it('shows the business, number, customer, lines, tax, total, what was paid and the balance', () => {
    const i = { ...get(inv.demoInvoiceList(biz)[0].id), customer: 'Acme Ltd', balance: 100 } as InvoiceRow
    const html = renderToStaticMarkup(<InvoiceSheet invoice={{ ...i, taxPercent: 7.5, amountPaid: 50, balance: 4143.56 }} business="Consulting Co" />)
    for (const text of ['Consulting Co', 'INV-000001', 'Acme Ltd', 'Design', 'Tax (7.5%)', 'Total', 'Paid', 'Balance due']) expect(html).toContain(text)
  })
})

describe('the App Library', () => {
  it('lists six standalone apps that map to real modules', () => {
    expect(STANDALONE_APPS.map((a) => a.id)).toEqual(['crm', 'pos', 'inventory', 'invoices', 'expenses', 'finance', 'calendar'])
    expect([...new Set(STANDALONE_APPS.flatMap((a) => a.modules))].sort()).toEqual(['calendar', 'customers', 'expenses', 'inventory', 'invoices', 'reports', 'sales'])
    expect(STANDALONE_APPS.find((a) => a.id === 'pos')!.modules).toEqual(['sales', 'inventory']) // POS carries its product list
  })

  it('shows every app as on in a Business apps workspace, and lets each be switched off', () => {
    const st = demoModuleStatuses(biz)
    for (const a of STANDALONE_APPS) { expect(appState(a, st), a.id).toBe('active'); expect(canSwitchOff(a, st), a.id).toBe(a.id !== 'inventory') } // POS needs the Inventory module for its products
  })

  it('offers Invoices as an app that can be switched on in a shop, and shows a school has no standalone apps it did not already have', () => {
    const shop = demoCreateBusiness('Corner Shop', 'retail')
    const st = demoModuleStatuses(shop)
    expect(appState(STANDALONE_APPS.find((a) => a.id === 'invoices')!, st)).toBe('available')
    expect(appState(STANDALONE_APPS.find((a) => a.id === 'pos')!, st)).toBe('active')
    expect(canSwitchOff(STANDALONE_APPS.find((a) => a.id === 'pos')!, st)).toBe(false) // the shop requires selling
    const school = demoCreateBusiness('Bright School', 'school')
    const ss = demoModuleStatuses(school)
    expect(appState(STANDALONE_APPS.find((a) => a.id === 'invoices')!, ss)).toBe('unavailable')
    expect(appState(STANDALONE_APPS.find((a) => a.id === 'pos')!, ss)).toBe('unavailable')
  })
})

describe('starting with one app', () => {
  const on = (b: string) => demoModuleStatuses(b).filter((s) => s.enabled && !s.isCore).map((s) => s.code).sort()
  const stateOf = (b: string) => Object.fromEntries(STANDALONE_APPS.map((a) => [a.id, appState(a, demoModuleStatuses(b))]))

  it('Invoices alone: only Invoices is on, and the others are one click away', async () => {
    const b = demoCreateBusiness('Freelance Co', 'general')
    expect(await startWithApp(b, 'invoices')).toBeNull()
    expect(on(b)).toEqual(['invoices'])
    expect(stateOf(b)).toEqual({ crm: 'available', pos: 'available', inventory: 'available', invoices: 'active', expenses: 'available', finance: 'available', calendar: 'available' })
  })

  it('POS alone: Sales and its product list, nothing else', async () => {
    const b = demoCreateBusiness('Little Shop', 'general')
    expect(await startWithApp(b, 'pos')).toBeNull()
    expect(on(b)).toEqual(['inventory', 'sales'])
    expect(stateOf(b)).toMatchObject({ pos: 'active', crm: 'available', invoices: 'available', expenses: 'available' })
  })

  it('CRM alone, and an unknown app leaves everything on', async () => {
    const b = demoCreateBusiness('Agency', 'general')
    expect(await startWithApp(b, 'crm')).toBeNull(); expect(on(b)).toEqual(['customers'])
    const all = demoCreateBusiness('Everything', 'general')
    expect(await startWithApp(all, 'nope')).toBeNull(); expect(on(all)).toEqual(['calendar', 'customers', 'expenses', 'inventory', 'invoices', 'purchases', 'reports', 'sales', 'suppliers'])
  })

  it('an app that another app needs cannot be switched off while that app is on', async () => {
    const b = demoCreateBusiness('Shop', 'general')
    await startWithApp(b, 'pos')
    const st = demoModuleStatuses(b)
    expect(canSwitchOff(STANDALONE_APPS.find((a) => a.id === 'inventory')!, st)).toBe(false) // POS needs its products
    expect(canSwitchOff(STANDALONE_APPS.find((a) => a.id === 'pos')!, st)).toBe(true)
  })

  it('Invoices can list and add customers without the CRM app, and does not duplicate them', async () => {
    const b = demoCreateBusiness('Freelance 2', 'general')
    await startWithApp(b, 'invoices')
    const a = inv.demoInvoiceAddCustomer(b, { name: 'Zed Ltd', phone: '0803', email: 'zed@example.com' })
    expect(a.error).toBeNull()
    expect(inv.demoInvoiceCustomers(b).map((c) => c.name)).toEqual(['Zed Ltd'])
    expect(inv.demoInvoiceAddCustomer(b, { name: 'Zed again', phone: '', email: 'ZED@example.com' }).id).toBe(a.id)
    expect(inv.demoInvoiceAddCustomer(b, { name: ' ', phone: '', email: '' }).error).toMatch(/enter the customer name/)
    expect(inv.demoSaveInvoice(b, { id: null, customerId: a.id!, dueOn: null, lines: [{ description: 'Job', quantity: 1, unitPrice: 100 }], discount: 0, taxPercent: 0, notes: '' })).toBeNull()
    as('viewer@demo.test'); expect(inv.demoInvoiceAddCustomer(b, { name: 'X', phone: '', email: '' }).error).toMatch(/permission denied/); as('owner@demo.test')
  })
})
