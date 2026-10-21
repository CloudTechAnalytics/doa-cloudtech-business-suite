import * as ph from '@/demo/demoPharmacy'
import type { BatchEvent, BatchRow, Classification, DisposeReason, MedicineInput, MedicineRow, PharmacyOverview, PharmSettings, ReceiveItem, RxInput, RxRow, RxStatus } from '@/demo/demoPharmacy'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** Pharmacy data access. Live mode reads row-level-secured views and calls database functions; demo mode runs the browser mirror.
 *  Mutations return an error message or null. */
export type { BatchEvent, BatchRow, Classification, DisposeReason, MedicineInput, MedicineRow, PharmacyOverview, PharmSettings, ReceiveItem, RxInput, RxRow, RxStatus }
export { CLASSIFICATIONS, DISPOSE_REASONS, DOSAGE_FORMS } from '@/demo/demoPharmacy'

const n = (v: unknown) => Number(v ?? 0)
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const msg = (e: { message: string } | null) => e?.message ?? null
const db = () => supabase!
const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : null)

export const CLASS_LABEL: Record<string, string> = { otc: 'Over the counter', prescription_only: 'Prescription only', controlled: 'Controlled', device: 'Medical device', general: 'General product' }

// ---------------------------------------------------------------- medicines
export async function loadMedicines(b: string): Promise<MedicineRow[]> {
  if (isDemoMode) return ph.demoMedicines(b)
  const r = await db().from('pharmacy_medicines').select('*').eq('business_id', b).order('name')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({
    id: x.id!, name: x.name!, sku: x.sku, barcode: x.barcode, categoryId: x.category_id, categoryName: x.category_name, brand: x.brand, unit: x.unit_code!, costPrice: nn(x.cost_price), price: n(x.selling_price), wholesale: nn(x.wholesale_price),
    reorder: nn(x.reorder_level), supplierId: x.preferred_supplier_id, trackExpiry: true, active: x.status === 'active', onHand: n(x.on_hand), avgCost: nn(x.avg_cost), stockValue: n(x.stock_value), low: !!x.low_stock, out: !!x.out_of_stock,
    packs: ((x.packs ?? []) as { name: string; units: number }[]).map((k) => ({ name: k.name, units: n(k.units) })), nextExpiry: dateOnly(x.next_expiry),
    genericName: x.generic_name, activeIngredient: x.active_ingredient, strength: x.strength, dosageForm: x.dosage_form ?? 'other', manufacturer: x.manufacturer, registrationNo: x.registration_no, classification: (x.classification ?? 'otc') as Classification,
    storage: x.storage, maxStock: nn(x.max_stock), saleable: n(x.saleable), quarantined: n(x.quarantined_qty), expired: n(x.expired_qty), undated: n(x.undated_qty),
  }))
}

export async function saveMedicine(b: string, v: MedicineInput, key: string) {
  if (isDemoMode) return ph.demoSaveMedicine(b, v, key).error
  return msg((await db().rpc('pharmacy_save_medicine', {
    p_business: b, p_id: v.id, p_name: v.name, p_sku: v.sku || null, p_barcode: v.barcode || null, p_category: v.categoryId, p_unit_code: v.unit, p_cost: v.cost, p_price: v.price, p_reorder: v.reorder, p_supplier: v.supplierId, p_active: v.active,
    p_packs: v.packs.map((k) => ({ name: k.name, units: k.units })),
    p_profile: { generic_name: v.genericName, brand: v.brand, active_ingredient: v.activeIngredient, strength: v.strength, dosage_form: v.dosageForm, manufacturer: v.manufacturer, registration_no: v.registrationNo, classification: v.classification, storage: v.storage, max_stock: v.maxStock },
    p_key: key,
  })).error)
}

