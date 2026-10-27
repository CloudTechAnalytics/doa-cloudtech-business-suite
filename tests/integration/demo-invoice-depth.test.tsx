import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildApps, sidebarEntries } from '@/app/navigation/navigation'
import { getIndustry } from '@/core/industry-registry'
import * as fin from '@/demo/demoFinance'
import * as inv from '@/demo/demoInvoices'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'
import { demoCreateCustomer, getTrade } from '@/demo/demoTrade'
import { StatementSheet } from '@/modules/invoices/InvoiceReports'
import { CreditNoteSheet, InvoiceSheet } from '@/modules/invoices/InvoicesPage'
import { ageing, bucketOf, dueFromTerms, invoicesExport, reminderLinks, reminderText, statement } from '@/modules/invoices/invoiceLogic'
import * as api from '@/modules/invoices/invoicesApi'
import type { InvoiceRow } from '@/modules/invoices/invoicesApi'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let biz: string, customer: string
let n = 0
const key = () => `dcn-${n++}-abcdefgh`
const line = (description: string, quantity: number, unitPrice: number) => ({ description, quantity, unitPrice })
const sent = (total = 10000) => {
  expect(inv.demoSaveInvoice(biz, { id: null, customerId: customer, dueOn: null, lines: [line('Consulting', 1, total)], discount: 0, taxPercent: 0, notes: '' })).toBeNull()
  const id = inv.demoInvoiceList(biz).at(-1)!.id
  expect(inv.demoSendInvoice(biz, id)).toBeNull()
  return id
}
const get = (id: string) => inv.demoInvoiceList(biz).find((i) => i.id === id)!
const pay = (id: string, amount: number) => inv.demoRecordInvoicePayment(biz, id, { amount, method: 'cash', paidOn: null, reference: '' }, key())
const credit = (id: string, amount: number, reason = 'Goods returned', k = key()) => inv.demoIssueCreditNote(biz, id, { amount, reason }, k)

beforeAll(async () => {
  as('owner@demo.test')
  biz = demoCreateBusiness('Consulting Co', 'general')
  await getIndustry('general').afterCreate?.(biz, {})
  expect(demoCreateCustomer(biz, 'Acme Ltd', '0800')).toBeNull()
  customer = getTrade().customers.find((c) => c.businessId === biz && c.name === 'Acme Ltd')!.id
})

