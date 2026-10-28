import * as mart from '@/demo/demoMart'
import type { CashMove, LossReason, MartCategory, MartCount, MartLoss, MartLotRow, MartOverview, MartProductInput, MartProductRow, MartReturn, ShiftSummary } from '@/demo/demoMart'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** Mart data access. Live mode reads row-level-secured views and calls database functions; demo mode runs the browser mirror.
 *  Mutations return an error message or null. */
export type { CashMove, LossReason, MartCategory, MartCount, MartLoss, MartLotRow, MartOverview, MartProductInput, MartProductRow, MartReturn, ShiftSummary }
export { LOSS_REASONS } from '@/demo/demoMart'

const n = (v: unknown) => Number(v ?? 0)
const msg = (e: { message: string } | null) => e?.message ?? null
const db = () => supabase!
const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : null)

// ----------------------------------------------------------------- products
export async function loadProducts(b: string): Promise<MartProductRow[]> {
  if (isDemoMode) return mart.demoMartProducts(b)
  const r = await db().from('mart_products').select('*').eq('business_id', b).order('name')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({
    id: x.id!, name: x.name!, sku: x.sku, barcode: x.barcode, categoryId: x.category_id, categoryName: x.category_name, brand: x.brand, unit: x.unit_code!, costPrice: x.cost_price === null ? null : n(x.cost_price), price: n(x.selling_price),
    wholesale: x.wholesale_price === null ? null : n(x.wholesale_price), reorder: x.reorder_level === null ? null : n(x.reorder_level), supplierId: x.preferred_supplier_id, trackExpiry: !!x.track_expiry, active: x.status === 'active',
    onHand: n(x.on_hand), avgCost: x.avg_cost === null ? null : n(x.avg_cost), stockValue: n(x.stock_value), low: !!x.low_stock, out: !!x.out_of_stock, packs: ((x.packs ?? []) as { name: string; units: number; price?: number | null }[]).map((k) => ({ name: k.name, units: n(k.units), price: k.price === null || k.price === undefined ? null : n(k.price) })), nextExpiry: dateOnly(x.next_expiry),
  }))
}

export async function saveProduct(b: string, v: MartProductInput, key: string) {
  if (isDemoMode) return mart.demoSaveMartProduct(b, v, key).error
  return msg((await db().rpc('mart_save_product', {
    p_business: b, p_id: v.id, p_name: v.name, p_sku: v.sku || null, p_barcode: v.barcode || null, p_category: v.categoryId, p_brand: v.brand || null, p_unit_code: v.unit, p_cost: v.cost, p_price: v.price,
    p_wholesale: v.wholesale, p_reorder: v.reorder, p_supplier: v.supplierId, p_track_expiry: v.trackExpiry, p_active: v.active, p_packs: v.packs.map((k) => ({ name: k.name, units: k.units, price: k.price ?? null })), p_key: key,
  })).error)
}

export async function loadCategories(b: string): Promise<MartCategory[]> {
  if (isDemoMode) { mart.demoMartProducts(b); return mart.getMart().categories.filter((c) => c.businessId === b).sort((a, c) => a.name.localeCompare(c.name)) }
  const r = await db().from('product_categories').select('id, name').eq('business_id', b).order('name')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((c) => ({ id: c.id, businessId: b, name: c.name }))
}

export async function saveCategory(b: string, v: { id: string | null; name: string }) {
  if (isDemoMode) return mart.demoSaveCategory(b, v)
  const name = v.name.trim()
  const res = v.id === null ? await db().from('product_categories').insert({ business_id: b, name }) : await db().from('product_categories').update({ name }).eq('id', v.id).eq('business_id', b)
  if (res.error?.code === '23505') return 'duplicate key: this category already exists'
  return msg(res.error)
}

