import type { IndustryCode } from '@/shared/types/domain'
import { ensureDemoInventory, getInv } from '@/demo/demoInventory'
import { getDemoState } from '@/demo/demoStore'
import * as demo from '@/demo/demoTrade'
import * as martDemo from '@/demo/demoMart'
import { loadInventory } from '@/modules/inventory/inventoryApi'
import type { InventoryData } from '@/modules/inventory/inventoryApi'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** One interface for sales, purchasing, customers and suppliers. Live mode calls the database functions;
 *  demo mode runs the browser mirror. Mutations return an error message or null. */

export interface CustomerDto { id: string; name: string; phone: string | null; creditLimit: number; outstanding: number }
export interface SupplierDto { id: string; name: string; phone: string | null; contactName: string | null; email: string | null; address: string | null }
export interface SaleDto { id: string; number: string; soldAt: string; customerId: string | null; status: string; paymentStatus: string; grandTotal: number; amountPaid: number; balanceDue: number; returnedTotal: number; refundDue: number }
export interface SaleItemDto { id: string; productId: string; description: string; quantity: number; unitPrice: number; discount: number; tax: number; total: number; returnedQty: number }
export interface PaymentDto { id: string; type: string; method: string; amount: number; status: string; reference: string | null; at: string }
export interface SaleDetail { sale: SaleDto; items: SaleItemDto[]; payments: PaymentDto[] }
export interface PurchaseDto { id: string; number: string; supplierId: string; reference: string | null; status: string; paymentStatus: string; total: number; amountPaid: number; at: string }
export interface PurchaseItemDto { id: string; productId: string; ordered: number; received: number; unitCost: number; lineTotal: number }
export interface PurchaseDetail { purchase: PurchaseDto; items: PurchaseItemDto[]; payments: PaymentDto[] }
export interface ReceiptData { business: { name: string; currency: string; address?: string | null; phone?: string | null; footer?: string | null }; cashier?: string | null; tender?: { tendered: number; change: number } | null; sale: { sale_number: string; sold_at: string; subtotal: number; discount_total: number; tax_total: number; grand_total: number; amount_paid: number; balance_due: number; status: string }; customer: { name: string; phone?: string | null } | null; items: { description: string; quantity: number; unit_price: number; discount: number; tax: number; total: number }[]; payments: { method: string; amount: number; status: string; type: string; at: string }[] }

const n = (v: unknown) => Number(v ?? 0)
const msg = (e: { message: string } | null) => e?.message ?? null
const db = () => supabase!

export type { InventoryData }

/** What the till needs, without what the shop pays: asked of the server by someone who may sell but not read the stock tables (a cashier). Cached briefly so the catalog and the packs share one call. */
interface TillRows { units: string[]; categories: { id: string; name: string }[]; locations: { id: string; name: string }[]; products: Record<string, unknown>[]; balances: Record<string, unknown>[]; packs: { product_id: string; name: string; units: number | string; price: number | string | null }[] }
const tillCache = new Map<string, { at: number; rows: Promise<TillRows | null> }>()
function tillRows(businessId: string): Promise<TillRows | null> {
  const hit = tillCache.get(businessId)
  if (hit && Date.now() - hit.at < 4000) return hit.rows
  const rows = (async () => { const r = await db().rpc('till_catalog', { p_business: businessId }); return r.error ? null : (r.data as unknown as TillRows) })()
  tillCache.set(businessId, { at: Date.now(), rows })
  return rows
}
export async function loadCatalog(businessId: string, industry: IndustryCode): Promise<InventoryData> {
  if (!isDemoMode) {
    const inv = await loadInventory(businessId)
    if (inv.products.length > 0) return inv
    // Nothing came back from the stock tables: either there are no products yet, or this person may sell but not read stock. The till list covers the second case.
    const till = await tillRows(businessId)
    if (!till || till.products.length === 0) return inv
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return {
      units: till.units, categories: till.categories, locations: till.locations, movements: [],
      products: till.products.map((x) => ({ id: String(x.id), sku: (x.sku as string | null) ?? null, barcode: (x.barcode as string | null) ?? null, name: String(x.name), unit: String(x.unit ?? ''), sellingPrice: Number(x.selling_price), defaultCost: num(x.default_cost), reorderLevel: num(x.reorder_level), status: x.status as 'active' | 'archived', tracksStock: x.tracks_stock !== false, categoryId: (x.category_id as string | null) ?? null })),
      balances: till.balances.map((x) => ({ productId: String(x.product_id), locationId: String(x.location_id), qty: Number(x.qty), avgCost: num(x.avg_cost) })),
    }
  }
  ensureDemoInventory(businessId, industry)
  demo.ensureDemoTrade(businessId)
  const inv = getInv()
  const bal = Object.entries(inv.balances).filter(([k]) => k.startsWith(`${businessId}|`))
  return {
    units: ['each', 'dozen', 'kg', 'g', 'l', 'ml'],
    categories: (inv.categories ?? []).filter((c) => c.businessId === businessId).map((c) => ({ id: c.id, name: c.name })),
    products: inv.products.filter((p) => p.businessId === businessId).map((p) => ({ id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, unit: p.unit, sellingPrice: p.sellingPrice, defaultCost: p.defaultCost, reorderLevel: p.reorderLevel, status: p.status, tracksStock: p.tracksStock !== false, categoryId: p.categoryId ?? null })),
    locations: inv.locations.filter((l) => l.businessId === businessId).map((l) => ({ id: l.id, name: l.name })),
    balances: bal.map(([k, v]) => { const [, productId, locationId] = k.split('|'); return { productId, locationId, qty: v.qty, avgCost: v.avg } }),
    movements: [],
  }
}