describe('credit notes in the demo mirror', () => {
  it('lower what is owed, are numbered, and leave the invoice as it was', () => {
    const id = sent()
    expect(credit(id, 2500)).toBeNull()
    expect(get(id)).toMatchObject({ status: 'sent', credited: 2500, total: 10000, amountPaid: 0 })
    expect(credit(id, 500)).toBeNull()
    expect(inv.demoCreditNotes(biz, id).map((c) => c.number).slice(-2)).toEqual([expect.stringMatching(/^CN-\d{6}$/), expect.stringMatching(/^CN-\d{6}$/)])
  })
  it('limit payments and further credits to what is still owed', () => {
    const id = sent()
    credit(id, 4000)
    expect(pay(id, 6500)).toMatch(/more than the balance of 6000/)
    expect(pay(id, 2000)).toBeNull()
    expect(get(id).status).toBe('partially_paid')
    expect(credit(id, 4500)).toMatch(/more than the balance of 4000/)
    expect(pay(id, 4000)).toBeNull()
    expect(get(id).status).toBe('paid')
  })
  it('call a fully credited invoice Credited, and a part-paid one that is covered Paid', () => {
    const a = sent(3000); expect(credit(a, 3000)).toBeNull(); expect(get(a).status).toBe('credited')
    const b = sent(3000); pay(b, 1000); expect(credit(b, 2000)).toBeNull(); expect(get(b).status).toBe('paid')
  })
  it('refuse a draft, a settled invoice, a missing reason or amount, and cancelling afterwards', () => {
    expect(inv.demoSaveInvoice(biz, { id: null, customerId: customer, dueOn: null, lines: [line('x', 1, 100)], discount: 0, taxPercent: 0, notes: '' })).toBeNull()
    expect(credit(inv.demoInvoiceList(biz).at(-1)!.id, 10)).toMatch(/sent invoice/)
    const open = sent(100)
    expect(credit(open, 10, 'x')).toMatch(/reason is required/); expect(credit(open, 0)).toMatch(/amount to credit/)
    const withNote = sent(100); credit(withNote, 10)
    expect(inv.demoCancelInvoice(biz, withNote, 'Changed my mind')).toMatch(/credit notes/)
  })
  it('do nothing the second time the same request arrives', () => {
    const id = sent(1000); const k = key()
    credit(id, 100, 'Once', k); credit(id, 100, 'Once', k)
    expect(get(id).credited).toBe(100)
  })
  it('go back to Sent when the payment that settled them is reversed', () => {
    const id = sent(2000); pay(id, 1500); credit(id, 500); expect(get(id).status).toBe('paid')
    const p = inv.demoInvoicePayments(biz, id)[0]
    expect(inv.demoReverseInvoicePayment(biz, p.id, 'Bounced cheque')).toBeNull()
    expect(get(id)).toMatchObject({ status: 'sent', amountPaid: 0, credited: 500 })
  })
  it('show in the summary and in Finance at the lower figure', async () => {
    const b = demoCreateBusiness('Books Co', 'general'); await getIndustry('general').afterCreate?.(b, {})
    demoCreateCustomer(b, 'Zed', '0900'); const c = getTrade().customers.find((x) => x.businessId === b)!.id
    inv.demoSaveInvoice(b, { id: null, customerId: c, dueOn: null, lines: [line('Work', 1, 10000)], discount: 0, taxPercent: 0, notes: '' })
    const id = inv.demoInvoiceList(b)[0].id; inv.demoSendInvoice(b, id)
    expect(inv.demoIssueCreditNote(b, id, { amount: 3000, reason: 'Price corrected' }, key())).toBeNull()
    expect(inv.demoRecordInvoicePayment(b, id, { amount: 2000, method: 'cash', paidOn: null, reference: '' }, key())).toBeNull()
    expect(inv.demoInvoiceSummary(b).outstanding).toBe(5000)
    const r = fin.demoReceivables(b).find((x) => x.source === 'invoice')!
    expect(r).toMatchObject({ grandTotal: 7000, balanceDue: 5000 })
    const today = new Date().toISOString().slice(0, 10)
    expect(fin.demoReportSummary(b, today, today)).toMatchObject({ invoicedTotal: 7000, receivablesOpen: 5000 })
  })
  it('are listed through the API for one invoice or the whole business', async () => {
    const id = sent(800); credit(id, 80)
    expect((await api.listCreditNotes(biz, id)).map((c) => c.amount)).toEqual([80])
    expect((await api.listCreditNotes(biz)).length).toBeGreaterThan(1)
  })
})