export async function loadLots(b: string): Promise<MartLotRow[]> {
  if (isDemoMode) { mart.demoMartProducts(b); return mart.demoMartLots(b) }
  const r = await db().from('mart_lot_status').select('*').eq('business_id', b).order('expires_on', { nullsFirst: false })
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ id: x.id!, productId: x.product_id!, productName: x.product_name!, batchNumber: x.batch_number, quantity: n(x.quantity), remaining: n(x.remaining), receivedOn: dateOnly(x.received_on)!, expiresOn: dateOnly(x.expires_on), daysLeft: x.days_left === null ? null : n(x.days_left), status: x.expiry_status as MartLotRow['status'] }))
}

export async function setLot(b: string, lotId: string, batch: string, expiry: string | null) {
  if (isDemoMode) return mart.demoSetLot(b, lotId, batch, expiry)
  return msg((await db().rpc('mart_set_lot', { p_lot: lotId, p_batch: batch || null, p_expiry: expiry })).error)
}

export async function receiveStock(b: string, v: { locationId: string; reference: string; items: { productId: string; quantity: number; pack?: string | null; unitCost: number | null; batch?: string; expiry?: string | null }[] }, key: string) {
  if (isDemoMode) return mart.demoReceiveStock(b, v, key).error
  return msg((await db().rpc('mart_receive_stock', { p_business: b, p_location: v.locationId, p_items: v.items.map((i) => ({ product_id: i.productId, quantity: i.quantity, pack: i.pack ?? null, unit_cost: i.unitCost, batch: i.batch ?? null, expiry: i.expiry ?? null })), p_reference: v.reference || null, p_key: key })).error)
}

// ------------------------------------------------------------------- counts
export interface CountView { id: string; locationId: string; status: 'open' | 'posted'; createdAt: string; items: { productId: string; expected: number; counted: number | null }[] }
export async function loadCounts(b: string): Promise<CountView[]> {
  if (isDemoMode) return mart.getMart().counts.filter((c) => c.businessId === b).slice().reverse()
  const [c, i] = await Promise.all([
    db().from('stock_counts').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(50),
    db().from('stock_count_items').select('*').eq('business_id', b),
  ])
  if (c.error) throw new Error(c.error.message)
  return (c.data ?? []).map((x) => ({ id: x.id, locationId: x.location_id, status: x.status as 'open' | 'posted', createdAt: x.created_at, items: (i.data ?? []).filter((y) => y.stock_count_id === x.id).map((y) => ({ productId: y.product_id, expected: n(y.expected_quantity), counted: y.counted_quantity === null ? null : n(y.counted_quantity) })) }))
}
export async function startCount(b: string, locationId: string, categoryId: string | null, key: string) {
  if (isDemoMode) return mart.demoStartCount(b, locationId, categoryId, key).error
  return msg((await db().rpc('mart_start_count', { p_business: b, p_location: locationId, p_category: categoryId, p_key: key })).error)
}
export async function recordCount(b: string, countId: string, productId: string, counted: number) {
  if (isDemoMode) return mart.demoRecordCount(b, countId, productId, counted)
  return msg((await db().rpc('stock_count_record', { p_count: countId, p_product: productId, p_counted: counted })).error)
}
export async function postCount(b: string, countId: string, key: string) {
  if (isDemoMode) return mart.demoPostCount(b, countId, key).error
  return msg((await db().rpc('stock_count_post', { p_count: countId, p_key: key })).error)
}

// ------------------------------------------------------------------- losses
export async function loadLosses(b: string): Promise<MartLoss[]> {
  if (isDemoMode) { mart.demoMartProducts(b); return mart.getMart().losses.filter((l) => l.businessId === b).slice().reverse() }
  const r = await db().from('stock_loss_records').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(300)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((w) => ({ id: w.id, businessId: b, number: w.loss_number, productId: w.product_id, locationId: w.location_id, quantity: n(w.quantity), reason: w.reason as LossReason, loss: n(w.estimated_loss), notes: w.notes, status: w.status as 'posted' | 'voided', voidReason: w.void_reason, movementId: w.stock_movement_id ?? '', createdAt: w.created_at }))
}
export async function recordLoss(b: string, v: { productId: string; locationId: string; quantity: number; reason: LossReason; notes: string }, key: string) {
  if (isDemoMode) return mart.demoRecordLoss(b, v, key).error
  return msg((await db().rpc('mart_record_loss', { p_business: b, p_product: v.productId, p_location: v.locationId, p_qty: v.quantity, p_reason: v.reason, p_notes: v.notes || null, p_key: key })).error)
}
export async function voidLoss(b: string, id: string, reason: string, key: string) {
  if (isDemoMode) return mart.demoVoidLoss(b, id, reason, key)
  return msg((await db().rpc('mart_void_loss', { p_record: id, p_reason: reason, p_key: key })).error)
}