export async function myTradePermissions(businessId: string): Promise<string[]> {
  if (isDemoMode) return ['sales.create', 'sales.discount', 'sales.refund', 'sales.void', 'customers.manage', 'customers.credit', 'suppliers.manage', 'purchases.manage', 'purchases.receive', 'purchases.pay'].filter((p) => demo.demoCanTrade(businessId, p))
  const { data } = await db().rpc('my_permissions', { p_business: businessId })
  return (data as string[] | null) ?? []
}

// ------------------------------------------------------------------- customers & suppliers
export async function listCustomers(businessId: string): Promise<CustomerDto[]> {
  if (isDemoMode) {
    demo.ensureDemoTrade(businessId)
    const t = demo.getTrade()
    return t.customers.filter((c) => c.businessId === businessId).map((c) => ({ id: c.id, name: c.name, phone: c.phone, creditLimit: c.creditLimit, outstanding: t.sales.filter((s) => s.customerId === c.id && s.status !== 'voided').reduce((a, s) => a + s.balanceDue, 0) }))
  }
  const [c, s] = await Promise.all([
    db().from('customers').select('id, name, phone, credit_limit').eq('business_id', businessId).eq('status', 'active').order('name'),
    db().from('sales').select('customer_id, balance_due').eq('business_id', businessId).neq('status', 'voided').not('customer_id', 'is', null),
  ])
  if (c.error) throw new Error(c.error.message)
  return (c.data ?? []).map((x) => ({ id: x.id, name: x.name, phone: x.phone, creditLimit: n(x.credit_limit), outstanding: (s.data ?? []).filter((y) => y.customer_id === x.id).reduce((a, y) => a + n(y.balance_due), 0) }))
}

export async function createCustomer(businessId: string, name: string, phone: string) {
  if (isDemoMode) return demo.demoCreateCustomer(businessId, name, phone)
  return msg((await db().from('customers').insert({ business_id: businessId, name: name.trim(), phone: phone.trim() || null })).error)
}
export async function setCreditLimit(businessId: string, customerId: string, limit: number) {
  if (isDemoMode) return demo.demoSetCreditLimit(businessId, customerId, limit)
  return msg((await db().rpc('set_customer_credit_limit', { p_customer: customerId, p_limit: limit })).error)
}

export async function listSuppliers(businessId: string): Promise<SupplierDto[]> {
  if (isDemoMode) { demo.ensureDemoTrade(businessId); return demo.getTrade().suppliers.filter((s) => s.businessId === businessId).map((s) => ({ id: s.id, name: s.name, phone: s.phone, contactName: s.contactName ?? null, email: s.email ?? null, address: s.address ?? null })) }
  const r = await db().from('suppliers').select('id, name, phone, contact_name, email, address').eq('business_id', businessId).eq('status', 'active').order('name')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((s) => ({ id: s.id, name: s.name, phone: s.phone, contactName: s.contact_name, email: s.email, address: s.address }))
}
export async function createSupplier(businessId: string, name: string, phone: string) {
  if (isDemoMode) return demo.demoCreateSupplier(businessId, name, phone)
  return msg((await db().from('suppliers').insert({ business_id: businessId, name: name.trim(), phone: phone.trim() || null })).error)
}