describe('what the invoice screens work out', () => {
  const row = (over: Partial<InvoiceRow>): InvoiceRow => ({ id: 'i', number: 'INV-000001', customerId: 'c1', customer: 'Acme', quoteId: null, status: 'sent', issuedOn: '2031-01-01', dueOn: '2031-01-31', lines: [], discount: 0, taxPercent: 0, subtotal: 1000, taxAmount: 0, total: 1000, amountPaid: 0, credited: 0, balance: 1000, notes: '', cancelReason: null, overdue: false, ...over })

  it('works out a due date from payment terms', () => {
    expect(dueFromTerms('2031-01-01', 30)).toBe('2031-01-31'); expect(dueFromTerms('2031-02-20', 14)).toBe('2031-03-06'); expect(dueFromTerms('2031-01-01', null)).toBe('')
  })
  it('puts how late something is into the right bucket', () => {
    expect([0, -5, 1, 30, 31, 60, 61, 90, 91].map(bucketOf)).toEqual(['current', 'current', 'd30', 'd30', 'd60', 'd60', 'd90', 'd90', 'd90plus'])
  })
  it('ages what customers owe, biggest debt first, leaving out drafts, cancelled and settled invoices', () => {
    const list = [
      row({ id: 'a', customerId: 'c1', dueOn: '2031-02-10', balance: 1000 }), // 5 days late on 2031-02-15
      row({ id: 'b', customerId: 'c1', dueOn: '2030-10-01', balance: 500, status: 'partially_paid' }), // over 90
      row({ id: 'c', customerId: 'c2', customer: 'Bola', dueOn: '2031-03-01', balance: 4000 }), // not yet due
      row({ id: 'd', customerId: 'c2', status: 'draft', balance: 9999 }), row({ id: 'e', customerId: 'c2', status: 'paid', balance: 0 }), row({ id: 'f', customerId: 'c2', status: 'cancelled', balance: 9999 }),
      row({ id: 'g', customerId: 'c3', dueOn: null, issuedOn: '2031-02-14', balance: 200, customer: 'Chi' }), // no due date: counts from issue, 1 day late
    ]
    const a = ageing(list, '2031-02-15')
    expect(a.rows.map((r) => [r.customer, r.total])).toEqual([['Bola', 4000], ['Acme', 1500], ['Chi', 200]])
    expect(a.rows[1].buckets).toMatchObject({ d30: 1000, d90plus: 500, current: 0 })
    expect(a.totals).toMatchObject({ current: 4000, d30: 1200, d90plus: 500 }); expect(a.total).toBe(5700)
  })
  it('builds a statement with a running balance, payments and credit notes taking it down', () => {
    const invoices = [row({ id: 'i1', number: 'INV-000001', total: 1000, issuedOn: '2031-01-01' }), row({ id: 'i2', number: 'INV-000002', total: 500, issuedOn: '2031-02-01', status: 'paid' }), row({ id: 'dr', status: 'draft', issuedOn: '2031-01-05' }), row({ id: 'o', customerId: 'other', issuedOn: '2031-01-02' })]
    const pays = [{ id: 'p1', invoiceId: 'i1', amount: 400, method: 'bank_transfer', paidOn: '2031-01-10', reference: 'REF1', status: 'successful' as const, reversalReason: null }, { id: 'p2', invoiceId: 'i2', amount: 500, method: 'cash', paidOn: '2031-02-02', reference: null, status: 'successful' as const, reversalReason: null }]
    const notes = [{ id: 'n1', invoiceId: 'i1', number: 'CN-000001', amount: 100, reason: 'Returned', issuedOn: '2031-01-20' }]
    const s = statement(invoices, pays, notes, 'c1')
    expect(s.lines.map((l) => [l.reference, l.balance])).toEqual([['INV-000001', 1000], ['INV-000001', 600], ['CN-000001', 500], ['INV-000002', 1000], ['INV-000002', 500]])
    expect(s.closing).toBe(500); expect(s.opening).toBe(0)
    const later = statement(invoices, pays, notes, 'c1', '2031-02-01')
    expect(later.opening).toBe(500); expect(later.lines.map((l) => l.reference)).toEqual(['INV-000002', 'INV-000002']); expect(later.closing).toBe(500)
    expect(statement(invoices, pays, notes, 'c1', '', '2031-01-15').closing).toBe(600)
  })
  it('writes a reminder with what is owed and how late it is, and links only for the contact details it has', () => {
    const i = row({ dueOn: '2031-01-31', balance: 800, total: 1000 })
    const t = reminderText(i, 'Corner Shop', '2031-02-05', (x) => `₦${x}`)
    for (const s of ['Hello Acme', 'Corner Shop', 'INV-000001', '₦1000', '₦800', 'due on 2031-01-31, 5 days ago', 'after ₦200 paid or credited']) expect(t).toContain(s)
    const links = reminderLinks(i, 'Corner Shop', '2031-02-05', (x) => `₦${x}`, '0803 123 4567', null)
    expect(links.whatsapp).toContain('wa.me/'); expect(links.mail).toBeNull()
    expect(reminderLinks(i, 'S', '2031-02-05', String, null, 'a@b.co').mail).toContain('mailto:')
  })
  it('exports invoices with credit notes and what is owed', () => {
    const csv = invoicesExport([row({ credited: 100, amountPaid: 400, balance: 500 }), row({ id: 'd', status: 'draft', balance: 1000 })])
    expect(csv[0]).toContain('Credit notes'); expect(csv[1].slice(-3)).toEqual([100, 400, 500]); expect(csv[2].at(-1)).toBe(0)
  })
  it('prints the credit note, the statement and the invoice with credit notes', () => {
    const i = row({ credited: 100, balance: 900 })
    expect(renderToStaticMarkup(<InvoiceSheet invoice={i} business="Corner Shop" />)).toContain('Credit notes')
    expect(renderToStaticMarkup(<CreditNoteSheet note={{ id: 'n', invoiceId: 'i', number: 'CN-000001', amount: 100, reason: 'Returned', issuedOn: '2031-01-20' }} invoice={i} business="Corner Shop" />)).toMatch(/Credit note.*CN-000001.*Returned/s)
    const html = renderToStaticMarkup(<StatementSheet business="Corner Shop" customer="Acme" from="" to="" s={{ opening: 0, closing: 900, lines: [{ date: '2031-01-01', kind: 'invoice', reference: 'INV-000001', detail: 'Due on receipt', charge: 1000, credit: 0, balance: 1000 }] }} />)
    for (const s of ['Statement', 'Acme', 'INV-000001', 'Balance owing']) expect(html).toContain(s)
  })
})

