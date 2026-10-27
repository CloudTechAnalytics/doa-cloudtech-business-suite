import { beforeAll, describe, expect, it } from 'vitest'
import { buildApps, sidebarEntries } from '@/app/navigation/navigation'
import { getIndustry } from '@/core/industry-registry'
import * as fin from '@/demo/demoFinance'
import * as inv from '@/demo/demoInvoices'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'
import { demoCreateCustomer, getTrade } from '@/demo/demoTrade'
import { cashFlow } from '@/modules/finance/financeApi'
import { cashFlowExport, flowLabel, reconciles } from '@/modules/finance/financeLogic'
import { reportsModule } from '@/modules/reporting/manifest'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let biz: string, customer: string
let n = 0
const key = () => `dfin-${Date.now()}-${n++}-abcdefgh`
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
const ahead = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const spend = (category: string, amount: number, date: string, method = 'cash') => expectOk(fin.demoRecordExpense(biz, { category, amount, method, description: `Spend ${category}`, date, supplierId: null, batchId: null }, key()).error)
const expectOk = (e: string | null) => expect(e).toBeNull()
const invoice = (total: number, due: string | null) => {
  expectOk(inv.demoSaveInvoice(biz, { id: null, customerId: customer, dueOn: due, lines: [{ description: 'Work', quantity: 1, unitPrice: total }], discount: 0, taxPercent: 0, notes: '' }))
  const id = inv.demoInvoiceList(biz).at(-1)!.id; expectOk(inv.demoSendInvoice(biz, id)); return id
}
const received = (id: string, amount: number, paidOn: string, method = 'bank_transfer') => expectOk(inv.demoRecordInvoicePayment(biz, id, { amount, method, paidOn, reference: '' }, key()))

beforeAll(async () => {
  as('owner@demo.test')
  biz = demoCreateBusiness('Consulting Co', 'general'); await getIndustry('general').afterCreate?.(biz, {})
  expect(demoCreateCustomer(biz, 'Acme Ltd', '0800')).toBeNull()
  customer = getTrade().customers.find((c) => c.businessId === biz && c.name === 'Acme Ltd')!.id
  const early = invoice(5000, null); received(early, 5000, ago(45)); spend('rent', 1200, ago(44), 'bank_transfer')
  const a = invoice(3000, ahead(10)); received(a, 3000, ago(10))
  const b = invoice(4000, ahead(5)); fin.getFinance() // keep the module loaded
  inv.getInvoices().invoices.find((i) => i.id === b)!.issuedOn = ago(30); inv.getInvoices().invoices.find((i) => i.id === b)!.dueOn = ago(5)
  received(b, 2000, ago(3), 'cash')
  spend('marketing', 700, ago(8), 'bank_transfer'); spend('transport', 300, ago(2), 'cash')
  invoice(1500, ahead(20)); invoice(900, null)
})

describe('the cash flow report in the demo mirror', () => {
  it('reconciles and matches the database figures', async () => {
    const r = await cashFlow(biz, ago(20), ago(0))
    expect(r).toMatchObject({ opening: 3800, inTotal: 5000, outTotal: 1000, closing: 7800 })
    expect(reconciles(r)).toEqual({ ok: true, expected: 7800 })
  })
  it('splits money in and out by source with each expense category named, by month, and by way of paying', async () => {
    const r = await cashFlow(biz, ago(20), ago(0))
    expect(r.inByKind).toEqual([{ kind: 'invoice_receipt', total: 5000 }])
    expect(r.outByKind.map((k) => [k.kind, k.category, k.total])).toEqual([['expense', 'marketing', 700], ['expense', 'transport', 300]])
    expect(r.byMonth.reduce((a, m) => a + m.in, 0)).toBe(5000); expect(r.byMonth.reduce((a, m) => a + m.out, 0)).toBe(1000)
    expect(Object.fromEntries(r.byMethod.map((m) => [m.method, m.balance]))).toEqual({ bank_transfer: 5000 + 3000 - 1200 - 700, cash: 2000 - 300 })
  })
  it('does not count anything after the period, and an empty period is all zeros', async () => {
    expect(await cashFlow(biz, ago(20), ago(5))).toMatchObject({ inTotal: 3000, outTotal: 700, closing: 3800 + 3000 - 700 })
    expect(await cashFlow(biz, '2001-01-01', '2001-01-31')).toMatchObject({ opening: 0, inTotal: 0, outTotal: 0, closing: 0, byMonth: [], inByKind: [], outByKind: [], byMethod: [] })
  })
  it('says what is expected from invoices: overdue, due in 30 days, no due date', async () => {
    const r = await cashFlow(biz, ago(20), ago(0))
    expect(r.expected).toEqual({ overdue: 2000, due30: 1500, noDate: 900 })
  })
  it('refuses a backwards period and a role that cannot read finance', async () => {
    await expect(cashFlow(biz, ago(0), ago(20))).rejects.toThrow(/valid period/)
    as('teacher@demo.test'); await expect(cashFlow(biz, ago(20), ago(0))).rejects.toThrow(/permission denied/); as('owner@demo.test')
  })
})

