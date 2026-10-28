import { useSyncExternalStore } from 'react'
import { priceCart, refundForReturn } from '@/modules/sales/pricing'
import { rolePermissions } from '@/core/permissions/roles'
import { cloneInv, commitInv, getInv, newId, postMovement } from '@/demo/demoInventory'
import type { Inv } from '@/demo/demoInventory'
import { demoModuleStatuses, demoRoleIn, getDemoState } from '@/demo/demoStore'
import { demoUsageCheck, monthStart, registerUsageCounter } from '@/demo/demoUsage'

/**
 * Browser-only customers, suppliers, sales, payments, returns and purchasing for demo mode.
 * Mirrors the rules of supabase/migrations/20261021000004_sales_purchasing.sql (same server-side pricing,
 * payment caps, credit limits, eligible-return checks, goods-receipt-only stock increases, idempotency).
 */
export interface DCustomer { id: string; businessId: string; name: string; phone: string | null; email: string | null; source: string | null; category: string | null; creditLimit: number; createdAt: string; company?: string | null; contactPerson?: string | null; city?: string | null; address?: string | null; notes?: string | null }
export interface DSupplier { id: string; businessId: string; name: string; phone: string | null; contactName?: string | null; email?: string | null; address?: string | null }
export interface DPayment { by?: string | null; id: string; businessId: string; saleId: string | null; purchaseId: string | null; returnId: string | null; type: 'sale_receipt' | 'refund' | 'purchase_payment'; method: string; amount: number; status: 'pending' | 'successful' | 'reversed'; reference: string | null; at: string }
export interface DSale { by?: string | null; id: string; businessId: string; number: string; locationId: string; customerId: string | null; status: 'posted' | 'refunded' | 'voided'; paymentStatus: 'unpaid' | 'partially_paid' | 'paid'; subtotal: number; discountTotal: number; taxTotal: number; grandTotal: number; amountPaid: number; returnedTotal: number; balanceDue: number; refundDue: number; soldAt: string; voidReason: string | null; /** Cash the customer handed over, and the change given back (kept with the sale; printed on the receipt). */ tendered?: number | null; change?: number | null; /** The sale has a line typed at the till that is not in the product list. */ hasUnlisted?: boolean }
export interface DSaleItem { id: string; saleId: string; productId: string; description: string; quantity: number; unitPrice: number; discount: number; tax: number; total: number; unitCost: number | null; movementId: string | null }
export interface DReturnItem { id: string; returnId: string; saleItemId: string; quantity: number; refund: number; disposition?: 'restock' | 'discard' }
export interface DReturn { id: string; saleId: string; number: string; reason: string; total: number; at?: string }
export interface DPurchase { id: string; businessId: string; number: string; supplierId: string; reference: string | null; status: 'ordered' | 'partially_received' | 'received' | 'cancelled'; paymentStatus: 'unpaid' | 'partially_paid' | 'paid'; total: number; amountPaid: number; at: string }
export interface DPurchaseItem { id: string; purchaseId: string; productId: string; ordered: number; received: number; unitCost: number; lineTotal: number }

interface Trade {
  customers: DCustomer[]; suppliers: DSupplier[]; sales: DSale[]; saleItems: DSaleItem[]; payments: DPayment[]
  returns: DReturn[]; returnItems: DReturnItem[]; purchases: DPurchase[]; purchaseItems: DPurchaseItem[]
  seq: Record<string, number>; keys: Record<string, string>; seeded: string[]
}

const KEY = 'doa.demo.trade.v1'
const empty = (): Trade => ({ customers: [], suppliers: [], sales: [], saleItems: [], payments: [], returns: [], returnItems: [], purchases: [], purchaseItems: [], seq: {}, keys: {}, seeded: [] })
function load(): Trade {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Trade) } } catch { /* fresh */ }
  return empty()
}
let state = load()
registerUsageCounter('customers', (biz) => state.customers.filter((c) => c.businessId === biz).length)
registerUsageCounter('sales_per_month', (biz) => state.sales.filter((s) => s.businessId === biz && s.status !== 'voided' && s.soldAt.slice(0, 10) >= monthStart()).length)
const listeners = new Set<() => void>()
function commit(next: Trade) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
  listeners.forEach((l) => l())
}
export const useDemoTrade = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)
export const getTrade = () => state
export function resetDemoTrade() { commit(empty()) }

export function ensureDemoTrade(businessId: string) {
  if (state.seeded.includes(businessId)) return
  commit({
    ...state,
    seeded: [...state.seeded, businessId],
    customers: [...state.customers, { id: newId('c'), businessId, name: 'Ada Stores', phone: '0803 000 0001', email: 'ada@example.com', source: 'walk-in', category: 'Retailer', creditLimit: 50000, createdAt: new Date().toISOString() }, { id: newId('c'), businessId, name: 'Chidi Foods', phone: null, email: null, source: 'referral', category: 'Wholesale', creditLimit: 0, createdAt: new Date().toISOString() }],
    suppliers: [...state.suppliers, { id: newId('s'), businessId, name: 'Alpha Distributors', phone: '0802 000 0002' }, { id: newId('s'), businessId, name: 'Prime Agro Supplies', phone: null }],
  })
}