describe('the sidebar for the Invoices app', () => {
  it('lists its parts', () => {
    const e = sidebarEntries(buildApps('general', new Set(['dashboard', 'invoices']))).filter((x) => x.kind === 'section' && x.module.code === 'invoices')
    expect(e.map((x) => (x.kind === 'section' ? x.section.key : ''))).toEqual(['invoices', 'payments', 'statements', 'ageing'])
  })
})

describe('recording payments from the invoice list, and receipts', () => {
  const pay1 = (id: string, amount: number) => api.recordInvoicePayment(biz, id, { amount, method: 'bank_transfer', paidOn: null, reference: 'TRF-1' }, key())
  it('offers the full balance and half as one-tap amounts, and only half when there is enough to halve', async () => {
    const { amountChoices } = await import('@/modules/invoices/invoiceLogic')
    expect(amountChoices(1000)).toEqual([{ label: 'Full balance', amount: 1000 }, { label: 'Half', amount: 500 }])
    expect(amountChoices(1.5)).toEqual([{ label: 'Full balance', amount: 1.5 }]); expect(amountChoices(333.33)[1].amount).toBe(166.67)
  })
  it('finds the payment that was just recorded by comparing the list before and after, for a part payment and for the rest', async () => {
    const id = sent(2000)
    const ids = async () => new Set((await api.listInvoicePayments(biz, id)).map((p) => p.id))
    const before = await ids()
    expect(await pay1(id, 500)).toBeNull()
    const first = (await api.listInvoicePayments(biz, id)).find((p) => !before.has(p.id))!
    expect(first).toMatchObject({ amount: 500, method: 'bank_transfer', reference: 'TRF-1', status: 'successful' })
    expect(get(id)).toMatchObject({ status: 'partially_paid', amountPaid: 500 })
    const mid = await ids()
    expect(await pay1(id, 1500)).toBeNull()
    const second = (await api.listInvoicePayments(biz, id)).find((p) => !mid.has(p.id))!
    expect(second.amount).toBe(1500); expect(second.id).not.toBe(first.id); expect(get(id).status).toBe('paid')
  })
  it('gives each payment its own steady receipt number', async () => {
    const { receiptNumber } = await import('@/modules/invoices/invoiceLogic')
    expect(receiptNumber({ id: 'ipay_ab12-cd34-ef56' })).toBe('RCT-CD34EF56') // the last eight letters and numbers of the id
    expect(receiptNumber({ id: 'x1' })).toBe(receiptNumber({ id: 'x1' })); expect(receiptNumber({ id: 'aaaa1111' })).not.toBe(receiptNumber({ id: 'bbbb2222' }))
    expect(receiptNumber({ id: 'ipay_ab12-cd34-ef56' })).toMatch(/^RCT-[A-Z0-9]{1,8}$/)
  })
  it('words a receipt with what was received, how, for which invoice, and what is left or that it is settled', async () => {
    const { paymentReceiptLinks, paymentReceiptText } = await import('@/modules/invoices/invoiceLogic')
    const inv = { id: 'i', number: 'INV-000009', customerId: 'c1', customer: 'Acme', quoteId: null, status: 'partially_paid' as const, issuedOn: '2031-01-01', dueOn: null, lines: [], discount: 0, taxPercent: 0, subtotal: 1000, taxAmount: 0, total: 1000, amountPaid: 400, credited: 0, balance: 600, notes: '', cancelReason: null, overdue: false }
    const p = { id: 'ipay_zz99aa88', invoiceId: 'i', amount: 400, method: 'bank_transfer', paidOn: '2031-01-10', reference: null, status: 'successful' as const, reversalReason: null }
    const t = paymentReceiptText(inv, p, 'Corner Shop', (x) => `₦${x}`)
    for (const s of ['Hello Acme', 'Corner Shop', '₦400', 'bank transfer', '2031-01-10', 'INV-000009', 'balance still due is ₦600']) expect(t).toContain(s)
    expect(paymentReceiptText({ ...inv, balance: 0 }, p, 'Corner Shop', String)).toContain('fully settled')
    const l = paymentReceiptLinks(inv, p, 'Corner Shop', String, '0803 123 4567', null)
    expect(l.whatsapp).toContain('wa.me/'); expect(l.mail).toBeNull(); expect(paymentReceiptLinks(inv, p, 'S', String, null, 'a@b.co').mail).toContain('mailto:')
  })
  it('prints a receipt with the amount, the invoice and the balance', async () => {
    const { PaymentReceiptSheet } = await import('@/modules/invoices/InvoicePayments')
    const inv = { id: 'i', number: 'INV-000009', customerId: 'c1', customer: 'Acme', quoteId: null, status: 'partially_paid' as const, issuedOn: '2031-01-01', dueOn: null, lines: [], discount: 0, taxPercent: 0, subtotal: 1000, taxAmount: 0, total: 1000, amountPaid: 400, credited: 0, balance: 600, notes: '', cancelReason: null, overdue: false }
    const html = renderToStaticMarkup(<PaymentReceiptSheet invoice={inv} business="Corner Shop" payment={{ id: 'ipay_zz99aa88', invoiceId: 'i', amount: 400, method: 'bank_transfer', paidOn: '2031-01-10', reference: 'TRF-1', status: 'successful', reversalReason: null }} />)
    for (const s of ['Payment receipt', 'Corner Shop', 'Acme', 'INV-000009', 'Bank transfer', 'TRF-1', 'Amount received', 'Balance still due', 'Thank you']) expect(html).toContain(s)
  })
})

