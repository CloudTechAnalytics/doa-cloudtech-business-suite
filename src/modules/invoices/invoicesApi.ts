import * as demo from '@/demo/demoInvoices'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { listQuotes } from '@/modules/crm/dealsApi'
import type { QuoteRow } from '@/modules/crm/dealsApi'

/** Invoices and their payments. Live mode goes through the database functions; demo mode runs the browser mirror. Totals are never sent from the browser. */

export type InvoiceStatus = demo.InvoiceStatus
export const PAY_METHODS = ['cash', 'bank_transfer', 'card', 'pos', 'other'] as const
export interface InvoiceLine { description: string; quantity: number; unitPrice: number }
export interface InvoiceRow {
  id: string; number: string; customerId: string; customer: string; quoteId: string | null; status: InvoiceStatus; issuedOn: string; dueOn: string | null
  lines: InvoiceLine[]; discount: number; taxPercent: number; subtotal: number; taxAmount: number; total: number; amountPaid: number; balance: number
  notes: string; cancelReason: string | null; overdue: boolean
}
export interface InvoiceInput { id: string | null; customerId: string; dueOn: string | null; lines: InvoiceLine[]; discount: number; taxPercent: number; notes: string }
export interface InvoicePayment { id: string; invoiceId: string; amount: number; method: string; paidOn: string; reference: string | null; status: 'successful' | 'reversed'; reversalReason: string | null }
export interface InvoiceSummary { outstanding: number; overdue: number; overdueCount: number; paidThisMonth: number; drafts: number; byStatus: Record<string, number> }

const db = () => supabase!
const n = (v: unknown) => Number(v ?? 0)
const err = (e: { message: string } | null) => e?.message ?? null
const today = () => new Date().toISOString().slice(0, 10)
const isOverdue = (status: string, dueOn: string | null) => (status === 'sent' || status === 'partially_paid') && !!dueOn && dueOn < today()

export async function listInvoices(b: string): Promise<InvoiceRow[]> {
  if (isDemoMode) {
    return demo.demoInvoiceList(b).map((i) => ({ ...i, customer: demo.demoInvoiceCustomer(b, i.customerId), balance: Math.round((i.total - i.amountPaid) * 100) / 100, overdue: isOverdue(i.status, i.dueOn) })).sort((a, z) => z.number.localeCompare(a.number))
  }
  const r = await db().from('invoices').select('*').eq('business_id', b).order('number', { ascending: false }).limit(1000)
  if (r.error) throw new Error(r.error.message)
  const ids = [...new Set((r.data ?? []).map((x) => String(x.customer_id)))]
  const cs = ids.length ? await db().from('customers').select('id, name').eq('business_id', b).in('id', ids) : { data: [] }
  const names = new Map((cs.data ?? []).map((c) => [String(c.id), String(c.name)]))
  return (r.data ?? []).map((x) => ({
    id: String(x.id), number: String(x.number), customerId: String(x.customer_id), customer: names.get(String(x.customer_id)) ?? '', quoteId: (x.quote_id as string | null) ?? null, status: x.status as InvoiceStatus,
    issuedOn: String(x.issued_on).slice(0, 10), dueOn: x.due_on ? String(x.due_on).slice(0, 10) : null,
    lines: (x.lines as { description: string; quantity: number; unit_price: number }[]).map((l) => ({ description: l.description, quantity: n(l.quantity), unitPrice: n(l.unit_price) })),
    discount: n(x.discount), taxPercent: n(x.tax_percent), subtotal: n(x.subtotal), taxAmount: n(x.tax_amount), total: n(x.total), amountPaid: n(x.amount_paid), balance: Math.round((n(x.total) - n(x.amount_paid)) * 100) / 100,
    notes: String(x.notes ?? ''), cancelReason: (x.cancel_reason as string | null) ?? null, overdue: isOverdue(String(x.status), x.due_on ? String(x.due_on).slice(0, 10) : null),
  }))
}