export async function updateSupplier(businessId: string, id: string, v: { name: string; phone: string; contactName: string; email: string; address: string }) {
  if (isDemoMode) return demo.demoUpdateSupplier(businessId, id, v)
  if (!v.name.trim()) return 'Enter the supplier name.'
  return msg((await db().from('suppliers').update({ name: v.name.trim(), phone: v.phone.trim() || null, contact_name: v.contactName.trim() || null, email: v.email.trim() || null, address: v.address.trim() || null }).eq('id', id).eq('business_id', businessId)).error)
}

// ------------------------------------------------------------------------------------ sales
const saleFromDemo = (s: demo.DSale): SaleDto => ({ id: s.id, number: s.number, soldAt: s.soldAt, customerId: s.customerId, status: s.status, paymentStatus: s.paymentStatus, grandTotal: s.grandTotal, amountPaid: s.amountPaid, balanceDue: s.balanceDue, returnedTotal: s.returnedTotal, refundDue: s.refundDue })
const saleFromRow = (s: Record<string, unknown>): SaleDto => ({ id: String(s.id), number: String(s.sale_number), soldAt: String(s.sold_at), customerId: (s.customer_id as string | null) ?? null, status: String(s.status), paymentStatus: String(s.payment_status), grandTotal: n(s.grand_total), amountPaid: n(s.amount_paid), balanceDue: n(s.balance_due), returnedTotal: n(s.returned_total), refundDue: n(s.refund_due) })

/** Sales, newest first. With a date range (YYYY-MM-DD, both ends included) up to 1000 of that period; without one, the latest 100. */
export async function listSales(businessId: string, range?: { from?: string; to?: string }): Promise<SaleDto[]> {
  const limit = range?.from || range?.to ? 1000 : 100
  if (isDemoMode) return demo.getTrade().sales.filter((s) => s.businessId === businessId && (!range?.from || s.soldAt.slice(0, 10) >= range.from) && (!range?.to || s.soldAt.slice(0, 10) <= range.to)).map(saleFromDemo).reverse().slice(0, limit)
  let q = db().from('sales').select('*').eq('business_id', businessId)
  if (range?.from) q = q.gte('sold_at', `${range.from}T00:00:00`)
  if (range?.to) q = q.lt('sold_at', new Date(new Date(`${range.to}T00:00:00Z`).getTime() + 86400000).toISOString())
  const r = await q.order('sold_at', { ascending: false }).limit(limit)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map(saleFromRow)
}

const payFromDemo = (p: demo.DPayment): PaymentDto => ({ id: p.id, type: p.type, method: p.method, amount: p.amount, status: p.status, reference: p.reference, at: p.at })
const payFromRow = (p: Record<string, unknown>): PaymentDto => ({ id: String(p.id), type: String(p.payment_type), method: String(p.payment_method), amount: n(p.amount), status: String(p.status), reference: (p.provider_reference as string | null) ?? null, at: String(p.received_at ?? p.created_at) })

export async function saleDetail(_businessId: string, saleId: string): Promise<SaleDetail> {
  if (isDemoMode) {
    const t = demo.getTrade()
    const s = t.sales.find((x) => x.id === saleId)!
    return {
      sale: saleFromDemo(s),
      items: t.saleItems.filter((i) => i.saleId === saleId).map((i) => ({ id: i.id, productId: i.productId, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount, tax: i.tax, total: i.total, returnedQty: t.returnItems.filter((r) => r.saleItemId === i.id).reduce((a, r) => a + r.quantity, 0) })),
      payments: t.payments.filter((p) => p.saleId === saleId).map(payFromDemo),
    }
  }
  const [s, i, p, r] = await Promise.all([
    db().from('sales').select('*').eq('id', saleId).single(),
    db().from('sale_items').select('id, sale_id, product_id, description_snapshot, quantity, unit_price, discount_amount, tax_amount, line_total').eq('sale_id', saleId).order('id'),
    db().from('payments').select('*').eq('sale_id', saleId).order('created_at'),
    db().from('sale_return_items').select('sale_item_id, quantity'),
  ])
  if (s.error) throw new Error(s.error.message)
  return {
    sale: saleFromRow(s.data),
    items: (i.data ?? []).map((x) => ({ id: x.id, productId: x.product_id, description: x.description_snapshot, quantity: n(x.quantity), unitPrice: n(x.unit_price), discount: n(x.discount_amount), tax: n(x.tax_amount), total: n(x.line_total), returnedQty: (r.data ?? []).filter((y) => y.sale_item_id === x.id).reduce((a, y) => a + n(y.quantity), 0) })),
    payments: (p.data ?? []).map(payFromRow),
  }
}

