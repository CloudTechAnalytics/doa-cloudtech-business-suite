import { getCrm } from '@/demo/demoCrm'
import { newId } from '@/demo/demoInventory'
import { demoUsageCheck, monthStart, registerUsageCounter } from '@/demo/demoUsage'
import { demoAllowed, demoInsertCustomer, getTrade } from '@/demo/demoTrade'

/**
 * Browser-only invoices for demo mode. Mirrors supabase/migrations/20261021000047_invoices.sql: totals are worked out here, a payment needs an idempotency
 * key, payments are reversed (never edited or deleted), an accepted quote becomes an invoice once, and Finance reads these records through demoFinance.
 */
export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'cancelled'
export interface DInvoiceLine { description: string; quantity: number; unitPrice: number }
export interface DInvoice {
  id: string; businessId: string; number: string; customerId: string; quoteId: string | null; status: InvoiceStatus; issuedOn: string; dueOn: string | null
  lines: DInvoiceLine[]; discount: number; taxPercent: number; subtotal: number; taxAmount: number; total: number; amountPaid: number; notes: string; cancelReason: string | null; createdAt: string
}
export interface DInvoicePayment { id: string; businessId: string; invoiceId: string; amount: number; method: string; paidOn: string; reference: string | null; status: 'successful' | 'reversed'; reversalReason: string | null; key: string; createdAt: string }

interface Inv { invoices: DInvoice[]; payments: DInvoicePayment[]; counter: Record<string, number> }
const KEY = 'doa.demo.invoices.v1'
const empty = (): Inv => ({ invoices: [], payments: [], counter: {} })
function load(): Inv {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Inv) } } catch { /* fresh */ }
  return empty()
}
let state = load()
registerUsageCounter('invoices_per_month', (biz) => state.invoices.filter((i) => i.businessId === biz && i.status !== 'cancelled' && i.createdAt.slice(0, 10) >= monthStart()).length)
function commit(next: Inv) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}
export const getInvoices = () => state
export const resetDemoInvoices = () => commit(empty())

const money = (n: number) => Math.round(n * 100) / 100
const today = () => new Date().toISOString().slice(0, 10)
const METHODS = ['cash', 'bank_transfer', 'card', 'pos', 'other']
const guarded = (biz: string, fn: () => void): string | null => {
  try { if (!demoAllowed(biz, 'invoices', 'invoices.manage')) throw new Error('permission denied'); fn(); return null } catch (e) { return (e as Error).message }
}

export const demoInvoiceList = (biz: string) => state.invoices.filter((i) => i.businessId === biz)
export const demoInvoicePayments = (biz: string, invoiceId: string) => state.payments.filter((p) => p.businessId === biz && p.invoiceId === invoiceId)
const customerName = (biz: string, id: string) => getTrade().customers.find((c) => c.businessId === biz && c.id === id)?.name ?? ''
export const demoInvoiceCustomer = customerName
/** Customers for the invoice screen: readable without the CRM app, like the customers policy that also allows invoices.read. */
export const demoInvoiceCustomers = (biz: string) => getTrade().customers.filter((c) => c.businessId === biz).map((c) => ({ id: c.id, name: c.name })).sort((a, z) => a.name.localeCompare(z.name))

/** Mirrors invoice_add_customer(): reuses an active customer with the same email or phone instead of making a duplicate. */
export function demoInvoiceAddCustomer(biz: string, v: { name: string; phone: string; email: string }): { error: string | null; id?: string } {
  try {
    if (!demoAllowed(biz, 'invoices', 'invoices.manage')) throw new Error('permission denied')
    if (!v.name.trim()) throw new Error('enter the customer name')
    if (v.name.trim().length > 200) throw new Error('the customer name is too long')
    const phone = v.phone.trim() || null; const email = v.email.trim() || null
    const same = getTrade().customers.find((c) => c.businessId === biz && ((email && c.email && c.email.toLowerCase() === email.toLowerCase()) || (phone && c.phone === phone)))
    if (same) return { error: null, id: same.id }
    const id = newId('c')
    demoInsertCustomer({ id, businessId: biz, name: v.name.trim(), phone, email, source: 'invoice', category: null, creditLimit: 0, createdAt: new Date().toISOString() })
    return { error: null, id }
  } catch (e) { return { error: (e as Error).message } }
}

