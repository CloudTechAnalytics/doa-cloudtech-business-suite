import { getInv, newId } from '@/demo/demoInventory'
import { demoRoleIn, getDemoState } from '@/demo/demoStore'
import { demoAllowed, demoCreatePurchase, demoPostSale, getTrade } from '@/demo/demoTrade'

/**
 * Browser-only purchase requests, supplier bills and sales orders for demo mode. Mirrors
 * supabase/migrations/20261021000011_requests_bills_orders.sql: requests need an approver (not the requester, unless the
 * owner), ordering goes through the normal purchase rules, bills are capped by their order and unique per supplier,
 * and a sales order's "fulfilled" is derived from the non-voided sales linked to it.
 */
export interface RequestItem { productId: string; quantity: number; estimatedCost: number | null }
export interface DRequest {
  id: string; businessId: string; number: string; status: 'requested' | 'approved' | 'rejected' | 'ordered' | 'cancelled'; note: string | null
  requestedBy: string | null; requestedAt: string; decidedBy: string | null; decisionNote: string | null; purchaseId: string | null; items: RequestItem[]
}
export interface DBill {
  id: string; businessId: string; supplierId: string; purchaseId: string; number: string; billDate: string; dueDate: string; amount: number
  status: 'open' | 'voided'; voidReason: string | null
}
export interface OrderLine { id: string; productId: string; quantity: number; quotedPrice: number }
export interface DOrder {
  id: string; businessId: string; number: string; customerId: string; status: 'open' | 'cancelled'; expected: string | null; note: string | null
  cancelReason: string | null; createdAt: string; lines: OrderLine[]; saleIds: string[]
}
interface Orders { requests: DRequest[]; bills: DBill[]; orders: DOrder[]; seq: Record<string, number>; keys: Record<string, string> }

const KEY = 'doa.demo.orders.v1'
const empty = (): Orders => ({ requests: [], bills: [], orders: [], seq: {}, keys: {} })
function load(): Orders {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Orders) } } catch { /* fresh */ }
  return empty()
}
let state = load()
function commit(next: Orders) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}
export const getOrders = () => state
export const resetDemoOrders = () => commit(empty())

const cents = (n: number) => Math.round(n * 100)
const money = (c: number) => c / 100
const nowIso = () => new Date().toISOString()
const me = () => getDemoState().userId
const allowedIn = (biz: string, modules: string[], perm: string) => modules.some((m) => demoAllowed(biz, m, perm))
const next = (o: Orders, biz: string, kind: string, prefix: string) => {
  const k = `${biz}|${kind}`
  o.seq[k] = (o.seq[k] ?? 0) + 1
  return `${prefix}-${String(o.seq[k]).padStart(6, '0')}`
}