// ----------------------------------------------------------------- plumbing
const cents = (n: number) => Math.round(n * 100)
const money = (c: number) => c / 100
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function demoAllowed(businessId: string, module: string, perm: string): boolean {
  return allowed(businessId, module, perm)
}
function allowed(businessId: string, module: string, perm: string): boolean {
  const role = demoRoleIn(businessId)
  return !!role && rolePermissions(role).has(perm) && !!demoModuleStatuses(businessId).find((s) => s.code === module)?.usable
}
export const demoCanTrade = (businessId: string, perm: string) => { const r = demoRoleIn(businessId); return !!r && rolePermissions(r).has(perm) }

type Ctx = { t: Trade; inv: Inv; biz: string }
function run<R>(biz: string, op: string, key: string, module: string, perm: string, fn: (c: Ctx) => R): { error: string | null; result?: R } {
  if (!allowed(biz, module, perm)) return { error: 'permission denied' }
  if (!key || key.length < 8) return { error: 'an idempotency key of at least 8 characters is required' }
  const prev = state.keys[`${biz}|${key}`]
  if (prev) {
    const [o, json] = [prev.slice(0, prev.indexOf('|')), prev.slice(prev.indexOf('|') + 1)]
    return o === op ? { error: null, result: JSON.parse(json) as R } : { error: 'idempotency key already used for another operation' }
  }
  const inv: Inv = cloneInv(getInv())
  const t: Trade = JSON.parse(JSON.stringify(state)) as Trade
  try {
    const result = fn({ t, inv, biz })
    t.keys[`${biz}|${key}`] = `${op}|${JSON.stringify(result ?? null)}`
    commitInv(inv)
    commit(t)
    return { error: null, result }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

const nextNumber = (t: Trade, biz: string, kind: string, prefix: string) => {
  const k = `${biz}|${kind}`
  t.seq[k] = (t.seq[k] ?? 0) + 1
  return `${prefix}-${String(t.seq[k]).padStart(6, '0')}`
}

function recomputeSale(t: Trade, saleId: string) {
  const s = t.sales.find((x) => x.id === saleId)!
  const pays = t.payments.filter((p) => p.saleId === saleId && p.status === 'successful')
  const paid = sum(pays.filter((p) => p.type === 'sale_receipt').map((p) => cents(p.amount)))
  const refunded = sum(pays.filter((p) => p.type === 'refund').map((p) => cents(p.amount)))
  const returned = sum(t.returns.filter((r) => r.saleId === saleId).map((r) => cents(r.total)))
  const amountPaid = paid - refunded
  const net = cents(s.grandTotal) - returned
  s.amountPaid = money(amountPaid); s.returnedTotal = money(returned)
  if (s.status === 'voided') { s.balanceDue = 0; s.refundDue = 0; s.paymentStatus = 'unpaid'; return }
  s.balanceDue = money(Math.max(net - amountPaid, 0)); s.refundDue = money(Math.max(amountPaid - net, 0))
  s.paymentStatus = net - amountPaid <= 0 ? 'paid' : amountPaid > 0 ? 'partially_paid' : 'unpaid'
  s.status = cents(s.grandTotal) > 0 && returned >= cents(s.grandTotal) ? 'refunded' : 'posted'
}

function recomputePurchase(t: Trade, id: string) {
  const p = t.purchases.find((x) => x.id === id)!
  const paid = sum(t.payments.filter((x) => x.purchaseId === id && x.status === 'successful').map((x) => cents(x.amount)))
  p.amountPaid = money(paid)
  p.paymentStatus = paid >= cents(p.total) && p.total > 0 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid'
}

function addPayment(t: Trade, biz: string, spec: { saleId?: string; purchaseId?: string; returnId?: string; type: DPayment['type']; method: string; amount: number; status: 'pending' | 'successful'; reference?: string | null }): DPayment {
  if (!(spec.amount > 0) || cents(spec.amount) / 100 !== spec.amount) throw new Error('payment amount must be positive with at most 2 decimals')
  if (spec.saleId) {
    const s = t.sales.find((x) => x.id === spec.saleId)
    if (!s || s.status === 'voided') throw new Error('sale not found or voided')
    if (spec.type === 'sale_receipt') {
      const pending = spec.status === 'pending' ? sum(t.payments.filter((p) => p.saleId === s.id && p.status === 'pending' && p.type === 'sale_receipt').map((p) => cents(p.amount))) : 0
      const room = cents(s.balanceDue) - pending
      if (cents(spec.amount) > room) throw new Error(`payment exceeds the amount due (${money(room)})`)
    } else if (cents(spec.amount) > cents(s.refundDue)) throw new Error(`refund exceeds the amount paid (${s.refundDue})`)
  } else {
    const p = t.purchases.find((x) => x.id === spec.purchaseId)
    if (!p || p.status === 'cancelled') throw new Error('purchase not found or cancelled')
    const room = cents(p.total) - cents(p.amountPaid)
    if (cents(spec.amount) > room) throw new Error(`payment exceeds the amount due (${money(room)})`)
  }
  const pay: DPayment = { by: getDemoState().userId, id: newId('pay'), businessId: biz, saleId: spec.saleId ?? null, purchaseId: spec.purchaseId ?? null, returnId: spec.returnId ?? null, type: spec.type, method: spec.method, amount: spec.amount, status: spec.status, reference: spec.reference ?? null, at: new Date().toISOString() }
  t.payments.push(pay)
  if (spec.saleId) recomputeSale(t, spec.saleId); else recomputePurchase(t, spec.purchaseId!)
  return pay
}

// -------------------------------------------------------------------- customers & suppliers
export interface CustomerExtras { email?: string; source?: string; category?: string; company?: string; contactPerson?: string; city?: string; address?: string; notes?: string }
const clean = (v: string | undefined) => v?.trim() || null
export function demoCreateCustomer(biz: string, name: string, phone: string, extra: CustomerExtras = {}): string | null {
  if (!allowed(biz, 'customers', 'customers.manage')) return 'permission denied'
  if (!name.trim()) return 'Enter the customer name.'
  const full = demoUsageCheck(biz, 'customers')
  if (full) return full
  commit({ ...state, customers: [...state.customers, { id: newId('c'), businessId: biz, name: name.trim(), phone: phone.trim() || null, email: extra.email?.trim() || null, source: extra.source?.trim() || null, category: extra.category?.trim() || null, creditLimit: 0, createdAt: new Date().toISOString(), company: clean(extra.company), contactPerson: clean(extra.contactPerson), city: clean(extra.city), address: clean(extra.address), notes: clean(extra.notes) }] })
  return null
}
/** Used by the demo CRM when a lead is converted into a new customer. */
/** Edits a customer's details (mirrors an update behind the customers.manage policy). */
export function demoUpdateCustomer(biz: string, id: string, v: { name: string; phone: string; email: string; source: string; category: string } & CustomerExtras): string | null {
  if (!allowed(biz, 'customers', 'customers.manage')) return 'permission denied'
  if (!v.name.trim()) return 'Enter the customer name.'
  if (!state.customers.some((c) => c.id === id && c.businessId === biz)) return 'Customer not found.'
  if ((v.notes ?? '').length > 2000) return 'Notes are limited to 2000 characters.'
  commit({ ...state, customers: state.customers.map((c) => (c.id === id ? { ...c, name: v.name.trim(), phone: clean(v.phone), email: clean(v.email), source: clean(v.source), category: clean(v.category), company: clean(v.company), contactPerson: clean(v.contactPerson), city: clean(v.city), address: clean(v.address), notes: clean(v.notes) } : c)) })
  return null
}

export interface CustomerSummary { orders: number; lifetimeSpend: number; paid: number; firstPurchaseAt: string | null; lastPurchaseAt: string | null }
/** Mirrors the customer_summary view: spend is net of tax and returns, voided sales are left out, and only roles that can read sales see figures. */
export function demoCustomerSummary(biz: string, id: string): CustomerSummary {
  const none: CustomerSummary = { orders: 0, lifetimeSpend: 0, paid: 0, firstPurchaseAt: null, lastPurchaseAt: null }
  if (!allowed(biz, 'sales', 'sales.read')) return none
  const sales = state.sales.filter((s) => s.businessId === biz && s.customerId === id && s.status !== 'voided')
  if (!sales.length) return none
  const at = sales.map((s) => s.soldAt).sort()
  return { orders: sales.length, lifetimeSpend: sales.reduce((a, s) => a + cents(s.grandTotal) - cents(s.taxTotal) - cents(s.returnedTotal), 0) / 100, paid: sales.reduce((a, s) => a + cents(s.amountPaid), 0) / 100, firstPurchaseAt: at[0], lastPurchaseAt: at[at.length - 1] }
}

/** Mirrors customer_top_products(): most-bought products by net revenue. */
export function demoCustomerTopProducts(biz: string, id: string, limit = 5): { product: string; units: number; revenue: number }[] {
  if (!allowed(biz, 'sales', 'sales.read')) return []
  const ids = new Set(state.sales.filter((s) => s.businessId === biz && s.customerId === id && s.status !== 'voided').map((s) => s.id))
  const by = new Map<string, { units: number; revenue: number }>()
  for (const i of state.saleItems.filter((x) => ids.has(x.saleId))) { const cur = by.get(i.description) ?? { units: 0, revenue: 0 }; by.set(i.description, { units: cur.units + i.quantity, revenue: cur.revenue + cents(i.total) - cents(i.tax) }) }
  return [...by].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, limit).map(([product, v]) => ({ product, units: v.units, revenue: v.revenue / 100 }))
}

export function demoInsertCustomer(c: DCustomer) {
  const full = demoUsageCheck(c.businessId, 'customers')
  if (full) throw new Error(full)
  commit({ ...state, customers: [...state.customers, c] })
}
export function demoSetCreditLimit(biz: string, customerId: string, limit: number): string | null {
  if (!allowed(biz, 'customers', 'customers.credit')) return 'permission denied'
  if (!(limit >= 0)) return 'invalid credit limit'
  commit({ ...state, customers: state.customers.map((c) => (c.id === customerId ? { ...c, creditLimit: limit } : c)) })
  return null
}
export function demoUpdateSupplier(biz: string, id: string, v: { name: string; phone: string; contactName: string; email: string; address: string }): string | null {
  if (!allowed(biz, 'suppliers', 'suppliers.manage')) return 'permission denied'
  if (!v.name.trim()) return 'Enter the supplier name.'
  if (!state.suppliers.some((s) => s.id === id && s.businessId === biz)) return 'Supplier not found.'
  commit({ ...state, suppliers: state.suppliers.map((s) => (s.id === id ? { ...s, name: v.name.trim(), phone: v.phone.trim() || null, contactName: v.contactName.trim() || null, email: v.email.trim() || null, address: v.address.trim() || null } : s)) })
  return null
}

export function demoCreateSupplier(biz: string, name: string, phone: string): string | null {
  if (!allowed(biz, 'suppliers', 'suppliers.manage')) return 'permission denied'
  if (!name.trim()) return 'Enter the supplier name.'
  commit({ ...state, suppliers: [...state.suppliers, { id: newId('s'), businessId: biz, name: name.trim(), phone: phone.trim() || null }] })
  return null
}

// ---------------------------------------------------------------------------------- sales
/** Lets an industry refuse a sale line (the pharmacy refuses restricted medicines outside a dispensing). */
export const saleGuard = { check: (_biz: string, _productId: string, _quantity: number, _name: string): void => {} }

export interface SaleLineInput { productId: string; quantity: number; unitPrice?: number; discount?: number; /** A line typed at the till, not in the product list: its name, and the price the cashier typed. */ customName?: string; customPrice?: number; /** A saving the server works out itself (a pack sold at its own price): added to the discount without needing the discount permission. */ systemDiscount?: number }
/** Mirrors unlisted_items_allowed(): owners, admins and managers in a shop or business-apps business, and cashiers only when the owner has allowed it. */
export function demoUnlistedAllowed(biz: string): boolean {
  const b = getDemoState().businesses.find((x) => x.id === biz)
  if (!b || !['retail', 'general'].includes(b.industry) || !demoCanTrade(biz, 'sales.create')) return false
  return demoCanTrade(biz, 'retail.manage') || b.settings?.allow_unlisted_items === true
}
/** The hidden placeholder product that typed lines sit on (mirrors _unlisted_product()). */
export function demoUnlistedProductId(biz: string): string | null { return getInv().products.find((p) => p.businessId === biz && p.sku === 'UNLISTED')?.id ?? null }
function unlistedProduct(inv: Inv, biz: string) {
  const found = inv.products.find((p) => p.businessId === biz && p.sku === 'UNLISTED'); if (found) return found
  const p = { id: newId('p'), businessId: biz, sku: 'UNLISTED', barcode: null, name: 'Unlisted item', unit: 'each', sellingPrice: 0, defaultCost: null, reorderLevel: null, status: 'archived' as const, kind: 'goods' as const, tracksStock: false, categoryId: null }
  inv.products.push(p); return p
}

export interface PaymentInput { method: string; amount: number; status?: 'pending' | 'successful'; reference?: string }

export function demoPostSale(biz: string, locationId: string, customerId: string | null, lines: SaleLineInput[], payments: PaymentInput[], key: string) {
  return run(biz, 'sale_post', key, 'sales', 'sales.create', ({ t, inv }) => {
    if (!inv.locations.some((l) => l.id === locationId && l.businessId === biz)) throw new Error('unknown or inactive location')
    if (customerId && !t.customers.some((c) => c.id === customerId && c.businessId === biz)) throw new Error('unknown customer')
    if (!lines.length || lines.length > 100) throw new Error('a sale needs 1 to 100 lines')
    const full = demoUsageCheck(biz, 'sales_per_month')
    if (full) throw new Error(full)
    const prods = lines.map((l, i) => {
      if (l.customName !== undefined) {
        if (!demoUnlistedAllowed(biz)) throw new Error('selling an item that is not in the product list is not allowed here')
        if (!l.customName.trim() || l.customName.trim().length > 80) throw new Error('the item name can be at most 80 characters')
        if (!(l.quantity > 0)) throw new Error('quantity must be greater than zero')
        if (!(l.customPrice !== undefined && l.customPrice > 0) || Math.round(l.customPrice * 100) / 100 !== l.customPrice) throw new Error(`enter the price of ${l.customName.trim()}, above zero with at most 2 decimals`)
        return unlistedProduct(inv, biz)
      }
      const p = inv.products.find((x) => x.id === l.productId && x.businessId === biz && x.status === 'active')
      if (!p) throw new Error(`invalid product on line ${i + 1}`)
      if (!(l.quantity > 0)) throw new Error('quantity must be greater than zero')
      if (l.unitPrice !== undefined && l.unitPrice !== p.sellingPrice) throw new Error(`the price of ${p.name} has changed to ${p.sellingPrice}; refresh and retry`)
      if ((l.discount ?? 0) > 0 && !demoCanTrade(biz, 'sales.discount')) throw new Error('you are not allowed to give discounts')
      if (p.tracksStock !== false) saleGuard.check(biz, p.id, l.quantity, p.name)
      return p
    })
    let priced
    try {
      const rate = getDemoState().businesses.find((b) => b.id === biz)?.settings?.tax_rate_percent ?? 0
      priced = priceCart(lines.map((l, i) => ({ quantity: l.quantity, unitPrice: l.customName !== undefined ? l.customPrice! : prods[i].sellingPrice, discount: (l.discount ?? 0) + (l.systemDiscount ?? 0) })), rate)
    } catch { throw new Error('invalid discount') }

    const sale: DSale = { by: getDemoState().userId, id: newId('sal'), businessId: biz, number: nextNumber(t, biz, 'sale', 'SAL'), locationId, customerId, status: 'posted', paymentStatus: 'unpaid', subtotal: priced.subtotal, discountTotal: priced.discountTotal, taxTotal: priced.taxTotal, grandTotal: priced.grandTotal, amountPaid: 0, returnedTotal: 0, balanceDue: priced.grandTotal, refundDue: 0, soldAt: new Date().toISOString(), voidReason: null, hasUnlisted: lines.some((x) => x.customName !== undefined) }
    t.sales.push(sale)
    const group = newId('g')
    lines.forEach((l, i) => {
      // A service has no stock: the sale is recorded, nothing moves.
      const m = prods[i].tracksStock === false ? null : postMovement(inv, prods[i], locationId, 'sale', -l.quantity, null, null, group)
      t.saleItems.push({ id: newId('si'), saleId: sale.id, productId: prods[i].id, description: l.customName !== undefined ? l.customName.trim() : prods[i].name, quantity: l.quantity, unitPrice: l.customName !== undefined ? l.customPrice! : prods[i].sellingPrice, discount: priced.lines[i].discount, tax: priced.lines[i].tax, total: priced.lines[i].total, unitCost: m?.unitCost ?? null, movementId: m?.id ?? null })
    })
    for (const p of payments) addPayment(t, biz, { saleId: sale.id, type: 'sale_receipt', method: p.method, amount: p.amount, status: p.status ?? 'successful', reference: p.reference })
    if (sale.balanceDue > 0) {
      if (!customerId) throw new Error('a sale with a balance due needs a customer (credit sale)')
      const limit = t.customers.find((c) => c.id === customerId)!.creditLimit
      const outstanding = sum(t.sales.filter((s) => s.businessId === biz && s.customerId === customerId && s.id !== sale.id && s.status !== 'voided').map((s) => cents(s.balanceDue)))
      if (outstanding + cents(sale.balanceDue) > cents(limit)) throw new Error(`credit limit exceeded: limit ${limit}, outstanding ${money(outstanding)}, this sale adds ${sale.balanceDue}`)
    }
    return { saleId: sale.id, saleNumber: sale.number, grandTotal: sale.grandTotal, balanceDue: sale.balanceDue }
  })
}

export function demoAddPayment(biz: string, saleId: string, p: PaymentInput, key: string) {
  return run(biz, 'sale_payment', key, 'sales', 'sales.create', ({ t }) => ({ paymentId: addPayment(t, biz, { saleId, type: 'sale_receipt', method: p.method, amount: p.amount, status: p.status ?? 'successful', reference: p.reference }).id })).error
}

export function demoConfirmPayment(biz: string, paymentId: string, key: string) {
  return run(biz, 'payment_confirm', key, 'sales', 'sales.create', ({ t }) => {
    const p = t.payments.find((x) => x.id === paymentId)
    if (!p) throw new Error('payment not found')
    if (p.status !== 'pending') throw new Error('only pending payments can be confirmed')
    const s = t.sales.find((x) => x.id === p.saleId)!
    if (cents(p.amount) > cents(s.balanceDue)) throw new Error(`payment exceeds the amount due (${s.balanceDue})`)
    p.status = 'successful'
    recomputeSale(t, s.id)
    return {}
  }).error
}

export function demoReversePayment(biz: string, paymentId: string, reason: string, key: string) {
  const p0 = state.payments.find((x) => x.id === paymentId)
  const perm = p0?.purchaseId ? 'purchases.pay' : p0?.status === 'pending' ? 'sales.create' : 'sales.refund'
  return run(biz, 'payment_reverse', key, p0?.purchaseId ? 'purchases' : 'sales', perm, ({ t }) => {
    if (reason.trim().length < 3) throw new Error('a reason is required')
    const p = t.payments.find((x) => x.id === paymentId)!
    if (p.status === 'reversed') throw new Error('payment already reversed')
    if (p.type === 'refund') throw new Error('refunds cannot be reversed')
    if (p.saleId) {
      const s = t.sales.find((x) => x.id === p.saleId)!
      if (p.status === 'successful' && cents(s.amountPaid) - cents(p.amount) < 0) throw new Error('cannot reverse: refunds already paid out exceed the remaining payments')
    }
    p.status = 'reversed'
    if (p.saleId) recomputeSale(t, p.saleId); else recomputePurchase(t, p.purchaseId!)
    return {}
  }).error
}

export interface ReturnLineInput { saleItemId: string; quantity: number; disposition: 'restock' | 'discard' }
export function demoReturnSale(biz: string, saleId: string, lines: ReturnLineInput[], reason: string, refund: { method: string; amount: number } | null, key: string) {
  return run(biz, 'sale_return', key, 'sales', 'sales.refund', ({ t, inv }) => {
    const s = t.sales.find((x) => x.id === saleId)
    if (!s) throw new Error('sale not found')
    if (s.status === 'voided') throw new Error('a voided sale cannot be returned')
    if (reason.trim().length < 3) throw new Error('a return reason is required')
    if (!lines.length) throw new Error('select at least one item to return')
    const ret: DReturn = { id: newId('ret'), saleId, number: nextNumber(t, biz, 'return', 'RET'), reason, total: 0 }
    const group = newId('g')
    let total = 0
    for (const l of lines) {
      const si = t.saleItems.find((x) => x.id === l.saleItemId && x.saleId === saleId)
      if (!si) throw new Error('item does not belong to this sale')
      if (!(l.quantity > 0)) throw new Error('return quantity must be greater than zero')
      const prior = t.returnItems.filter((r) => r.saleItemId === si.id)
      const priorQty = sum(prior.map((r) => r.quantity)), priorAmt = sum(prior.map((r) => r.refund))
      if (Math.round(l.quantity * 10000) > Math.round((si.quantity - priorQty) * 10000)) throw new Error(`only ${si.quantity - priorQty} of ${si.quantity} remain returnable for ${si.description}`)
      const refundAmt = refundForReturn(si.total, si.quantity, priorQty, priorAmt, l.quantity)
      t.returnItems.push({ id: newId('ri'), returnId: ret.id, saleItemId: si.id, quantity: l.quantity, refund: refundAmt, disposition: l.disposition })
      total += cents(refundAmt)
      if (l.disposition === 'restock' && si.movementId) {
        const p = inv.products.find((x) => x.id === si.productId)!
        postMovement(inv, p, s.locationId, 'return_in', l.quantity, si.unitCost, `Return ${ret.number}`, group)
      }
    }
    ret.total = money(total)
    ret.at = new Date().toISOString()
    t.returns.push(ret)
    recomputeSale(t, saleId)
    if (refund) addPayment(t, biz, { saleId, returnId: ret.id, type: 'refund', method: refund.method, amount: refund.amount, status: 'successful' })
    return { returnId: ret.id, returnNumber: ret.number, total: ret.total }
  })
}

export function demoVoidSale(biz: string, saleId: string, reason: string, key: string) {
  return run(biz, 'sale_void', key, 'sales', 'sales.void', ({ t, inv }) => {
    const s = t.sales.find((x) => x.id === saleId)
    if (!s) throw new Error('sale not found')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    if (s.status !== 'posted') throw new Error('only posted sales can be voided')
    if (t.returns.some((r) => r.saleId === saleId)) throw new Error('a sale with returns cannot be voided')
    if (t.payments.some((p) => p.saleId === saleId && p.status === 'successful')) throw new Error('reverse the successful payments before voiding this sale')
    t.payments.filter((p) => p.saleId === saleId && p.status === 'pending').forEach((p) => { p.status = 'reversed' })
    const group = newId('g')
    for (const si of t.saleItems.filter((x) => x.saleId === saleId && x.movementId)) {
      const mv = inv.movements.find((m) => m.id === si.movementId)!
      const p = inv.products.find((x) => x.id === si.productId)!
      postMovement(inv, p, mv.locationId, 'reversal', -mv.delta, mv.unitCost, `Void ${s.number}`, group, mv.id)
    }
    s.status = 'voided'; s.voidReason = reason
    recomputeSale(t, saleId)
    return {}
  }).error
}

// ------------------------------------------------------------------------------ purchasing
export function demoCreatePurchase(biz: string, supplierId: string, lines: { productId: string; quantity: number; unitCost: number }[], reference: string, key: string) {
  return run(biz, 'purchase_create', key, 'purchases', 'purchases.manage', ({ t, inv }) => {
    if (!t.suppliers.some((s) => s.id === supplierId && s.businessId === biz)) throw new Error('unknown supplier')
    if (!lines.length) throw new Error('a purchase needs 1 to 100 lines')
    let total = 0
    const po: DPurchase = { id: newId('po'), businessId: biz, number: nextNumber(t, biz, 'purchase', 'PO'), supplierId, reference: reference || null, status: 'ordered', paymentStatus: 'unpaid', total: 0, amountPaid: 0, at: new Date().toISOString() }
    for (const l of lines) {
      if (!inv.products.some((p) => p.id === l.productId && p.businessId === biz && p.status === 'active')) throw new Error('invalid product')
      if (!(l.quantity > 0)) throw new Error('quantity must be greater than zero')
      if (!(l.unitCost >= 0)) throw new Error('a unit cost is required')
      const line = Math.round((Math.round(l.quantity * 10000) * cents(l.unitCost)) / 10000)
      total += line
      t.purchaseItems.push({ id: newId('pi'), purchaseId: po.id, productId: l.productId, ordered: l.quantity, received: 0, unitCost: l.unitCost, lineTotal: money(line) })
    }
    po.total = money(total)
    t.purchases.push(po)
    return { purchaseId: po.id, purchaseNumber: po.number, totalAmount: po.total }
  })
}

export function demoReceivePurchase(biz: string, purchaseId: string, locationId: string, lines: { purchaseItemId: string; quantity: number }[], key: string) {
  return run(biz, 'purchase_receive', key, 'purchases', 'purchases.receive', ({ t, inv }) => {
    const po = t.purchases.find((x) => x.id === purchaseId)
    if (!po) throw new Error('purchase not found')
    if (!['ordered', 'partially_received'].includes(po.status)) throw new Error(`purchase is ${po.status} and cannot receive goods`)
    if (!inv.locations.some((l) => l.id === locationId && l.businessId === biz)) throw new Error('unknown or inactive location')
    if (!lines.length) throw new Error('select at least one line to receive')
    const group = newId('g')
    for (const l of lines) {
      const pi = t.purchaseItems.find((x) => x.id === l.purchaseItemId && x.purchaseId === purchaseId)
      if (!pi) throw new Error('line does not belong to this purchase')
      const open = Math.round((pi.ordered - pi.received) * 10000) / 10000
      if (!(l.quantity > 0)) throw new Error('received quantity must be greater than zero')
      if (l.quantity > open) throw new Error(`only ${open} remain to be received on this line`)
      const p = inv.products.find((x) => x.id === pi.productId)!
      postMovement(inv, p, locationId, 'receipt', l.quantity, pi.unitCost, po.number, group)
      pi.received = Math.round((pi.received + l.quantity) * 10000) / 10000
    }
    po.status = t.purchaseItems.filter((x) => x.purchaseId === purchaseId).every((x) => x.received >= x.ordered) ? 'received' : 'partially_received'
    return {}
  }).error
}

/** Records goods received against purchase lines (the stock itself is posted by the caller). Throws before changing anything if a line is invalid. */
export function demoApplyPurchaseReceipt(biz: string, purchaseId: string, lines: { productId: string; quantity: number }[]) {
  const t = getTrade()
  const po = t.purchases.find((x) => x.id === purchaseId && x.businessId === biz)
  if (!po) throw new Error('purchase not found')
  if (!['ordered', 'partially_received'].includes(po.status)) throw new Error(`purchase is ${po.status} and cannot receive goods`)
  const items = t.purchaseItems.filter((x) => x.purchaseId === purchaseId).map((x) => ({ ...x }))
  for (const l of lines) {
    const pi = items.find((x) => x.productId === l.productId)
    if (!pi) throw new Error('that medicine is not on this purchase order')
    const open = Math.round((pi.ordered - pi.received) * 10000) / 10000
    if (l.quantity > open) throw new Error(`only ${open} remain to be received on this line`)
    pi.received = Math.round((pi.received + l.quantity) * 10000) / 10000
  }
  const next = { ...t, purchaseItems: t.purchaseItems.map((x) => items.find((y) => y.id === x.id) ?? x), purchases: t.purchases.map((x) => (x.id === purchaseId ? { ...x, status: items.every((y) => y.received >= y.ordered) ? 'received' as const : 'partially_received' as const } : x)) }
  commit(next)
}

export function demoPayPurchase(biz: string, purchaseId: string, method: string, amount: number, reference: string, key: string) {
  return run(biz, 'purchase_payment', key, 'purchases', 'purchases.pay', ({ t }) => ({ paymentId: addPayment(t, biz, { purchaseId, type: 'purchase_payment', method, amount, status: 'successful', reference }).id })).error
}

export function demoCancelPurchase(biz: string, purchaseId: string, reason: string, key: string) {
  return run(biz, 'purchase_cancel', key, 'purchases', 'purchases.manage', ({ t }) => {
    const po = t.purchases.find((x) => x.id === purchaseId)
    if (!po) throw new Error('purchase not found')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    if (po.status !== 'ordered') throw new Error('only an order with nothing received can be cancelled')
    if (t.payments.some((p) => p.purchaseId === purchaseId && p.status === 'successful')) throw new Error('reverse the supplier payments before cancelling')
    po.status = 'cancelled'
    return {}
  }).error
}

/** For the delete mirror: change this store in one step. */
export function mutateTrade(fn: (s: typeof state) => typeof state) { commit(fn(state)) }

export interface DDaySummary {
  day: string; salesCount: number; gross: number; discounts: number; tax: number; returns: number; outstanding: number; voidedCount: number; voidedTotal: number
  byMethod: { method: string; amount: number }[]; byCashier: { cashier: string; sales: number; total: number }[]; topProducts: { name: string; quantity: number; total: number }[]
}
/** Mirrors sales_day_summary(): one day (UTC here), sales not voided, returns recorded that day, money received that day by method with refunds taken off, who sold what, best sellers. */
export function demoSalesDaySummary(biz: string, day: string): DDaySummary {
  if (!allowed(biz, 'sales', 'sales.read')) throw new Error('permission denied')
  const t = state; const cents = (n: number) => Math.round(n * 100); const back = (n: number) => n / 100
  const on = (iso: string | undefined) => (iso ?? '').slice(0, 10) === day
  const sold = t.sales.filter((s) => s.businessId === biz && s.status !== 'voided' && on(s.soldAt)); const voided = t.sales.filter((s) => s.businessId === biz && s.status === 'voided' && on(s.soldAt))
  const sum = (xs: number[]) => back(xs.reduce((a, x) => a + cents(x), 0))
  const methods = new Map<string, number>()
  for (const p of t.payments.filter((x) => x.businessId === biz && x.status === 'successful' && x.saleId && (x.type === 'sale_receipt' || x.type === 'refund') && on(x.at))) methods.set(p.method, (methods.get(p.method) ?? 0) + cents(p.amount) * (p.type === 'sale_receipt' ? 1 : -1))
  const users = getDemoState().users; const cashiers = new Map<string, { sales: number; total: number }>()
  for (const s of sold) { const name = users.find((u) => u.id === s.by)?.name ?? 'Unknown'; const c = cashiers.get(name) ?? { sales: 0, total: 0 }; cashiers.set(name, { sales: c.sales + 1, total: c.total + cents(s.grandTotal) }) }
  const items = new Map<string, { quantity: number; total: number }>()
  for (const i of t.saleItems.filter((x) => sold.some((s) => s.id === x.saleId))) { const c = items.get(i.description) ?? { quantity: 0, total: 0 }; items.set(i.description, { quantity: c.quantity + i.quantity, total: c.total + cents(i.total) }) }
  return {
    day, salesCount: sold.length, gross: sum(sold.map((s) => s.grandTotal)), discounts: sum(sold.map((s) => s.discountTotal)), tax: sum(sold.map((s) => s.taxTotal)),
    returns: sum(t.returns.filter((r) => on(r.at) && t.sales.some((s) => s.id === r.saleId && s.businessId === biz)).map((r) => r.total)), outstanding: sum(sold.map((s) => s.balanceDue)),
    voidedCount: voided.length, voidedTotal: sum(voided.map((s) => s.grandTotal)),
    byMethod: [...methods].filter(([, a]) => a !== 0).map(([method, a]) => ({ method, amount: back(a) })).sort((x, y) => y.amount - x.amount),
    byCashier: [...cashiers].map(([cashier, v]) => ({ cashier, sales: v.sales, total: back(v.total) })).sort((x, y) => y.total - x.total),
    topProducts: [...items].map(([name, v]) => ({ name, quantity: v.quantity, total: back(v.total) })).sort((x, y) => y.total - x.total).slice(0, 5),
  }
}

/** Mirrors record_sale_tender(): the cash a customer handed over for a sale, which must cover the cash part; the change is the difference. Once only. */
export function demoRecordTender(biz: string, saleId: string, tendered: number): string | null {
  return run(biz, 'sale_tender', 'tender-' + saleId + '-' + Math.random().toString(36).slice(2), 'sales', 'sales.create', ({ t }) => {
    const sale = t.sales.find((s) => s.id === saleId && s.businessId === biz)
    if (!sale) throw new Error('permission denied')
    if (sale.by !== getDemoState().userId && !demoCanTrade(biz, 'sales.void')) throw new Error('permission denied')
    if (!(tendered > 0) || Math.round(tendered * 100) / 100 !== tendered) throw new Error('the cash given must be above zero, with at most 2 decimals')
    const cash = Math.round(t.payments.filter((p) => p.saleId === saleId && p.method === 'cash' && p.type === 'sale_receipt' && p.status === 'successful').reduce((a, p) => a + p.amount * 100, 0)) / 100
    if (cash <= 0) throw new Error('this sale was not paid in cash')
    if (tendered < cash) throw new Error(`the cash given (${tendered}) is less than the cash paid for the sale (${cash})`)
    if (sale.tendered) throw new Error('the cash given was already recorded for this sale')
    sale.tendered = tendered; sale.change = Math.round((tendered - cash) * 100) / 100
    return null
  }).error
}