// ------------------------------------------------------------------ batches
export async function loadBatches(b: string): Promise<BatchRow[]> {
  if (isDemoMode) return ph.demoBatches(b)
  const r = await db().from('pharmacy_batches').select('*').eq('business_id', b).order('expires_on', { nullsFirst: false })
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({
    id: x.id!, productId: x.product_id!, productName: x.product_name!, batchNumber: x.batch_number, quantity: n(x.quantity), remaining: n(x.remaining), receivedOn: dateOnly(x.received_on)!, manufacturedOn: dateOnly(x.manufactured_on), expiresOn: dateOnly(x.expires_on),
    status: x.status as BatchRow['status'], statusReason: x.status_reason, locationId: x.location_id, locationName: x.location_name, supplierId: x.supplier_id, supplierName: x.supplier_name, daysLeft: nn(x.days_left), expiryStatus: x.expiry_status as BatchRow['expiryStatus'], value: n(x.value),
  }))
}
export async function loadBatchEvents(b: string, lotId: string): Promise<BatchEvent[]> {
  if (isDemoMode) return ph.demoBatchEvents(b, lotId)
  const r = await db().from('pharmacy_batch_events').select('*').eq('lot_id', lotId).order('created_at', { ascending: false })
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ id: x.id, businessId: b, lotId, event: x.event as BatchEvent['event'], quantity: n(x.quantity), reason: x.reason, at: x.created_at, by: x.actor }))
}
export async function setBatchStatus(b: string, lotId: string, status: 'active' | 'quarantined', reason: string, batch?: string, expiry?: string | null) {
  if (isDemoMode) return ph.demoSetBatchStatus(b, lotId, status, reason, batch, expiry)
  return msg((await db().rpc('pharmacy_set_batch_status', { p_lot: lotId, p_status: status, p_reason: reason, p_batch: batch || null, p_expiry: expiry || null })).error)
}
export async function completeBatch(b: string, lotId: string, batch: string, expiry: string | null) {
  if (isDemoMode) return ph.demoCompleteBatch(b, lotId, batch, expiry)
  return msg((await db().rpc('pharmacy_complete_batch', { p_lot: lotId, p_batch: batch || null, p_expiry: expiry })).error)
}
export async function disposeBatch(b: string, lotId: string, qty: number, reason: DisposeReason, notes: string, key: string) {
  if (isDemoMode) return ph.demoDisposeBatch(b, lotId, qty, reason, notes, key).error
  return msg((await db().rpc('pharmacy_dispose_batch', { p_lot: lotId, p_qty: qty, p_reason: reason, p_notes: notes || null, p_key: key })).error)
}

// ---------------------------------------------------------------- receiving
export async function receiveGoods(b: string, v: { locationId: string; purchaseId: string | null; supplierId: string | null; invoice: string; items: ReceiveItem[] }, key: string) {
  if (isDemoMode) return ph.demoReceiveGoods(b, v, key).error
  return msg((await db().rpc('pharmacy_receive_goods', {
    p_business: b, p_location: v.locationId, p_purchase: v.purchaseId, p_supplier: v.supplierId, p_invoice: v.invoice || null, p_key: key,
    p_items: v.items.map((i) => ({ product_id: i.productId, pack: i.pack ?? null, received: i.received, rejected: i.rejected ?? 0, rejection_reason: i.reason ?? null, unit_cost: i.unitCost, batch: i.batch, expiry: i.expiry, manufactured: i.manufactured ?? null })),
  })).error)
}

// ------------------------------------------------------------ prescriptions
export async function loadPrescriptions(b: string): Promise<RxRow[]> {
  if (isDemoMode) return ph.demoPrescriptions(b)
  const r = await db().from('pharmacy_prescription_list').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(300)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({
    id: x.id!, businessId: b, number: x.rx_number!, customerId: x.customer_id, customerName: x.customer_name, patient: x.patient_name!, prescriber: x.prescriber_name!, licence: x.prescriber_licence, prescribedOn: dateOnly(x.prescribed_on)!, validUntil: dateOnly(x.valid_until)!,
    refills: n(x.refills_allowed), status: x.status as RxStatus, effectiveStatus: x.effective_status as RxRow['effectiveStatus'], notes: x.notes, reviewNote: x.review_note, reviewedBy: x.reviewed_by, reviewedAt: x.reviewed_at, createdBy: x.created_by, createdAt: x.created_at!,
    items: ((x.items ?? []) as { id: string; product_id: string; prescribed: number; dispensed: number; directions: string | null }[]).map((i) => ({ id: i.id, productId: i.product_id, prescribed: n(i.prescribed), dispensed: n(i.dispensed), directions: i.directions })),
  }))
}
export async function savePrescription(b: string, v: RxInput, key: string) {
  if (isDemoMode) return ph.demoSavePrescription(b, v, key).error
  return msg((await db().rpc('pharmacy_save_prescription', {
    p_business: b, p_id: v.id, p_customer: v.customerId, p_patient: v.patient, p_prescriber: v.prescriber, p_licence: v.licence || null, p_prescribed_on: v.prescribedOn, p_valid_until: v.validUntil, p_refills: v.refills, p_notes: v.notes || null,
    p_items: v.items.map((i) => ({ product_id: i.productId, quantity: i.quantity, directions: i.directions || null })), p_submit: v.submit, p_key: key,
  })).error)
}
export async function submitPrescription(b: string, id: string) {
  if (isDemoMode) return ph.demoSubmitPrescription(b, id)
  return msg((await db().rpc('pharmacy_submit_prescription', { p_rx: id })).error)
}
export async function reviewPrescription(b: string, id: string, decision: 'approve' | 'reject', note: string) {
  if (isDemoMode) return ph.demoReviewPrescription(b, id, decision, note)
  return msg((await db().rpc('pharmacy_review_prescription', { p_rx: id, p_decision: decision, p_note: note || null })).error)
}
export async function cancelPrescription(b: string, id: string, reason: string) {
  if (isDemoMode) return ph.demoCancelPrescription(b, id, reason)
  return msg((await db().rpc('pharmacy_cancel_prescription', { p_rx: id, p_reason: reason })).error)
}
export async function dispense(b: string, rxId: string, locationId: string, items: { itemId: string; quantity: number }[], payments: { method: string; amount: number }[], key: string) {
  if (isDemoMode) return ph.demoDispense(b, rxId, locationId, items, payments, key).error
  return msg((await db().rpc('pharmacy_dispense', { p_rx: rxId, p_location: locationId, p_items: items.map((i) => ({ item_id: i.itemId, quantity: i.quantity })), p_payments: payments, p_key: key })).error)
}