// ---------------------------------------------------------- supplier returns
export async function loadReturns(b: string): Promise<MartReturn[]> {
  if (isDemoMode) { mart.demoMartProducts(b); return mart.getMart().returns.filter((r) => r.businessId === b).slice().reverse() }
  const [r, i] = await Promise.all([
    db().from('supplier_returns').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(200),
    db().from('supplier_return_items').select('*').eq('business_id', b),
  ])
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ id: x.id, businessId: b, number: x.return_number, supplierId: x.supplier_id, purchaseId: x.purchase_id, locationId: x.location_id, reason: x.reason, totalCredit: n(x.total_credit), createdAt: x.created_at, items: (i.data ?? []).filter((y) => y.return_id === x.id).map((y) => ({ productId: y.product_id, quantity: n(y.quantity), unitCost: n(y.unit_cost) })) }))
}
export async function supplierReturn(b: string, v: { supplierId: string; purchaseId: string | null; locationId: string; items: { productId: string; quantity: number; unitCost: number }[]; reason: string }, key: string) {
  if (isDemoMode) return mart.demoSupplierReturn(b, v, key).error
  return msg((await db().rpc('mart_supplier_return', { p_business: b, p_supplier: v.supplierId, p_purchase: v.purchaseId, p_location: v.locationId, p_items: v.items.map((i) => ({ product_id: i.productId, quantity: i.quantity, unit_cost: i.unitCost })), p_reason: v.reason, p_key: key })).error)
}

// ------------------------------------------------------------------- shifts
export async function loadShifts(b: string): Promise<ShiftSummary[]> {
  if (isDemoMode) { mart.demoMartProducts(b); return mart.demoShiftSummaries(b) }
  const r = await db().from('shift_summary').select('*').eq('business_id', b).order('opened_at', { ascending: false }).limit(200)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({
    id: x.id!, businessId: b, number: x.shift_number!, cashierId: x.cashier_id!, cashierName: x.cashier_name ?? 'Cashier', openedAt: x.opened_at!, openingCash: n(x.opening_cash), closedAt: x.closed_at, counted: x.counted_cash === null ? null : n(x.counted_cash),
    expected: null, variance: x.variance === null ? null : n(x.variance), status: x.status as ShiftSummary['status'], notes: x.notes, reviewedBy: x.reviewed_by, reviewNote: x.review_note, cashSales: n(x.cash_sales), cashRefunds: n(x.cash_refunds),
    movedIn: n(x.moved_in), movedOut: n(x.moved_out), otherMethods: n(x.other_methods), expectedCash: n(x.expected_cash),
  }))
}
export async function loadCashMoves(_b: string, shiftId: string): Promise<CashMove[]> {
  if (isDemoMode) return mart.demoCashMoves(shiftId)
  const r = await db().from('cash_movements').select('*').eq('shift_id', shiftId).order('created_at')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ id: x.id, shiftId, direction: x.direction as 'in' | 'out', amount: n(x.amount), reason: x.reason, at: x.created_at }))
}
export async function openShift(b: string, opening: number, key: string) {
  if (isDemoMode) return mart.demoOpenShift(b, opening, key).error
  return msg((await db().rpc('mart_open_shift', { p_business: b, p_opening: opening, p_key: key })).error)
}
export async function cashMovement(b: string, shiftId: string, direction: 'in' | 'out', amount: number, reason: string, key: string) {
  if (isDemoMode) return mart.demoCashMovement(b, shiftId, direction, amount, reason, key).error
  return msg((await db().rpc('mart_cash_movement', { p_shift: shiftId, p_direction: direction, p_amount: amount, p_reason: reason, p_key: key })).error)
}
export async function deleteShift(b: string, shiftId: string, reason: string) {
  if (isDemoMode) return mart.demoDeleteShift(b, shiftId, reason)
  return msg((await db().rpc('mart_delete_shift', { p_shift: shiftId, p_reason: reason })).error)
}
export async function closeShift(b: string, shiftId: string, counted: number, notes: string, key: string) {
  if (isDemoMode) return mart.demoCloseShift(b, shiftId, counted, notes, key).error
  return msg((await db().rpc('mart_close_shift', { p_shift: shiftId, p_counted: counted, p_notes: notes || null, p_key: key })).error)
}
export async function reviewShift(b: string, shiftId: string, note: string) {
  if (isDemoMode) return mart.demoReviewShift(b, shiftId, note)
  return msg((await db().rpc('mart_review_shift', { p_shift: shiftId, p_note: note || null })).error)
}