function tidy(lines: DInvoiceLine[], noun = 'invoice') {
  if (!lines.length) throw new Error(`add at least one line to the ${noun}`)
  if (lines.length > 100) throw new Error(`${noun === 'invoice' ? 'an invoice' : 'a ' + noun} can have at most 100 lines`)
  for (const l of lines) {
    if (!l.description.trim()) throw new Error('every line needs a description')
    if (!(l.quantity > 0) || !(l.unitPrice >= 0)) throw new Error('every line needs a quantity above zero and a price of zero or more')
  }
  const out = lines.map((l) => ({ description: l.description.trim(), quantity: l.quantity, unitPrice: money(l.unitPrice) }))
  return { lines: out, subtotal: money(out.reduce((a, l) => a + money(l.quantity * l.unitPrice), 0)) }
}

const recompute = (s: Inv, id: string): Inv => {
  const paid = money(s.payments.filter((p) => p.invoiceId === id && p.status === 'successful').reduce((a, p) => a + p.amount, 0))
  return { ...s, invoices: s.invoices.map((i) => (i.id !== id ? i : { ...i, amountPaid: paid, status: i.status === 'draft' || i.status === 'cancelled' ? i.status : paid >= i.total ? 'paid' : paid > 0 ? 'partially_paid' : 'sent' })) }
}

export function demoSaveInvoice(biz: string, v: { id: string | null; customerId: string; dueOn: string | null; lines: DInvoiceLine[]; discount: number; taxPercent: number; notes: string }): string | null {
  return guarded(biz, () => {
    if (!v.customerId || !getTrade().customers.some((c) => c.businessId === biz && c.id === v.customerId)) throw new Error('choose the customer this invoice is for')
    const { lines, subtotal } = tidy(v.lines)
    const discount = money(v.discount || 0); const tax = v.taxPercent || 0
    if (discount < 0 || discount > subtotal) throw new Error('the discount cannot be more than the invoice total')
    if (tax < 0 || tax > 100) throw new Error('the tax rate must be between 0 and 100')
    const taxAmount = money(((subtotal - discount) * tax) / 100)
    if (v.id === null) {
      const full = demoUsageCheck(biz, 'invoices_per_month')
      if (full) throw new Error(full)
      if (v.dueOn && v.dueOn < today()) throw new Error('the due date cannot be before the invoice date')
      const n = (state.counter[biz] ?? 0) + 1
      const inv: DInvoice = { id: newId('inv'), businessId: biz, number: `INV-${String(n).padStart(6, '0')}`, customerId: v.customerId, quoteId: null, status: 'draft', issuedOn: today(), dueOn: v.dueOn, lines, discount, taxPercent: tax, subtotal, taxAmount, total: money(subtotal - discount + taxAmount), amountPaid: 0, notes: v.notes, cancelReason: null, createdAt: new Date().toISOString() }
      commit({ ...state, invoices: [...state.invoices, inv], counter: { ...state.counter, [biz]: n } })
    } else {
      const cur = state.invoices.find((i) => i.id === v.id && i.businessId === biz)
      if (!cur) throw new Error('invoice not found')
      if (cur.status !== 'draft') throw new Error('an invoice that has been sent can no longer be changed; cancel it and make a new one')
      if (v.dueOn && v.dueOn < cur.issuedOn) throw new Error('the due date cannot be before the invoice date')
      commit({ ...state, invoices: state.invoices.map((i) => (i.id === v.id ? { ...i, customerId: v.customerId, dueOn: v.dueOn, lines, discount, taxPercent: tax, subtotal, taxAmount, total: money(subtotal - discount + taxAmount), notes: v.notes } : i)) })
    }
  })
}

export function demoInvoiceFromQuote(biz: string, quoteId: string): string | null {
  return guarded(biz, () => {
    const crm = getCrm()
    const q = crm.quotes.find((x) => x.id === quoteId && x.businessId === biz)
    if (!q) throw new Error('quote not found')
    if (q.status !== 'accepted') throw new Error('only an accepted quote can be turned into an invoice')
    if (state.invoices.some((i) => i.businessId === biz && i.quoteId === quoteId)) throw new Error('this quote has already been invoiced')
    const full = demoUsageCheck(biz, 'invoices_per_month')
    if (full) throw new Error(full)
    const deal = crm.deals.find((d) => d.id === q.dealId)
    const customerId = q.customerId ?? deal?.customerId ?? crm.leads.find((l) => l.id === (q.leadId ?? deal?.leadId))?.customerId ?? null
    if (!customerId) throw new Error('this quote is for a lead; convert the lead to a customer first')
    const n = (state.counter[biz] ?? 0) + 1
    const lines = q.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }))
    const inv: DInvoice = { id: newId('inv'), businessId: biz, number: `INV-${String(n).padStart(6, '0')}`, customerId, quoteId, status: 'draft', issuedOn: today(), dueOn: null, lines, discount: q.discount, taxPercent: 0, subtotal: q.subtotal, taxAmount: 0, total: money(q.subtotal - q.discount), amountPaid: 0, notes: q.notes, cancelReason: null, createdAt: new Date().toISOString() }
    commit({ ...state, invoices: [...state.invoices, inv], counter: { ...state.counter, [biz]: n } })
  })
}

