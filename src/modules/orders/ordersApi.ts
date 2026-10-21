import * as demo from '@/demo/demoOrders'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** Purchase requests, supplier bills and sales orders. Live mode reads the database views and calls the functions; demo mode
 *  runs the browser mirror. Mutations return an error message or null. */
export interface RequestDto {
  id: string; number: string; status: 'requested' | 'approved' | 'rejected' | 'ordered' | 'cancelled'; note: string | null; requestedAt: string
  decisionNote: string | null; purchaseId: string | null; items: { productId: string; quantity: number; estimatedCost: number | null }[]
}
export interface BillDto {
  id: string; supplierId: string; supplierName: string; purchaseId: string; purchaseNumber: string; number: string; billDate: string; dueDate: string
  amount: number; status: 'open' | 'voided'; voidReason: string | null; purchaseTotal: number; purchasePaid: number; paymentStatus: string; overdue: boolean
}
export interface OrderLineDto { id: string; productId: string; quantity: number; quotedPrice: number; fulfilled: number; remaining: number }
export interface OrderDto {
  id: string; number: string; customerId: string; status: 'open' | 'partially_fulfilled' | 'fulfilled' | 'cancelled'; expected: string | null; note: string | null
  cancelReason: string | null; createdAt: string; quotedTotal: number; lines: OrderLineDto[]
}

const n = (v: unknown) => Number(v ?? 0)
const msg = (e: { message: string } | null) => e?.message ?? null
const db = () => supabase!

// ------------------------------------------------------------- purchase requests
export async function listRequests(b: string): Promise<RequestDto[]> {
  if (isDemoMode) {
    return demo.getOrders().requests.filter((r) => r.businessId === b).map((r) => ({ id: r.id, number: r.number, status: r.status, note: r.note, requestedAt: r.requestedAt, decisionNote: r.decisionNote, purchaseId: r.purchaseId, items: r.items })).reverse()
  }
  const [r, i] = await Promise.all([
    db().from('purchase_requests').select('*').eq('business_id', b).order('requested_at', { ascending: false }).limit(200),
    db().from('purchase_request_items').select('*').eq('business_id', b),
  ])
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({
    id: x.id, number: x.request_number, status: x.status as RequestDto['status'], note: x.note, requestedAt: x.requested_at, decisionNote: x.decision_note, purchaseId: x.purchase_id,
    items: (i.data ?? []).filter((y) => y.request_id === x.id).map((y) => ({ productId: y.product_id, quantity: n(y.quantity), estimatedCost: y.estimated_unit_cost === null ? null : n(y.estimated_unit_cost) })),
  }))
}

export async function createRequest(b: string, items: { productId: string; quantity: number; estimatedCost: number | null }[], note: string, key: string) {
  if (isDemoMode) return demo.demoCreateRequest(b, items, note, key).error
  return msg((await db().rpc('create_purchase_request', { p_business: b, p_items: items.map((x) => ({ product_id: x.productId, quantity: x.quantity, estimated_unit_cost: x.estimatedCost })), p_note: note || null, p_key: key })).error)
}
export async function decideRequest(b: string, id: string, approve: boolean, note: string, key: string) {
  if (isDemoMode) return demo.demoDecideRequest(b, id, approve, note, key)
  return msg((await db().rpc('decide_purchase_request', { p_request: id, p_approve: approve, p_note: note || null, p_key: key })).error)
}
export async function cancelRequest(b: string, id: string, key: string) {
  if (isDemoMode) return demo.demoCancelRequest(b, id, key)
  return msg((await db().rpc('cancel_purchase_request', { p_request: id, p_key: key })).error)
}
export async function orderRequest(b: string, id: string, supplierId: string, key: string) {
  if (isDemoMode) return demo.demoOrderRequest(b, id, supplierId, key).error
  return msg((await db().rpc('order_purchase_request', { p_request: id, p_supplier: supplierId, p_key: key })).error)
}