export async function listInvoicePayments(b: string, invoiceId: string): Promise<InvoicePayment[]> {
  if (isDemoMode) return demo.demoInvoicePayments(b, invoiceId).map((p) => ({ id: p.id, invoiceId: p.invoiceId, amount: p.amount, method: p.method, paidOn: p.paidOn, reference: p.reference, status: p.status, reversalReason: p.reversalReason }))
  const r = await db().from('invoice_payments').select('*').eq('business_id', b).eq('invoice_id', invoiceId).order('created_at')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ id: String(x.id), invoiceId: String(x.invoice_id), amount: n(x.amount), method: String(x.method), paidOn: String(x.paid_on).slice(0, 10), reference: (x.reference as string | null) ?? null, status: x.status as 'successful' | 'reversed', reversalReason: (x.reversal_reason as string | null) ?? null }))
}

export async function saveInvoice(b: string, v: InvoiceInput) {
  if (isDemoMode) return demo.demoSaveInvoice(b, v)
  return err((await db().rpc('invoice_save', { p_business: b, p_id: v.id, p_customer: v.customerId, p_due: v.dueOn, p_lines: v.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unitPrice })), p_discount: v.discount, p_tax: v.taxPercent, p_notes: v.notes })).error)
}

/** Customers to bill. Readable with the Invoices app alone (the CRM app need not be on). */
export async function listInvoiceCustomers(b: string): Promise<{ id: string; name: string }[]> {
  if (isDemoMode) return demo.demoInvoiceCustomers(b)
  const r = await db().from('customers').select('id, name').eq('business_id', b).eq('status', 'active').order('name').limit(1000)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ id: String(x.id), name: String(x.name) }))
}

/** Adds a customer from the invoice screen (reuses one with the same email or phone). */
export async function addInvoiceCustomer(b: string, v: { name: string; phone: string; email: string }): Promise<{ error: string | null; id?: string }> {
  if (isDemoMode) return demo.demoInvoiceAddCustomer(b, v)
  const { data, error } = await db().rpc('invoice_add_customer', { p_business: b, p_name: v.name, p_phone: v.phone, p_email: v.email })
  return error ? { error: error.message } : { error: null, id: String(data) }
}

export async function invoiceFromQuote(b: string, quoteId: string) {
  if (isDemoMode) return demo.demoInvoiceFromQuote(b, quoteId)
  return err((await db().rpc('invoice_from_quote', { p_quote: quoteId })).error)
}

export async function sendInvoice(b: string, id: string) {
  if (isDemoMode) return demo.demoSendInvoice(b, id)
  return err((await db().rpc('invoice_send', { p_invoice: id })).error)
}

export async function cancelInvoice(b: string, id: string, reason: string) {
  if (isDemoMode) return demo.demoCancelInvoice(b, id, reason)
  return err((await db().rpc('invoice_cancel', { p_invoice: id, p_reason: reason })).error)
}

export async function recordInvoicePayment(b: string, id: string, v: { amount: number; method: string; paidOn: string | null; reference: string }, key: string) {
  if (isDemoMode) return demo.demoRecordInvoicePayment(b, id, v, key)
  return err((await db().rpc('invoice_record_payment', { p_invoice: id, p_amount: v.amount, p_method: v.method, p_paid_on: v.paidOn, p_reference: v.reference, p_key: key })).error)
}

export async function reverseInvoicePayment(b: string, paymentId: string, reason: string) {
  if (isDemoMode) return demo.demoReverseInvoicePayment(b, paymentId, reason)
  return err((await db().rpc('invoice_reverse_payment', { p_payment: paymentId, p_reason: reason })).error)
}

export async function invoiceSummary(b: string): Promise<InvoiceSummary> {
  if (isDemoMode) return demo.demoInvoiceSummary(b)
  const { data, error } = await db().rpc('invoice_summary', { p_business: b })
  if (error) throw new Error(error.message)
  const x = data as { outstanding: number; overdue: number; overdue_count: number; paid_this_month: number; drafts: number; by_status: Record<string, number> }
  return { outstanding: n(x.outstanding), overdue: n(x.overdue), overdueCount: n(x.overdue_count), paidThisMonth: n(x.paid_this_month), drafts: n(x.drafts), byStatus: x.by_status }
}

/** Accepted quotes that have not been turned into an invoice yet. */
export async function quotesReadyToInvoice(b: string, existing: InvoiceRow[]): Promise<QuoteRow[]> {
  const used = new Set(existing.map((i) => i.quoteId).filter(Boolean))
  return (await listQuotes(b)).filter((q) => q.status === 'accepted' && !used.has(q.id))
}