export interface CartLineInput { productId: string; quantity: number; unitPrice: number; discount: number; pack?: string | null }
export interface PackDto { productId: string; name: string; units: number; /** The pack's own price, when it has one (cheaper than its units one by one). */ price: number | null }

/** Pack sizes (carton, dozen) for products sold by the pack. Empty for businesses that do not use them. */
export async function loadPacks(b: string): Promise<PackDto[]> {
  if (isDemoMode) { const ids = new Set(martDemo.demoMartProducts(b).map((p) => p.id)); return martDemo.getMart().packs.filter((k) => ids.has(k.productId)).map((k) => ({ productId: k.productId, name: k.name, units: k.units, price: k.price ?? null })) }
  const r = await db().from('product_packs').select('product_id, name, units_per_pack, price').eq('business_id', b)
  if (!r.error && (r.data ?? []).length > 0) return (r.data ?? []).map((k) => ({ productId: k.product_id, name: k.name, units: Number(k.units_per_pack), price: k.price === null || k.price === undefined ? null : Number(k.price) }))
  const till = await tillRows(b)
  return (till?.packs ?? []).map((k) => ({ productId: k.product_id, name: k.name, units: Number(k.units), price: k.price === null || k.price === undefined ? null : Number(k.price) }))
}
export interface TillPayment { method: string; amount: number; status?: 'pending' | 'successful'; reference?: string }

export async function postSale(b: string, locationId: string, customerId: string | null, lines: CartLineInput[], payments: TillPayment[], key: string): Promise<{ saleId?: string; error?: string }> {
  const packed = lines.some((l) => l.pack)
  if (isDemoMode && packed) {
    const r = martDemo.demoMartSale(b, locationId, customerId, lines.map((l) => ({ productId: l.productId, quantity: l.quantity, pack: l.pack ?? null, unitPrice: l.unitPrice, discount: l.discount })), payments, key)
    return r.error ? { error: r.error } : { saleId: r.result!.saleId }
  }
  if (isDemoMode) {
    const r = demo.demoPostSale(b, locationId, customerId, lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount })), payments, key)
    return r.error ? { error: r.error } : { saleId: r.result!.saleId }
  }
  const { data, error } = await db().rpc(packed ? 'mart_post_sale' : 'post_sale', {
    p_business: b, p_location: locationId, p_customer: customerId, p_key: key,
    p_items: lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, unit_price: l.unitPrice, discount_amount: l.discount, ...(packed ? { pack: l.pack ?? null } : {}) })),
    p_payments: payments.map((p) => ({ method: p.method, amount: p.amount, status: p.status ?? 'successful', reference: p.reference ?? null })),
  })
  return error ? { error: error.message } : { saleId: (data as { sale_id: string }).sale_id }
}

export async function addPayment(b: string, saleId: string, p: TillPayment, key: string) {
  if (isDemoMode) return demo.demoAddPayment(b, saleId, p, key)
  return msg((await db().rpc('record_sale_payment', { p_sale: saleId, p_method: p.method, p_amount: p.amount, p_status: p.status ?? 'successful', p_reference: p.reference ?? null, p_key: key })).error)
}
export async function confirmPayment(b: string, paymentId: string, key: string) {
  if (isDemoMode) return demo.demoConfirmPayment(b, paymentId, key)
  return msg((await db().rpc('confirm_payment', { p_payment: paymentId, p_key: key })).error)
}
export async function reversePayment(b: string, paymentId: string, reason: string, key: string) {
  if (isDemoMode) return demo.demoReversePayment(b, paymentId, reason, key)
  return msg((await db().rpc('reverse_payment', { p_payment: paymentId, p_reason: reason, p_key: key })).error)
}
export async function returnSale(b: string, saleId: string, lines: { saleItemId: string; quantity: number; disposition: 'restock' | 'discard' }[], reason: string, refund: { method: string; amount: number } | null, key: string) {
  if (isDemoMode) return demo.demoReturnSale(b, saleId, lines, reason, refund, key).error
  return msg((await db().rpc('return_sale', { p_sale: saleId, p_items: lines.map((l) => ({ sale_item_id: l.saleItemId, quantity: l.quantity, disposition: l.disposition })), p_reason: reason, p_refund: refund, p_key: key })).error)
}
export async function voidSale(b: string, saleId: string, reason: string, key: string) {
  if (isDemoMode) return demo.demoVoidSale(b, saleId, reason, key)
  return msg((await db().rpc('void_sale', { p_sale: saleId, p_reason: reason, p_key: key })).error)
}