// ----------------------------------------------------------------- settings
export async function loadSettings(b: string): Promise<PharmSettings> {
  if (isDemoMode) return ph.demoSettings(b)
  const r = await db().from('pharmacy_settings').select('*').eq('business_id', b).maybeSingle()
  if (r.error) throw new Error(r.error.message)
  const x = r.data
  return x ? { businessType: x.business_type, licence: x.licence_number, superintendent: x.superintendent_name, warning: n(x.expiry_warning_days), alert: n(x.expiry_alert_days), critical: n(x.expiry_critical_days) } : { businessType: 'community_pharmacy', licence: null, superintendent: null, warning: 180, alert: 90, critical: 30 }
}
export async function saveSettings(b: string, v: PharmSettings) {
  if (isDemoMode) return ph.demoSaveSettings(b, v)
  return msg((await db().rpc('pharmacy_save_settings', { p_business: b, p_type: v.businessType, p_licence: v.licence, p_superintendent: v.superintendent, p_warning: v.warning, p_alert: v.alert, p_critical: v.critical })).error)
}

// ----------------------------------------------------------------- overview
export async function loadOverview(b: string, from: string, to: string): Promise<PharmacyOverview> {
  if (isDemoMode) return ph.demoPharmacyOverview(b, from, to)
  const { data, error } = await db().rpc('pharmacy_overview', { p_business: b, p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  const x = data as Record<string, unknown> & { financial: Record<string, unknown> | null }
  const f = x.financial
  const list = <T,>(v: unknown) => (v ?? []) as T[]
  return {
    transactions: n(x.transactions), unitsSold: n(x.units_sold), avgTransaction: nn(x.avg_transaction), lowStock: n(x.low_stock), outOfStock: n(x.out_of_stock), expiringLots: n(x.expiring_lots), expiredLots: n(x.expired_lots), openShifts: n(x.open_shifts),
    daily: list<{ day: string; net_sales: number; sales: number }>(x.daily).map((d) => ({ day: d.day, netSales: n(d.net_sales), sales: n(d.sales) })),
    bestSellers: list<{ product: string; units: number; revenue: number }>(x.best_sellers).map((d) => ({ product: d.product, units: n(d.units), revenue: n(d.revenue) })),
    recentSales: list<{ number: string; at: string; total: number; status: string }>(x.recent_sales).map((d) => ({ number: d.number, at: d.at, total: n(d.total), status: d.status })),
    recentMovements: list<{ product: string; type: string; quantity: number; at: string }>(x.recent_movements).map((d) => ({ product: d.product, type: d.type, quantity: n(d.quantity), at: d.at })),
    slowMovers: list<{ product: string; on_hand: number; value: number }>(x.slow_movers).map((d) => ({ product: d.product, onHand: n(d.on_hand), value: n(d.value) })),
    financial: f ? {
      netSales: n(f.net_sales), discounts: n(f.discounts), refunds: n(f.refunds), cogs: n(f.cogs), grossProfit: n(f.gross_profit), grossMarginPercent: nn(f.gross_margin_percent), operatingExpenses: n(f.operating_expenses), operatingProfitEstimate: n(f.operating_profit_estimate),
      inventoryValue: n(f.inventory_value), supplierBalances: n(f.supplier_balances), customerBalances: n(f.customer_balances), shiftVariance: n(f.shift_variance),
      byCategory: list<{ category: string; units: number; revenue: number }>(f.by_category).map((d) => ({ category: d.category, units: n(d.units), revenue: n(d.revenue) })),
      byCashier: list<{ cashier: string; sales: number; net_sales: number }>(f.by_cashier).map((d) => ({ cashier: d.cashier, sales: n(d.sales), netSales: n(d.net_sales) })),
      paymentMethods: list<{ method: string; amount: number }>(f.payment_methods).map((d) => ({ method: d.method, amount: n(d.amount) })),
    } : null,
    expiredUnits: n(x.expired_units), expiredValue: nn(x.expired_value), quarantinedBatches: n(x.quarantined_batches), undatedBatches: n(x.undated_batches), expiringCritical: n(x.expiring_critical), expiringAlert: n(x.expiring_alert), expiringWatch: n(x.expiring_watch),
    pendingOrders: n(x.pending_orders), rxAwaitingReview: nn(x.rx_awaiting_review), rxReady: nn(x.rx_ready_to_dispense),
  }
}