export function demoSendInvoice(biz: string, id: string): string | null {
  return guarded(biz, () => {
    const i = state.invoices.find((x) => x.id === id && x.businessId === biz)
    if (!i) throw new Error('invoice not found')
    if (i.status !== 'draft') throw new Error('only a draft invoice can be sent')
    commit(recompute({ ...state, invoices: state.invoices.map((x) => (x.id === id ? { ...x, status: 'sent' as const } : x)) }, id))
  })
}

export function demoCancelInvoice(biz: string, id: string, reason: string): string | null {
  return guarded(biz, () => {
    const i = state.invoices.find((x) => x.id === id && x.businessId === biz)
    if (!i) throw new Error('invoice not found')
    if (i.status === 'cancelled') throw new Error('the invoice is already cancelled')
    if (state.payments.some((p) => p.invoiceId === id && p.status === 'successful')) throw new Error('reverse the payments on this invoice before cancelling it')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    commit({ ...state, invoices: state.invoices.map((x) => (x.id === id ? { ...x, status: 'cancelled' as const, cancelReason: reason.trim() } : x)) })
  })
}

export function demoRecordInvoicePayment(biz: string, id: string, v: { amount: number; method: string; paidOn: string | null; reference: string }, key: string): string | null {
  return guarded(biz, () => {
    if (!key || key.trim().length < 8) throw new Error('an idempotency key of at least 8 characters is required')
    const i = state.invoices.find((x) => x.id === id && x.businessId === biz)
    if (!i) throw new Error('invoice not found')
    if (state.payments.some((p) => p.businessId === biz && p.key === key)) return // the same request again: nothing is booked twice
    if (i.status !== 'sent' && i.status !== 'partially_paid') throw new Error('payments can only be recorded on a sent invoice that is not fully paid')
    const amount = money(v.amount || 0)
    if (amount <= 0) throw new Error('enter the amount received')
    if (amount > money(i.total - i.amountPaid)) throw new Error(`that is more than the balance of ${money(i.total - i.amountPaid)}`)
    const date = v.paidOn || today()
    if (date > today()) throw new Error('the payment date cannot be in the future')
    if (!METHODS.includes(v.method)) throw new Error('choose how it was paid')
    commit(recompute({ ...state, payments: [...state.payments, { id: newId('ipay'), businessId: biz, invoiceId: id, amount, method: v.method, paidOn: date, reference: v.reference.trim() || null, status: 'successful', reversalReason: null, key, createdAt: new Date().toISOString() }] }, id))
  })
}

export function demoReverseInvoicePayment(biz: string, paymentId: string, reason: string): string | null {
  return guarded(biz, () => {
    const p = state.payments.find((x) => x.id === paymentId && x.businessId === biz)
    if (!p) throw new Error('payment not found')
    if (p.status === 'reversed') throw new Error('this payment is already reversed')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    commit(recompute({ ...state, payments: state.payments.map((x) => (x.id === paymentId ? { ...x, status: 'reversed' as const, reversalReason: reason.trim() } : x)) }, p.invoiceId))
  })
}

export interface DInvoiceSummary { outstanding: number; overdue: number; overdueCount: number; paidThisMonth: number; drafts: number; byStatus: Record<string, number> }
export function demoInvoiceSummary(biz: string): DInvoiceSummary {
  if (!demoAllowed(biz, 'invoices', 'invoices.read')) throw new Error('permission denied')
  const list = demoInvoiceList(biz); const open = list.filter((i) => i.status === 'sent' || i.status === 'partially_paid')
  const late = open.filter((i) => i.dueOn && i.dueOn < today())
  const byStatus: Record<string, number> = {}
  for (const i of list) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1
  const month = today().slice(0, 7)
  return {
    outstanding: money(open.reduce((a, i) => a + i.total - i.amountPaid, 0)), overdue: money(late.reduce((a, i) => a + i.total - i.amountPaid, 0)), overdueCount: late.length,
    paidThisMonth: money(state.payments.filter((p) => p.businessId === biz && p.status === 'successful' && p.paidOn.slice(0, 7) === month).reduce((a, p) => a + p.amount, 0)),
    drafts: list.filter((i) => i.status === 'draft').length, byStatus,
  }
}