describe('the Payments page', () => {
  const inv = (id: string, over: Partial<InvoiceRow> = {}): InvoiceRow => ({ id, number: `INV-${id}`, customerId: 'c1', customer: 'Acme', quoteId: null, status: 'sent', issuedOn: '2031-01-01', dueOn: null, lines: [], discount: 0, taxPercent: 0, subtotal: 1000, taxAmount: 0, total: 1000, amountPaid: 0, credited: 0, balance: 1000, notes: '', cancelReason: null, overdue: false, ...over })
  const pay = (id: string, invoiceId: string, o: Partial<api.InvoicePayment> = {}): api.InvoicePayment => ({ id, invoiceId, amount: 100, method: 'cash', paidOn: '2031-02-01', reference: null, status: 'successful', reversalReason: null, ...o })
  it('lists each payment with its invoice, newest first, and leaves out one whose invoice is unknown', async () => {
    const { paymentLines } = await import('@/modules/invoices/invoiceLogic')
    const lines = paymentLines([pay('p1', 'a', { paidOn: '2031-02-01' }), pay('p2', 'b', { paidOn: '2031-03-01' }), pay('p3', 'zzz')], [inv('a'), inv('b', { customer: 'Bola' })])
    expect(lines.map((l) => [l.payment.id, l.invoice.customer])).toEqual([['p2', 'Bola'], ['p1', 'Acme']])
  })
  it('filters by words, how it was paid, dates and whether it was reversed, and totals only what was received', async () => {
    const { filterPayments, paymentLines, receivedTotal } = await import('@/modules/invoices/invoiceLogic')
    const all = paymentLines([pay('p1', 'a', { amount: 300, reference: 'TRF-9', method: 'bank_transfer' }), pay('p2', 'b', { amount: 200, paidOn: '2031-03-05' }), pay('p3', 'a', { amount: 50, status: 'reversed', reversalReason: 'Bounced' })], [inv('a'), inv('b', { customer: 'Bola' })])
    expect(filterPayments(all, { q: 'bola' }).map((l) => l.payment.id)).toEqual(['p2']); expect(filterPayments(all, { q: 'trf-9' }).map((l) => l.payment.id)).toEqual(['p1'])
    expect(filterPayments(all, { method: 'bank_transfer' }).map((l) => l.payment.id)).toEqual(['p1']); expect(filterPayments(all, { from: '2031-03-01' }).map((l) => l.payment.id)).toEqual(['p2'])
    expect(filterPayments(all, { status: 'reversed' }).map((l) => l.payment.id)).toEqual(['p3']); expect(filterPayments(all, { status: 'all' })).toHaveLength(3)
    expect(receivedTotal(all)).toBe(500) // the reversed 50 is not counted
  })
  it('offers only invoices that still owe something, the biggest debt first', async () => {
    const { payableInvoices } = await import('@/modules/invoices/invoiceLogic')
    const list = [inv('a', { balance: 200 }), inv('b', { balance: 900, status: 'partially_paid' }), inv('c', { status: 'draft' }), inv('d', { status: 'paid', balance: 0 }), inv('e', { status: 'cancelled' }), inv('f', { status: 'credited', balance: 0 })]
    expect(payableInvoices(list).map((i) => i.id)).toEqual(['b', 'a'])
  })
  it('exports the payments, reversed ones included with why', async () => {
    const { paymentLines, paymentsExport } = await import('@/modules/invoices/invoiceLogic')
    const csv = paymentsExport(paymentLines([pay('ipay_ab12cd34', 'a', { amount: 300, method: 'bank_transfer', reference: 'TRF-9' }), pay('ipay_ef56gh78', 'a', { status: 'reversed', reversalReason: 'Bounced' })], [inv('a')]))
    expect(csv[0]).toContain('Receipt'); expect(csv.some((r) => r[6] === 300 && r[4] === 'bank transfer' && r[5] === 'TRF-9')).toBe(true); expect(csv.some((r) => r[7] === 'reversed' && r[8] === 'Bounced')).toBe(true)
  })
  it('reads every payment through the API, reversed ones only when asked', async () => {
    const id = sent(600); expect(await api.recordInvoicePayment(biz, id, { amount: 200, method: 'cash', paidOn: null, reference: '' }, key())).toBeNull()
    const first = inv_(biz, id)
    expect(await api.recordInvoicePayment(biz, id, { amount: 100, method: 'cash', paidOn: null, reference: '' }, key())).toBeNull()
    const second = inv_(biz, id).find((p) => !first.some((q) => q.id === p.id))!
    expect(inv_(biz, id)).toHaveLength(2)
    expect(await api.reverseInvoicePayment(biz, second.id, 'Bounced')).toBeNull()
    expect((await api.listAllInvoicePayments(biz)).filter((p) => p.invoiceId === id)).toHaveLength(1)
    expect((await api.listAllInvoicePayments(biz, true)).filter((p) => p.invoiceId === id).map((p) => p.status).sort()).toEqual(['reversed', 'successful'])
  })
})
const inv_ = (b: string, id: string) => inv_list(b).filter((p) => p.invoiceId === id)
const demoPayments = (b: string) => inv.getInvoices().payments.filter((p) => p.businessId === b)
const inv_list = demoPayments