describe('what the Finance screens work out', () => {
  it('names where money came from and went, with the expense category', () => {
    expect(flowLabel('sale_receipt')).toBe('Sales received'); expect(flowLabel('invoice_receipt')).toBe('Invoice payments received'); expect(flowLabel('purchase_payment')).toBe('Supplier payments')
    expect(flowLabel('expense', 'staff_welfare')).toBe('Expenses: Staff welfare'); expect(flowLabel('expense')).toBe('Expenses'); expect(flowLabel('something_new')).toBe('Something new')
  })
  it('spots a report that does not add up', () => {
    expect(reconciles({ opening: 100, inTotal: 50, outTotal: 20, closing: 130 }).ok).toBe(true)
    expect(reconciles({ opening: 100, inTotal: 50, outTotal: 20, closing: 131 })).toEqual({ ok: false, expected: 130 })
    expect(reconciles({ opening: 0.1, inTotal: 0.2, outTotal: 0, closing: 0.3 }).ok).toBe(true)
  })
  it('exports the whole report as rows', async () => {
    const rows = cashFlowExport(await cashFlow(biz, ago(20), ago(0)))
    expect(rows[1]).toEqual(['Opening balance', 3800]); expect(rows[4]).toEqual(['Closing balance', 7800])
    expect(rows.some((r) => r[0] === 'Expenses: Marketing' && r[1] === 700)).toBe(true); expect(rows.some((r) => r[0] === 'Overdue' && r[1] === 2000)).toBe(true)
  })
})

describe('the sidebar for the Finance app', () => {
  it('lists its parts', () => {
    expect(reportsModule.definition.sections!.map((s) => s.key)).toEqual(['overview', 'cashflow', 'cashbook', 'owed', 'bills'])
    const e = sidebarEntries(buildApps('general', new Set(['dashboard', 'reports']))).filter((x) => x.kind === 'section' && x.module.code === 'reports')
    expect(e.map((x) => (x.kind === 'section' ? x.section.key : ''))).toEqual(['overview', 'cashflow', 'cashbook', 'owed', 'bills'])
  })
})

describe('Expenses and Finance in a Business apps workspace', () => {
  it('are two apps, so each lists its own parts in the sidebar', () => {
    const apps = buildApps('general', new Set(['dashboard', 'expenses', 'reports']))
    expect(apps.map((a) => a.label)).toEqual(expect.arrayContaining(['Expenses', 'Finance']))
    const keys = (code: string) => sidebarEntries(apps).filter((x) => x.kind === 'section' && x.module.code === code).map((x) => (x.kind === 'section' ? x.section.key : ''))
    expect(keys('expenses')).toEqual(['expenses', 'budgets', 'report']); expect(keys('reports')).toEqual(['overview', 'cashflow', 'cashbook', 'owed', 'bills'])
  })
  it('are not split in an industry business, which keeps one Finance app', () => {
    const apps = buildApps('farm', new Set(['dashboard', 'expenses', 'reports', 'farm-cashbook']))
    expect(apps.some((a) => a.label === 'Finance')).toBe(true); expect(apps.some((a) => a.label === 'Expenses')).toBe(false)
  })
})