export async function receiptData(b: string, saleId: string): Promise<ReceiptData> {
  if (isDemoMode) {
    const d = await saleDetail(b, saleId)
    const t = demo.getTrade()
    const sale = t.sales.find((x) => x.id === saleId)!
    const cust = t.customers.find((c) => c.id === sale.customerId)
    return {
      business: { name: getDemoState().businesses.find((x) => x.id === b)?.name ?? 'Business', currency: 'NGN', address: getDemoState().businesses.find((x) => x.id === b)?.settings?.receipt?.address ?? null, phone: getDemoState().businesses.find((x) => x.id === b)?.settings?.receipt?.phone ?? null, footer: getDemoState().businesses.find((x) => x.id === b)?.settings?.receipt?.footer ?? null },
      cashier: getDemoState().users.find((u) => u.id === sale.by)?.name ?? null,
      tender: sale.tendered ? { tendered: sale.tendered, change: sale.change ?? 0 } : null,
      sale: { sale_number: sale.number, sold_at: sale.soldAt, subtotal: sale.subtotal, discount_total: sale.discountTotal, tax_total: sale.taxTotal, grand_total: sale.grandTotal, amount_paid: sale.amountPaid, balance_due: sale.balanceDue, status: sale.status },
      customer: cust ? { name: cust.name, phone: cust.phone } : null,
      items: d.items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: i.unitPrice, discount: i.discount, tax: i.tax, total: i.total })),
      payments: d.payments.map((p) => ({ method: p.method, amount: p.amount, status: p.status, type: p.type, at: p.at })),
    }
  }
  const { data, error } = await db().rpc('sale_receipt', { p_sale: saleId })
  if (error) throw new Error(error.message)
  return data as ReceiptData
}

// -------------------------------------------------------------------------------- purchasing
export async function listPurchases(businessId: string): Promise<PurchaseDto[]> {
  const fromRow = (p: Record<string, unknown>): PurchaseDto => ({ id: String(p.id), number: String(p.purchase_number), supplierId: String(p.supplier_id), reference: (p.supplier_reference as string | null) ?? null, status: String(p.status), paymentStatus: String(p.payment_status), total: n(p.total_amount), amountPaid: n(p.amount_paid), at: String(p.purchased_at) })
  if (isDemoMode) return demo.getTrade().purchases.filter((p) => p.businessId === businessId).map((p) => ({ id: p.id, number: p.number, supplierId: p.supplierId, reference: p.reference, status: p.status, paymentStatus: p.paymentStatus, total: p.total, amountPaid: p.amountPaid, at: p.at })).reverse()
  const r = await db().from('purchases').select('*').eq('business_id', businessId).order('purchased_at', { ascending: false }).limit(100)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map(fromRow)
}

export async function purchaseDetail(_businessId: string, id: string): Promise<PurchaseDetail> {
  if (isDemoMode) {
    const t = demo.getTrade()
    const p = t.purchases.find((x) => x.id === id)!
    return {
      purchase: { id: p.id, number: p.number, supplierId: p.supplierId, reference: p.reference, status: p.status, paymentStatus: p.paymentStatus, total: p.total, amountPaid: p.amountPaid, at: p.at },
      items: t.purchaseItems.filter((i) => i.purchaseId === id).map((i) => ({ id: i.id, productId: i.productId, ordered: i.ordered, received: i.received, unitCost: i.unitCost, lineTotal: i.lineTotal })),
      payments: t.payments.filter((x) => x.purchaseId === id).map(payFromDemo),
    }
  }
  const [p, i, pay] = await Promise.all([
    db().from('purchases').select('*').eq('id', id).single(),
    db().from('purchase_items').select('*').eq('purchase_id', id).order('id'),
    db().from('payments').select('*').eq('purchase_id', id).order('created_at'),
  ])
  if (p.error) throw new Error(p.error.message)
  const x = p.data
  return {
    purchase: { id: x.id, number: x.purchase_number, supplierId: x.supplier_id, reference: x.supplier_reference, status: x.status, paymentStatus: x.payment_status, total: n(x.total_amount), amountPaid: n(x.amount_paid), at: x.purchased_at },
    items: (i.data ?? []).map((y) => ({ id: y.id, productId: y.product_id, ordered: n(y.quantity_ordered), received: n(y.quantity_received), unitCost: n(y.unit_cost), lineTotal: n(y.line_total) })),
    payments: (pay.data ?? []).map(payFromRow),
  }
}

