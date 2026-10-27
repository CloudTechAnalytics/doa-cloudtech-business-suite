import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { usageLevel } from '@/core/subscriptions/usage'
import * as fin from '@/demo/demoFinance'
import * as inv from '@/demo/demoInvoices'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'
import { demoCreateCustomer, getTrade } from '@/demo/demoTrade'
import { demoUsage, demoUsageCheck, setDemoPlanLimits } from '@/demo/demoUsage'
import { schoolNavigation } from '@/industries/school/navigation'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let n = 0
const key = () => `dus-${n++}-abcdefgh`
const biz = () => { const b = demoCreateBusiness(`Co ${n++}`, 'general'); return b }
const customer = (b: string, name: string) => { const e = demoCreateCustomer(b, name, `08${n++}`); return e }
const line = [{ description: 'Job', quantity: 1, unitPrice: 100 }]
const newInvoice = (b: string, c: string) => inv.demoSaveInvoice(b, { id: null, customerId: c, dueOn: null, lines: line, discount: 0, taxPercent: 0, notes: '' })

beforeAll(() => { as('owner@demo.test') })
afterEach(() => setDemoPlanLimits('starter', {}))

describe('usage limits in the demo mirror', () => {
  it('have no limit on any plan until one is set, and nothing is blocked', () => {
    const b = biz()
    expect(demoUsage(b).map((r) => r.limit)).toEqual([null, null, null, null])
    expect(demoUsageCheck(b, 'customers')).toBeNull()
    expect(customer(b, 'A')).toBeNull(); expect(customer(b, 'B')).toBeNull()
  })

  it('stop a new customer at the limit with a message that says what to do, and count only this business', () => {
    setDemoPlanLimits('starter', { customers: 2 })
    const b = biz(); const other = biz()
    expect(customer(b, 'One')).toBeNull(); expect(customer(b, 'Two')).toBeNull()
    expect(customer(b, 'Three')).toMatch(/plan limit reached: your plan allows 2 customers/)
    expect(demoUsage(b).find((r) => r.key === 'customers')).toEqual({ key: 'customers', used: 2, limit: 2 })
    expect(customer(other, 'Elsewhere')).toBeNull()
  })

  it('count invoices a month, ignore cancelled ones, and leave existing invoices editable', () => {
    setDemoPlanLimits('starter', { invoices_per_month: 2 })
    const b = biz(); customer(b, 'Payer'); const c = getTrade().customers.find((x) => x.businessId === b)!.id
    expect(newInvoice(b, c)).toBeNull(); expect(newInvoice(b, c)).toBeNull()
    expect(newInvoice(b, c)).toMatch(/plan limit reached: your plan allows 2 invoices a month/)
    const first = inv.demoInvoiceList(b)[0]
    expect(inv.demoCancelInvoice(b, first.id, 'Made by mistake')).toBeNull()
    expect(newInvoice(b, c)).toBeNull() // the cancelled one no longer counts
    const draft = inv.demoInvoiceList(b).find((i) => i.status === 'draft')!
    expect(inv.demoSaveInvoice(b, { id: draft.id, customerId: c, dueOn: null, lines: [{ description: 'Edited', quantity: 1, unitPrice: 5 }], discount: 0, taxPercent: 0, notes: '' })).toBeNull()
  })

  it('count expenses a month', () => {
    setDemoPlanLimits('starter', { expenses_per_month: 1 })
    const b = biz()
    const v = { category: 'rent' as const, amount: 100, method: 'cash', description: 'Office rent', date: new Date().toISOString().slice(0, 10), supplierId: null, batchId: null }
    expect(fin.demoRecordExpense(b, v, key())).toMatchObject({ error: null })
    expect(String(fin.demoRecordExpense(b, v, key()).error)).toMatch(/plan limit reached: your plan allows 1 expenses a month/)
  })

  it('are lifted by setting no limit, and never remove what exists', () => {
    setDemoPlanLimits('starter', { customers: 1 })
    const b = biz()
    expect(customer(b, 'One')).toBeNull(); expect(customer(b, 'Two')).toMatch(/plan limit reached/)
    setDemoPlanLimits('starter', {})
    expect(customer(b, 'Two')).toBeNull(); expect(getTrade().customers.filter((c) => c.businessId === b)).toHaveLength(2)
    setDemoPlanLimits('starter', { customers: 1 })
    expect(getTrade().customers.filter((c) => c.businessId === b)).toHaveLength(2) // lowered below what exists: nothing is removed
    expect(customer(b, 'Three')).toMatch(/plan limit reached/)
  })
})

describe('what people are told', () => {
  it('reads each use of a limit as unlimited, ok, near (80%) or full', () => {
    expect([usageLevel({ used: 99, limit: null }), usageLevel({ used: 7, limit: 10 }), usageLevel({ used: 8, limit: 10 }), usageLevel({ used: 10, limit: 10 })]).toEqual(['unlimited', 'ok', 'near', 'full'])
  })
})

describe('tidy: the school home no longer shows two Staff and two Settings tiles', () => {
  it('names the school sections apart from the platform ones', () => {
    const labels = schoolNavigation.map((s) => s.label)
    expect(labels).toContain('Teachers & staff'); expect(labels).toContain('School settings')
    expect(labels).not.toContain('Staff'); expect(labels).not.toContain('Settings')
  })
})