// -------------------------------------------------------------------- supplier bills
export async function listBills(b: string): Promise<BillDto[]> {
  if (isDemoMode) {
    return demo.demoBills(b).map((x) => ({ id: x.id, supplierId: x.supplierId, supplierName: x.supplierName, purchaseId: x.purchaseId, purchaseNumber: x.purchaseNumber, number: x.number, billDate: x.billDate, dueDate: x.dueDate, amount: x.amount, status: x.status, voidReason: x.voidReason, purchaseTotal: x.purchaseTotal, purchasePaid: x.purchasePaid, paymentStatus: x.paymentStatus, overdue: x.overdue })).reverse()
  }
  const r = await db().from('supplier_bill_status').select('*').eq('business_id', b).order('due_date').limit(300)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ id: x.id!, supplierId: x.supplier_id!, supplierName: x.supplier_name!, purchaseId: x.purchase_id!, purchaseNumber: x.purchase_number!, number: x.bill_number!, billDate: x.bill_date!, dueDate: x.due_date!, amount: n(x.amount), status: x.status as 'open' | 'voided', voidReason: x.void_reason, purchaseTotal: n(x.purchase_total), purchasePaid: n(x.purchase_paid), paymentStatus: x.payment_status!, overdue: !!x.overdue }))
}

export async function recordBill(b: string, v: { purchaseId: string; number: string; billDate: string; dueDate: string; amount: number }, key: string) {
  if (isDemoMode) return demo.demoRecordBill(b, v, key).error
  return msg((await db().rpc('record_supplier_bill', { p_business: b, p_purchase: v.purchaseId, p_bill_number: v.number, p_bill_date: v.billDate, p_due_date: v.dueDate, p_amount: v.amount, p_key: key })).error)
}
export async function voidBill(b: string, id: string, reason: string, key: string) {
  if (isDemoMode) return demo.demoVoidBill(b, id, reason, key)
  return msg((await db().rpc('void_supplier_bill', { p_bill: id, p_reason: reason, p_key: key })).error)
}

// --------------------------------------------------------------------- sales orders
export async function listOrders(b: string): Promise<OrderDto[]> {
  if (isDemoMode) {
    return demo.demoOrderRows(b).map((o) => ({ id: o.id, number: o.number, customerId: o.customerId, status: o.derivedStatus, expected: o.expected, note: o.note, cancelReason: o.cancelReason, createdAt: o.createdAt, quotedTotal: o.quotedTotal, lines: o.lines.map((l) => ({ id: l.id, productId: l.productId, quantity: l.quantity, quotedPrice: l.quotedPrice, fulfilled: l.fulfilled, remaining: l.remaining })) })).reverse()
  }
  const [o, l] = await Promise.all([
    db().from('sales_order_status').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(200),
    db().from('sales_order_line_status').select('*').eq('business_id', b),
  ])
  if (o.error) throw new Error(o.error.message)
  return (o.data ?? []).map((x) => ({
    id: x.id!, number: x.order_number!, customerId: x.customer_id!, status: x.status as OrderDto['status'], expected: x.expected_date, note: x.note, cancelReason: x.cancel_reason, createdAt: x.created_at!, quotedTotal: n(x.quoted_total),
    lines: (l.data ?? []).filter((y) => y.order_id === x.id).map((y) => ({ id: y.line_id!, productId: y.product_id!, quantity: n(y.quantity), quotedPrice: n(y.quoted_unit_price), fulfilled: n(y.fulfilled), remaining: n(y.remaining) })),
  }))
}

export async function createOrder(b: string, customerId: string, items: { productId: string; quantity: number }[], expected: string | null, note: string, key: string) {
  if (isDemoMode) return demo.demoCreateOrder(b, customerId, items, expected, note, key).error
  return msg((await db().rpc('create_sales_order', { p_business: b, p_customer: customerId, p_items: items.map((x) => ({ product_id: x.productId, quantity: x.quantity })), p_expected: expected, p_note: note || null, p_key: key })).error)
}
export async function fulfilOrder(b: string, id: string, locationId: string, lines: { lineId: string; quantity: number }[], payments: { method: string; amount: number }[], key: string) {
  if (isDemoMode) return demo.demoFulfilOrder(b, id, locationId, lines, payments, key).error
  return msg((await db().rpc('fulfil_sales_order', { p_order: id, p_location: locationId, p_lines: lines.map((x) => ({ line_id: x.lineId, quantity: x.quantity })), p_payments: payments.map((p) => ({ method: p.method, amount: p.amount, status: 'successful' })), p_key: key })).error)
}
export async function cancelOrder(b: string, id: string, reason: string, key: string) {
  if (isDemoMode) return demo.demoCancelOrder(b, id, reason, key)
  return msg((await db().rpc('cancel_sales_order', { p_order: id, p_reason: reason, p_key: key })).error)
}