type Out<R> = { error: string | null; result?: R }
function run<R>(biz: string, op: string, key: string, modules: string[], perm: string, fn: (o: Orders) => R): Out<R> {
  if (!allowedIn(biz, modules, perm)) return { error: 'permission denied' }
  if (!key || key.length < 8) return { error: 'an idempotency key of at least 8 characters is required' }
  const prev = state.keys[`${biz}|${key}`]
  if (prev) {
    const i = prev.indexOf('|')
    return prev.slice(0, i) === op ? { error: null, result: JSON.parse(prev.slice(i + 1)) as R } : { error: 'idempotency key already used for another operation' }
  }
  const o: Orders = JSON.parse(JSON.stringify(state)) as Orders
  try {
    const result = fn(o)
    o.keys[`${biz}|${key}`] = `${op}|${JSON.stringify(result ?? null)}`
    commit(o)
    return { error: null, result }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

const product = (biz: string, id: string) => {
  const p = getInv().products.find((x) => x.id === id && x.businessId === biz)
  if (!p || p.status !== 'active') throw new Error('invalid product')
  return p
}

// ----------------------------------------------------------- purchase requests
const PR = ['farm-purchase-requests']

export function demoCreateRequest(biz: string, items: { productId: string; quantity: number; estimatedCost: number | null }[], note: string, key: string) {
  return run(biz, 'pr_create', key, PR, 'procurement.request', (o) => {
    if (!items.length || items.length > 50) throw new Error('a request needs 1 to 50 lines')
    const seen = new Set<string>()
    for (const it of items) {
      product(biz, it.productId)
      if (!(it.quantity > 0)) throw new Error('quantity must be greater than zero')
      if (it.estimatedCost !== null && it.estimatedCost < 0) throw new Error('estimated cost cannot be negative')
      if (seen.has(it.productId)) throw new Error('each product can appear once per request')
      seen.add(it.productId)
    }
    const r: DRequest = { id: newId('pr'), businessId: biz, number: next(o, biz, 'purchase_request', 'PRQ'), status: 'requested', note: note.trim() || null, requestedBy: me(), requestedAt: nowIso(), decidedBy: null, decisionNote: null, purchaseId: null, items }
    o.requests.push(r)
    return { requestId: r.id, number: r.number }
  })
}

function requestOf(o: Orders, biz: string, id: string) {
  const r = o.requests.find((x) => x.id === id && x.businessId === biz)
  if (!r) throw new Error('request not found')
  return r
}

export function demoDecideRequest(biz: string, id: string, approve: boolean, note: string, key: string) {
  return run(biz, 'pr_decide', key, PR, 'procurement.approve', (o) => {
    const r = requestOf(o, biz, id)
    if (r.status !== 'requested') throw new Error('only a request that is awaiting a decision can be decided')
    if (r.requestedBy === me() && demoRoleIn(biz) !== 'owner') throw new Error('another approver must decide your own request')
    if (!approve && note.trim().length < 3) throw new Error('say why the request is rejected')
    r.status = approve ? 'approved' : 'rejected'; r.decidedBy = me(); r.decisionNote = note.trim() || null
    return { requestId: id, approved: approve }
  }).error
}

export function demoCancelRequest(biz: string, id: string, key: string) {
  return run(biz, 'pr_cancel', key, PR, 'procurement.request', (o) => {
    const r = requestOf(o, biz, id)
    if (!['requested', 'approved'].includes(r.status)) throw new Error('this request can no longer be cancelled')
    if (r.requestedBy !== me() && !demoAllowed(biz, 'farm-purchase-requests', 'procurement.approve')) throw new Error('only the requester or an approver can cancel a request')
    r.status = 'cancelled'
    return { requestId: id }
  }).error
}

export function demoOrderRequest(biz: string, id: string, supplierId: string, key: string) {
  return run(biz, 'pr_order', key, PR, 'procurement.approve', (o) => {
    const r = requestOf(o, biz, id)
    if (r.status !== 'approved') throw new Error('only an approved request can be ordered')
    const lines = r.items.map((it) => {
      const p = product(biz, it.productId)
      const unitCost = it.estimatedCost ?? p.defaultCost
      if (unitCost === null) throw new Error(`a unit cost is required for ${p.name}`)
      return { productId: it.productId, quantity: it.quantity, unitCost }
    })
    const po = demoCreatePurchase(biz, supplierId, lines, r.number, `${key}:po`)
    if (po.error) throw new Error(po.error)
    r.status = 'ordered'; r.purchaseId = po.result!.purchaseId
    return { requestId: id, purchaseId: r.purchaseId, number: po.result!.purchaseNumber }
  })
}

// ------------------------------------------------------------- supplier bills
const SB = ['farm-supplier-bills']
const today = () => new Date().toISOString().slice(0, 10)

export function demoRecordBill(biz: string, v: { purchaseId: string; number: string; billDate: string; dueDate: string; amount: number }, key: string) {
  return run(biz, 'bill_record', key, SB, 'purchases.pay', (o) => {
    const pu = getTrade().purchases.find((p) => p.id === v.purchaseId && p.businessId === biz)
    if (!pu || pu.status === 'cancelled') throw new Error('purchase order not found or cancelled')
    if (!v.number.trim()) throw new Error("enter the supplier's bill number")
    if (!(v.amount > 0) || cents(v.amount) !== Math.round(cents(v.amount))) throw new Error('amount must be positive with at most 2 decimals')
    if (!v.billDate || !v.dueDate || v.dueDate < v.billDate) throw new Error('the due date cannot be before the bill date')
    const billed = o.bills.filter((b) => b.purchaseId === v.purchaseId && b.status === 'open').reduce((a, b) => a + cents(b.amount), 0)
    if (billed + cents(v.amount) > cents(pu.total)) throw new Error(`bills for this order would exceed its total: order ${pu.total}, already billed ${money(billed)}`)
    const dup = o.bills.some((b) => b.businessId === biz && b.supplierId === pu.supplierId && b.status === 'open' && b.number.trim().toLowerCase() === v.number.trim().toLowerCase())
    if (dup) throw new Error(`duplicate key: this supplier already has a bill numbered ${v.number.trim()}`)
    const b: DBill = { id: newId('bl'), businessId: biz, supplierId: pu.supplierId, purchaseId: v.purchaseId, number: v.number.trim(), billDate: v.billDate, dueDate: v.dueDate, amount: v.amount, status: 'open', voidReason: null }
    o.bills.push(b)
    return { billId: b.id }
  })
}

export function demoVoidBill(biz: string, id: string, reason: string, key: string) {
  return run(biz, 'bill_void', key, SB, 'purchases.pay', (o) => {
    const b = o.bills.find((x) => x.id === id && x.businessId === biz)
    if (!b) throw new Error('bill not found')
    if (b.status === 'voided') throw new Error('bill is already voided')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    b.status = 'voided'; b.voidReason = reason.trim()
    return { billId: id }
  }).error
}

export interface BillRow extends DBill { supplierName: string; purchaseNumber: string; purchaseTotal: number; purchasePaid: number; paymentStatus: string; overdue: boolean }
export function demoBills(biz: string): BillRow[] {
  const t = getTrade()
  return state.bills.filter((b) => b.businessId === biz).map((b) => {
    const p = t.purchases.find((x) => x.id === b.purchaseId)!
    return { ...b, supplierName: t.suppliers.find((s) => s.id === b.supplierId)?.name ?? 'Unknown', purchaseNumber: p.number, purchaseTotal: p.total, purchasePaid: p.amountPaid, paymentStatus: p.paymentStatus, overdue: b.status === 'open' && p.paymentStatus !== 'paid' && b.dueDate < today() }
  })
}

// --------------------------------------------------------------- sales orders
const SO = ['farm-sales-orders']

export function demoCreateOrder(biz: string, customerId: string, items: { productId: string; quantity: number }[], expected: string | null, note: string, key: string) {
  return run(biz, 'so_create', key, SO, 'sales.create', (o) => {
    if (!getTrade().customers.some((c) => c.id === customerId && c.businessId === biz)) throw new Error('unknown customer')
    if (!items.length || items.length > 50) throw new Error('an order needs 1 to 50 lines')
    const seen = new Set<string>()
    const lines: OrderLine[] = items.map((it) => {
      const p = product(biz, it.productId)
      if (!(it.quantity > 0)) throw new Error('quantity must be greater than zero')
      if (seen.has(it.productId)) throw new Error('each product can appear once per order')
      seen.add(it.productId)
      return { id: newId('sl'), productId: it.productId, quantity: it.quantity, quotedPrice: p.sellingPrice }
    })
    const ord: DOrder = { id: newId('so'), businessId: biz, number: next(o, biz, 'sales_order', 'SO'), customerId, status: 'open', expected, note: note.trim() || null, cancelReason: null, createdAt: nowIso(), lines, saleIds: [] }
    o.orders.push(ord)
    return { orderId: ord.id, number: ord.number }
  })
}

export interface OrderLineStatus extends OrderLine { fulfilled: number; remaining: number }
export interface OrderRow extends Omit<DOrder, 'lines'> { derivedStatus: 'open' | 'partially_fulfilled' | 'fulfilled' | 'cancelled'; quotedTotal: number; lines: OrderLineStatus[] }

export function demoOrderRows(biz: string): OrderRow[] {
  const t = getTrade()
  return state.orders.filter((o) => o.businessId === biz).map((o) => {
    const live = new Set(o.saleIds.filter((id) => t.sales.find((s) => s.id === id)?.status !== 'voided'))
    const lines = o.lines.map((l) => {
      const fulfilled = t.saleItems.filter((i) => live.has(i.saleId) && i.productId === l.productId).reduce((a, i) => a + i.quantity, 0)
      return { ...l, fulfilled, remaining: l.quantity - fulfilled }
    })
    const derivedStatus = o.status === 'cancelled' ? 'cancelled' : lines.every((l) => l.remaining <= 0) ? 'fulfilled' : lines.some((l) => l.fulfilled > 0) ? 'partially_fulfilled' : 'open'
    return { ...o, lines, derivedStatus, quotedTotal: money(lines.reduce((a, l) => a + cents(l.quantity * l.quotedPrice), 0)) }
  })
}

export function demoFulfilOrder(biz: string, id: string, locationId: string, lines: { lineId: string; quantity: number }[], payments: { method: string; amount: number }[], key: string) {
  return run(biz, 'so_fulfil', key, SO, 'sales.create', (o) => {
    const row = demoOrderRows(biz).find((x) => x.id === id)
    if (!row) throw new Error('order not found')
    if (row.status === 'cancelled') throw new Error('order is cancelled')
    if (!lines.length) throw new Error('select at least one line to deliver')
    const items = lines.map((l) => {
      const ls = row.lines.find((x) => x.id === l.lineId)
      if (!ls) throw new Error('line does not belong to this order')
      if (!(l.quantity > 0)) throw new Error('quantity must be greater than zero')
      if (l.quantity > ls.remaining) throw new Error(`only ${ls.remaining} remain to be delivered on this line`)
      return { productId: ls.productId, quantity: l.quantity }
    })
    const sale = demoPostSale(biz, locationId, row.customerId, items, payments, `${key}:sale`)
    if (sale.error) throw new Error(sale.error)
    o.orders.find((x) => x.id === id)!.saleIds.push(sale.result!.saleId)
    return { saleId: sale.result!.saleId }
  })
}

export function demoCancelOrder(biz: string, id: string, reason: string, key: string) {
  return run(biz, 'so_cancel', key, SO, 'sales.create', (o) => {
    const ord = o.orders.find((x) => x.id === id && x.businessId === biz)
    if (!ord) throw new Error('order not found')
    if (ord.status === 'cancelled') throw new Error('order is already cancelled')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    ord.status = 'cancelled'; ord.cancelReason = reason.trim()
    return { orderId: id }
  }).error
}
