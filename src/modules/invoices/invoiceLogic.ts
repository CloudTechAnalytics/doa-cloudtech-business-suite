import { mailUrl, whatsappUrl } from '@/shared/utilities/contact'
import type { CreditNote, InvoicePayment, InvoiceRow } from './invoicesApi'

/** Pure rules behind the Invoices screens, kept apart from the components so they can be tested on their own. */

const money = (n: number) => Math.round(n * 100) / 100
const DAY = 86400000
const dayNumber = (iso: string) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / DAY)

/** Payment terms offered when setting the due date. null = due on receipt (no date). */
export const TERMS: { label: string; days: number | null }[] = [{ label: 'On receipt', days: null }, { label: '7 days', days: 7 }, { label: '14 days', days: 14 }, { label: '30 days', days: 30 }, { label: '60 days', days: 60 }]
export const dueFromTerms = (issued: string, days: number | null): string => (days === null ? '' : new Date((dayNumber(issued) + days) * DAY).toISOString().slice(0, 10))

/** Still to be paid: not a draft, not cancelled, not settled. */
export const isOpen = (i: InvoiceRow) => (i.status === 'sent' || i.status === 'partially_paid') && i.balance > 0

// ---------------------------------------------------------------------------------------------------- ageing
export const BUCKETS = [['current', 'Not yet due'], ['d30', '1–30 days late'], ['d60', '31–60 days late'], ['d90', '61–90 days late'], ['d90plus', 'Over 90 days late']] as const
export type Bucket = (typeof BUCKETS)[number][0]
export interface AgeRow { customerId: string; customer: string; total: number; buckets: Record<Bucket, number>; invoices: number }

export const bucketOf = (daysLate: number): Bucket => (daysLate <= 0 ? 'current' : daysLate <= 30 ? 'd30' : daysLate <= 60 ? 'd60' : daysLate <= 90 ? 'd90' : 'd90plus')
/** Days past the due date (an invoice with no due date is due the day it was issued). */
export const daysLate = (i: InvoiceRow, asOf: string) => dayNumber(asOf) - dayNumber(i.dueOn ?? i.issuedOn)

/** Who owes what, and for how long: open invoices grouped by customer into how late they are. Biggest debt first. */
export function ageing(invoices: InvoiceRow[], asOf: string): { rows: AgeRow[]; totals: Record<Bucket, number>; total: number } {
  const blank = (): Record<Bucket, number> => ({ current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 })
  const by = new Map<string, AgeRow>()
  for (const i of invoices.filter(isOpen)) {
    const row = by.get(i.customerId) ?? { customerId: i.customerId, customer: i.customer, total: 0, buckets: blank(), invoices: 0 }
    const b = bucketOf(daysLate(i, asOf))
    row.buckets[b] = money(row.buckets[b] + i.balance); row.total = money(row.total + i.balance); row.invoices++
    by.set(i.customerId, row)
  }
  const rows = [...by.values()].sort((a, z) => z.total - a.total)
  const totals = blank()
  for (const r of rows) for (const [k] of BUCKETS) totals[k] = money(totals[k] + r.buckets[k])
  return { rows, totals, total: money(rows.reduce((a, r) => a + r.total, 0)) }
}

// ---------------------------------------------------------------------------------------------------- statement
export interface StatementLine { date: string; kind: 'invoice' | 'payment' | 'credit'; reference: string; detail: string; charge: number; credit: number; balance: number }
export interface Statement { opening: number; lines: StatementLine[]; closing: number }
const ORDER = { invoice: 0, credit: 1, payment: 2 }

/**
 * What one customer has been billed and has paid, in date order with a running balance. Sent, part-paid, paid and credited invoices are charges (drafts and cancelled
 * invoices are not); payments and credit notes take it down. Anything before `from` is folded into the opening balance.
 */
export function statement(invoices: InvoiceRow[], payments: InvoicePayment[], notes: CreditNote[], customerId: string, from = '', to = ''): Statement {
  const mine = invoices.filter((i) => i.customerId === customerId && i.status !== 'draft' && i.status !== 'cancelled')
  const num = new Map(mine.map((i) => [i.id, i.number]))
  const raw: Omit<StatementLine, 'balance'>[] = [
    ...mine.map((i) => ({ date: i.issuedOn, kind: 'invoice' as const, reference: i.number, detail: i.dueOn ? `Due ${i.dueOn}` : 'Due on receipt', charge: i.total, credit: 0 })),
    ...payments.filter((p) => p.status === 'successful' && num.has(p.invoiceId)).map((p) => ({ date: p.paidOn, kind: 'payment' as const, reference: num.get(p.invoiceId)!, detail: `Payment by ${p.method.replace(/_/g, ' ')}${p.reference ? ` (${p.reference})` : ''}`, charge: 0, credit: p.amount })),
    ...notes.filter((c) => num.has(c.invoiceId)).map((c) => ({ date: c.issuedOn, kind: 'credit' as const, reference: c.number, detail: `Credit note on ${num.get(c.invoiceId)}: ${c.reason}`, charge: 0, credit: c.amount })),
  ].sort((a, z) => a.date.localeCompare(z.date) || ORDER[a.kind] - ORDER[z.kind] || a.reference.localeCompare(z.reference))
  let bal = 0; let opening = 0; const lines: StatementLine[] = []
  for (const r of raw) {
    bal = money(bal + r.charge - r.credit)
    if (from && r.date < from) { opening = bal; continue }
    if (to && r.date > to) continue
    lines.push({ ...r, balance: bal })
  }
  return { opening, lines, closing: lines.length ? lines[lines.length - 1].balance : opening }
}

// ---------------------------------------------------------------------------------------------------- reminders
/** A polite payment reminder for an invoice, ready to send by WhatsApp or email. DOA sends nothing itself. */
export function reminderText(i: InvoiceRow, business: string, asOf: string, fmt: (n: number) => string): string {
  const late = i.dueOn ? daysLate(i, asOf) : 0
  const when = !i.dueOn ? '' : late > 0 ? ` It was due on ${i.dueOn}, ${late} ${late === 1 ? 'day' : 'days'} ago.` : ` It is due on ${i.dueOn}.`
  return `Hello ${i.customer}, this is a friendly reminder from ${business} about invoice ${i.number} for ${fmt(i.total)}. ${i.balance === i.total ? `The balance of ${fmt(i.balance)} is still open.` : `The balance of ${fmt(i.balance)} is still open after ${fmt(i.total - i.balance)} paid or credited.`}${when} Please let us know when payment is made. Thank you.`
}
export const reminderLinks = (i: InvoiceRow, business: string, asOf: string, fmt: (n: number) => string, phone: string | null, email: string | null) => {
  const text = reminderText(i, business, asOf, fmt)
  return { text, whatsapp: phone ? whatsappUrl(phone, text) : null, mail: email ? mailUrl(email, `Reminder: invoice ${i.number}`, text) : null }
}

// ---------------------------------------------------------------------------------------------------- export
export function invoicesExport(rows: InvoiceRow[]): (string | number | null)[][] {
  return [
    ['Number', 'Customer', 'Status', 'Issued', 'Due', 'Subtotal', 'Discount', 'Tax', 'Total', 'Credit notes', 'Paid', 'Balance'],
    ...rows.map((i) => [i.number, i.customer, i.overdue ? 'overdue' : i.status, i.issuedOn, i.dueOn, i.subtotal, i.discount, i.taxAmount, i.total, i.credited, i.amountPaid, i.status === 'draft' || i.status === 'cancelled' ? 0 : i.balance]),
  ]
}