// ------------------------------------------------------------------ overview
export async function loadOverview(b: string, from: string, to: string): Promise<MartOverview> {
  if (isDemoMode) return mart.demoMartOverview(b, from, to)
  const { data, error } = await db().rpc('mart_overview', { p_business: b, p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  const x = data as Record<string, unknown> & { financial: Record<string, unknown> | null }
  const f = x.financial
  const list = <T,>(v: unknown) => (v ?? []) as T[]
  return {
    transactions: n(x.transactions), unitsSold: n(x.units_sold), avgTransaction: x.avg_transaction === null ? null : n(x.avg_transaction), lowStock: n(x.low_stock), outOfStock: n(x.out_of_stock), expiringLots: n(x.expiring_lots),
    expiredLots: n(x.expired_lots), openShifts: n(x.open_shifts),
    daily: list<{ day: string; net_sales: number; sales: number }>(x.daily).map((d) => ({ day: d.day, netSales: n(d.net_sales), sales: n(d.sales) })),
    bestSellers: list<{ product: string; units: number; revenue: number }>(x.best_sellers).map((d) => ({ product: d.product, units: n(d.units), revenue: n(d.revenue) })),
    recentSales: list<{ number: string; at: string; total: number; status: string }>(x.recent_sales).map((d) => ({ number: d.number, at: d.at, total: n(d.total), status: d.status })),
    recentMovements: list<{ product: string; type: string; quantity: number; at: string }>(x.recent_movements).map((d) => ({ product: d.product, type: d.type, quantity: n(d.quantity), at: d.at })),
    slowMovers: list<{ product: string; on_hand: number; value: number }>(x.slow_movers).map((d) => ({ product: d.product, onHand: n(d.on_hand), value: n(d.value) })),
    financial: f ? {
      netSales: n(f.net_sales), discounts: n(f.discounts), refunds: n(f.refunds), cogs: n(f.cogs), grossProfit: n(f.gross_profit), grossMarginPercent: f.gross_margin_percent === null ? null : n(f.gross_margin_percent),
      operatingExpenses: n(f.operating_expenses), unlistedSales: n(f.unlisted_sales), unlistedCount: n(f.unlisted_count), stockWriteOffs: n(f.stock_write_offs), countDifference: n(f.count_difference), operatingProfitEstimate: n(f.operating_profit_estimate), inventoryValue: n(f.inventory_value), supplierBalances: n(f.supplier_balances), customerBalances: n(f.customer_balances), shiftVariance: n(f.shift_variance),
      byCategory: list<{ category: string; units: number; revenue: number }>(f.by_category).map((d) => ({ category: d.category, units: n(d.units), revenue: n(d.revenue) })),
      byCashier: list<{ cashier: string; sales: number; net_sales: number }>(f.by_cashier).map((d) => ({ cashier: d.cashier, sales: n(d.sales), netSales: n(d.net_sales) })),
      paymentMethods: list<{ method: string; amount: number }>(f.payment_methods).map((d) => ({ method: d.method, amount: n(d.amount) })),
    } : null,
  }
}