export async function createPurchase(b: string, supplierId: string, lines: { productId: string; quantity: number; unitCost: number }[], reference: string, key: string) {
  if (isDemoMode) return demo.demoCreatePurchase(b, supplierId, lines, reference, key).error
  return msg((await db().rpc('create_purchase', { p_business: b, p_supplier: supplierId, p_reference: reference || null, p_key: key, p_items: lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, unit_cost: l.unitCost })) })).error)
}
export async function receivePurchase(b: string, purchaseId: string, locationId: string, lines: { purchaseItemId: string; quantity: number }[], key: string) {
  if (isDemoMode) return demo.demoReceivePurchase(b, purchaseId, locationId, lines, key)
  return msg((await db().rpc('receive_purchase', { p_purchase: purchaseId, p_location: locationId, p_note: null, p_key: key, p_lines: lines.map((l) => ({ purchase_item_id: l.purchaseItemId, quantity: l.quantity })) })).error)
}
export async function payPurchase(b: string, purchaseId: string, method: string, amount: number, reference: string, key: string) {
  if (isDemoMode) return demo.demoPayPurchase(b, purchaseId, method, amount, reference, key)
  return msg((await db().rpc('pay_purchase', { p_purchase: purchaseId, p_method: method, p_amount: amount, p_reference: reference || null, p_key: key })).error)
}
export async function cancelPurchase(b: string, purchaseId: string, reason: string, key: string) {
  if (isDemoMode) return demo.demoCancelPurchase(b, purchaseId, reason, key)
  return msg((await db().rpc('cancel_purchase', { p_purchase: purchaseId, p_reason: reason, p_key: key })).error)
}

export interface DaySummary {
  day: string; salesCount: number; gross: number; discounts: number; tax: number; returns: number; outstanding: number; voidedCount: number; voidedTotal: number
  byMethod: { method: string; amount: number }[]; byCashier: { cashier: string; sales: number; total: number }[]; topProducts: { name: string; quantity: number; total: number }[]
}
/** The end-of-day figures for one day: what was sold, handed back, collected and how, what is owed, who sold, and the best sellers. */
export async function daySummary(businessId: string, day: string): Promise<DaySummary> {
  if (isDemoMode) { demo.ensureDemoTrade(businessId); return demo.demoSalesDaySummary(businessId, day) }
  const { data, error } = await db().rpc('sales_day_summary', { p_business: businessId, p_day: day })
  if (error) throw new Error(error.message)
  const x = data as Record<string, unknown>
  const arr = <T,>(v: unknown) => (v as T[] | null) ?? []
  return {
    day: String(x.day).slice(0, 10), salesCount: n(x.sales_count), gross: n(x.gross), discounts: n(x.discounts), tax: n(x.tax), returns: n(x.returns), outstanding: n(x.outstanding), voidedCount: n(x.voided_count), voidedTotal: n(x.voided_total),
    byMethod: arr<{ method: string; amount: number }>(x.by_method).map((m) => ({ method: m.method, amount: n(m.amount) })),
    byCashier: arr<{ cashier: string; sales: number; total: number }>(x.by_cashier).map((c) => ({ cashier: c.cashier, sales: n(c.sales), total: n(c.total) })),
    topProducts: arr<{ name: string; quantity: number; total: number }>(x.top_products).map((p) => ({ name: p.name, quantity: n(p.quantity), total: n(p.total) })),
  }
}

/** Keeps the cash a customer handed over for a sale, so the receipt can show cash given and change. Best effort: the sale itself is already recorded. */
export async function recordSaleTender(saleId: string, tendered: number, businessId: string): Promise<string | null> {
  if (isDemoMode) return demo.demoRecordTender(businessId, saleId, tendered)
  return msg((await db().rpc('record_sale_tender', { p_sale: saleId, p_tendered: tendered })).error)
}
