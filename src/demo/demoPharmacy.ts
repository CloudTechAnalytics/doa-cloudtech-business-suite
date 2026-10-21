import { addDays, r2, r4, today } from '@/demo/demoBakery'
import { cloneInv, commitInv, ensureDemoInventory, getInv, lotForce, newId, postMovement } from '@/demo/demoInventory'
import type { DLot, DProduct, Inv } from '@/demo/demoInventory'
import { demoMartOverview, demoMartProducts, demoRecordLoss, demoSaveMartProduct, getMart, mutateMart, packFactorOf } from '@/demo/demoMart'
import type { MartOverview, MartProductRow } from '@/demo/demoMart'
import { getDemoState } from '@/demo/demoStore'
import { demoAllowed, demoApplyPurchaseReceipt, demoCanTrade, demoPostSale, ensureDemoTrade, getTrade, saleGuard } from '@/demo/demoTrade'

/**
 * Browser-only pharmacy records for demo mode. Mirrors supabase/migrations/20261021000015_pharmacy.sql: medicines carry a dispensing
 * classification, stock is held in batches that never sell when expired, quarantined or undated, restricted medicines leave only
 * through a pharmacist-approved prescription, and goods receipts post only the accepted quantity.
 */
export const CLASSIFICATIONS = ['otc', 'prescription_only', 'controlled', 'device', 'general'] as const
export type Classification = (typeof CLASSIFICATIONS)[number]
export const DOSAGE_FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'cream', 'ointment', 'injection', 'drops', 'inhaler', 'powder', 'suppository', 'device', 'other'] as const
export const DISPOSE_REASONS = ['expired', 'damaged', 'recalled', 'other'] as const
export type DisposeReason = (typeof DISPOSE_REASONS)[number]
export type RxStatus = 'draft' | 'awaiting_review' | 'approved' | 'partially_dispensed' | 'dispensed' | 'rejected' | 'cancelled'

export interface PharmProfile { productId: string; businessId: string; genericName: string | null; activeIngredient: string | null; strength: string | null; dosageForm: string; manufacturer: string | null; registrationNo: string | null; classification: Classification; storage: string | null; maxStock: number | null }
export interface PharmSettings { businessType: string; licence: string | null; superintendent: string | null; warning: number; alert: number; critical: number }
export interface BatchEvent { id: string; businessId: string; lotId: string; event: 'quarantined' | 'released' | 'recalled' | 'disposed' | 'completed'; quantity: number; reason: string; at: string; by: string | null }
export interface GoodsReceipt { id: string; businessId: string; number: string; purchaseId: string | null; supplierId: string | null; locationId: string; invoice: string | null; createdAt: string; items: { productId: string; batch: string; expiry: string; received: number; accepted: number; rejected: number; reason: string | null; unitCost: number | null }[] }
export interface RxItem { id: string; productId: string; prescribed: number; dispensed: number; directions: string | null }
export interface Rx { id: string; businessId: string; number: string; customerId: string | null; patient: string; prescriber: string; licence: string | null; prescribedOn: string; validUntil: string; refills: number; status: RxStatus; notes: string | null; reviewNote: string | null; reviewedBy: string | null; reviewedAt: string | null; createdBy: string | null; createdAt: string; items: RxItem[] }
export interface Dispensing { id: string; businessId: string; rxId: string; saleId: string; by: string | null; at: string; items: { itemId: string; productId: string; quantity: number }[] }
interface Pharm { profiles: PharmProfile[]; settings: Record<string, PharmSettings>; events: BatchEvent[]; receipts: GoodsReceipt[]; prescriptions: Rx[]; dispensings: Dispensing[]; seq: Record<string, number>; keys: Record<string, string>; seeded: string[] }

const KEY = 'doa.demo.pharmacy.v1'
const empty = (): Pharm => ({ profiles: [], settings: {}, events: [], receipts: [], prescriptions: [], dispensings: [], seq: {}, keys: {}, seeded: [] })
function load(): Pharm {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Pharm) } } catch { /* fresh */ }
  return empty()
}
let state = load()
function commit(next: Pharm) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}
export const getPharmacy = () => state
export const resetDemoPharmacy = () => commit(empty())

const me = () => getDemoState().userId
const DEFAULT_SETTINGS: PharmSettings = { businessType: 'community_pharmacy', licence: null, superintendent: null, warning: 180, alert: 90, critical: 30 }
const settingsOf = (biz: string) => state.settings[biz] ?? DEFAULT_SETTINGS
const allowed = (biz: string, module: string, perm: string) => demoAllowed(biz, module, perm)
const nextNumber = (p: Pharm, biz: string, kind: string, prefix: string) => { const k = `${biz}|${kind}`; p.seq[k] = (p.seq[k] ?? 0) + 1; return `${prefix}-${String(p.seq[k]).padStart(6, '0')}` }
const prodOf = (inv: Inv, biz: string, id: string) => inv.products.find((p) => p.id === id && p.businessId === biz)
const deny = (): never => { throw new Error('permission denied') }
const need = (biz: string, module: string, perm: string) => { if (!allowed(biz, module, perm)) deny() }

type Out<R> = { error: string | null; result?: R }
/** Runs an operation against copies of the pharmacy state and the stock ledger and commits both only if every step succeeds. */
function run<R>(biz: string, op: string, key: string | null, fn: (c: { p: Pharm; inv: Inv }) => R): Out<R> {
  try {
    if (key !== null) {
      if (key.length < 8) return { error: 'an idempotency key of at least 8 characters is required' }
      const prev = state.keys[`${biz}|${key}`]
      if (prev) { const i = prev.indexOf('|'); return prev.slice(0, i) === op ? { error: null, result: JSON.parse(prev.slice(i + 1)) as R } : { error: 'idempotency key already used for another operation' } }
    }
    const inv = cloneInv(getInv())
    const p: Pharm = JSON.parse(JSON.stringify(state)) as Pharm
    const result = fn({ p, inv })
    if (key !== null) p.keys[`${biz}|${key}`] = `${op}|${JSON.stringify(result ?? null)}`
    commitInv(inv)
    commit(p)
    return { error: null, result }
  } catch (e) { return { error: (e as Error).message } }
}

// -------------------------------------------------------------- sale guard (mirrors the sale_items trigger)
let dispensing = false
saleGuard.check = (biz, productId, quantity, name) => {
  const f = state.profiles.find((x) => x.productId === productId && x.businessId === biz)
  if (!f) return
  if ((f.classification === 'prescription_only' || f.classification === 'controlled') && !dispensing) throw new Error(`${name} is a restricted medicine and can only be dispensed against an approved prescription`)
  const unit = getInv().products.find((x) => x.id === productId)?.unit
  if ((unit === 'each' || unit === 'dozen') && quantity !== Math.trunc(quantity)) throw new Error(`${name} is sold in whole units`)
}

// ------------------------------------------------------------------ medicines
export interface MedicineInput {
  id: string | null; name: string; sku: string; barcode: string; categoryId: string | null; unit: string; cost: number | null; price: number; reorder: number | null; supplierId: string | null; active: boolean
  packs: { name: string; units: number }[]
  genericName: string; brand: string; activeIngredient: string; strength: string; dosageForm: string; manufacturer: string; registrationNo: string; classification: Classification; storage: string; maxStock: number | null
}
export interface MedicineRow extends MartProductRow {
  genericName: string | null; activeIngredient: string | null; strength: string | null; dosageForm: string; manufacturer: string | null; registrationNo: string | null; classification: Classification; storage: string | null; maxStock: number | null
  saleable: number; quarantined: number; expired: number; undated: number
}

export function demoSaveMedicine(biz: string, v: MedicineInput, key: string): { error: string | null; result?: { productId: string } } {
  if (!allowed(biz, 'pharmacy-products', 'pharmacy.manage')) return { error: 'permission denied' }
  if (v.id === null) { const prev = state.keys[`${biz}|${key}`]; if (prev) return { error: null, result: JSON.parse(prev.slice(prev.indexOf('|') + 1)) } }
  if (!CLASSIFICATIONS.includes(v.classification)) return { error: 'choose a valid classification' }
  if (!(DOSAGE_FORMS as readonly string[]).includes(v.dosageForm)) return { error: 'choose a valid dosage form' }
  if (v.id !== null && !state.profiles.some((f) => f.productId === v.id && f.businessId === biz)) return { error: 'medicine not found' }
  const r = demoSaveMartProduct(biz, { id: v.id, name: v.name, sku: v.sku, barcode: v.barcode, categoryId: v.categoryId, brand: v.brand, unit: v.unit, cost: v.cost, price: v.price, wholesale: null, reorder: v.reorder, supplierId: v.supplierId, trackExpiry: true, active: v.active, packs: v.packs }, `${key}:mart`)
  if (r.error) return { error: r.error }
  const productId = r.result!.productId
  const inv = cloneInv(getInv())
  if (!(inv.pharmacyProducts ??= []).includes(productId)) inv.pharmacyProducts.push(productId)
  commitInv(inv)
  const p: Pharm = JSON.parse(JSON.stringify(state)) as Pharm
  const profile: PharmProfile = { productId, businessId: biz, genericName: v.genericName.trim() || null, activeIngredient: v.activeIngredient.trim() || null, strength: v.strength.trim() || null, dosageForm: v.dosageForm, manufacturer: v.manufacturer.trim() || null, registrationNo: v.registrationNo.trim() || null, classification: v.classification, storage: v.storage.trim() || null, maxStock: v.maxStock }
  const at = p.profiles.findIndex((f) => f.productId === productId)
  if (at >= 0) p.profiles[at] = profile; else p.profiles.push(profile)
  if (v.id === null) p.keys[`${biz}|${key}`] = `pharmacy_medicine_create|${JSON.stringify({ productId })}`
  commit(p)
  return { error: null, result: { productId } }
}

export function demoMedicines(biz: string): MedicineRow[] {
  ensureDemoPharmacy(biz)
  const lots = demoBatches(biz, true)
  return demoMartProducts(biz).filter((m) => state.profiles.some((f) => f.productId === m.id)).map((m) => {
    const f = state.profiles.find((x) => x.productId === m.id)!
    const mine = lots.filter((l) => l.productId === m.id)
    const sum = (xs: BatchRow[]) => r4(xs.reduce((a, l) => a + l.remaining, 0))
    return { ...m, genericName: f.genericName, activeIngredient: f.activeIngredient, strength: f.strength, dosageForm: f.dosageForm, manufacturer: f.manufacturer, registrationNo: f.registrationNo, classification: f.classification, storage: f.storage, maxStock: f.maxStock,
      saleable: sum(mine.filter((l) => l.status === 'active' && l.expiresOn !== null && l.expiresOn >= today())), quarantined: sum(mine.filter((l) => l.status === 'quarantined')), expired: sum(mine.filter((l) => l.status === 'active' && l.expiresOn !== null && l.expiresOn < today())), undated: sum(mine.filter((l) => l.status === 'active' && l.expiresOn === null)) }
  })
}

// -------------------------------------------------------------------- settings
export const demoSettings = (biz: string): PharmSettings => settingsOf(biz)
export function demoSaveSettings(biz: string, v: PharmSettings): string | null {
  return run(biz, 'pharmacy_settings', null, ({ p }) => {
    if (!demoCanTrade(biz, 'pharmacy.manage') || !allowed(biz, 'pharmacy-products', 'pharmacy.manage')) deny()
    const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 730
    if (!ok(v.warning) || !ok(v.alert) || !ok(v.critical) || v.critical > v.alert || v.alert > v.warning) throw new Error('expiry warning periods must go from the shortest (critical) to the longest (watch), each between 1 and 730 days')
    p.settings[biz] = { ...v, licence: v.licence?.trim() || null, superintendent: v.superintendent?.trim() || null }
    return null
  }).error
}

// --------------------------------------------------------------------- batches
export interface BatchRow { id: string; productId: string; productName: string; batchNumber: string | null; quantity: number; remaining: number; receivedOn: string; manufacturedOn: string | null; expiresOn: string | null; status: 'active' | 'quarantined'; statusReason: string | null; locationId: string | null; locationName: string | null; supplierId: string | null; supplierName: string | null; daysLeft: number | null; expiryStatus: 'unknown' | 'expired' | 'critical' | 'warning' | 'watch' | 'ok'; value: number }
export function demoBatches(biz: string, skipEnsure = false): BatchRow[] {
  if (!skipEnsure) ensureDemoPharmacy(biz)
  const inv = getInv(); const s = settingsOf(biz); const t = getTrade()
  return (inv.lots ?? []).filter((l) => l.businessId === biz && l.batchId.startsWith('mv:') && l.remaining > 0 && !l.voided && state.profiles.some((f) => f.productId === l.productId)).map((l) => {
    const days = l.expiresOn ? Math.floor((Date.parse(l.expiresOn) - Date.parse(today())) / 86400000) : null
    const mv = inv.movements.find((m) => `mv:${m.id}` === l.batchId)
    const p = prodOf(inv, biz, l.productId)
    return { id: l.id, productId: l.productId, productName: p?.name ?? '', batchNumber: l.batchNumber ?? null, quantity: l.quantity, remaining: l.remaining, receivedOn: l.producedOn, manufacturedOn: l.manufacturedOn ?? null, expiresOn: l.expiresOn, status: l.status ?? 'active', statusReason: l.statusReason ?? null,
      locationId: l.locationId ?? null, locationName: inv.locations.find((x) => x.id === l.locationId)?.name ?? null, supplierId: l.supplierId ?? null, supplierName: t.suppliers.find((x) => x.id === l.supplierId)?.name ?? null, daysLeft: days,
      expiryStatus: days === null ? 'unknown' as const : days < 0 ? 'expired' as const : days <= s.critical ? 'critical' as const : days <= s.alert ? 'warning' as const : days <= s.warning ? 'watch' as const : 'ok' as const,
      value: r2(l.remaining * (mv?.unitCost ?? p?.defaultCost ?? 0)) }
  }).sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999'))
}
export const demoBatchEvents = (biz: string, lotId?: string) => state.events.filter((e) => e.businessId === biz && (!lotId || e.lotId === lotId))

const lotOf = (inv: Inv, biz: string, lotId: string): DLot => {
  const l = (inv.lots ?? []).find((x) => x.id === lotId && x.businessId === biz && !x.voided)
  if (!l || !state.profiles.some((f) => f.productId === l.productId)) deny()
  return l as DLot
}

export function demoSetBatchStatus(biz: string, lotId: string, status: 'active' | 'quarantined', reason: string, batch?: string, expiry?: string | null): string | null {
  return run(biz, 'pharmacy_batch_status', null, ({ p, inv }) => {
    const l = lotOf(inv, biz, lotId)
    if (!(demoCanTrade(biz, 'pharmacy.manage') || demoCanTrade(biz, 'pharmacy.dispense')) || !allowed(biz, 'pharmacy-batches', 'inventory.read')) deny()
    if (status !== 'active' && status !== 'quarantined') throw new Error('choose quarantine or release')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    const cur = l.status ?? 'active'
    if (status === 'quarantined' && cur === 'quarantined') throw new Error('this batch is already quarantined')
    if (status === 'active') {
      if (cur === 'active') throw new Error('this batch is not quarantined')
      const exp = expiry ?? l.expiresOn
      if (!exp) throw new Error('enter the expiry date before releasing this batch')
      if (exp < today()) throw new Error('an expired batch cannot be released for sale; dispose of it')
      Object.assign(l, { status: 'active', statusReason: null, expiresOn: exp, batchNumber: batch?.trim() || l.batchNumber || null })
    } else Object.assign(l, { status: 'quarantined', statusReason: reason.trim() })
    p.events.push({ id: newId('be'), businessId: biz, lotId, event: status === 'active' ? 'released' : 'quarantined', quantity: l.remaining, reason: reason.trim(), at: new Date().toISOString(), by: me() })
    return null
  }).error
}

export function demoCompleteBatch(biz: string, lotId: string, batch: string, expiry: string | null): string | null {
  return run(biz, 'pharmacy_complete_batch', null, ({ p, inv }) => {
    const l = lotOf(inv, biz, lotId)
    need(biz, 'inventory', 'inventory.adjust')
    if (!expiry) throw new Error('enter the expiry date')
    l.batchNumber = batch.trim() || null; l.expiresOn = expiry
    p.events.push({ id: newId('be'), businessId: biz, lotId, event: 'completed', quantity: l.remaining, reason: 'Batch and expiry recorded', at: new Date().toISOString(), by: me() })
    return null
  }).error
}

export function demoDisposeBatch(biz: string, lotId: string, qty: number, reason: DisposeReason, notes: string, key: string): { error: string | null; result?: { estimatedLoss: number } } {
  const prev = state.keys[`${biz}|${key}`]
  if (prev) return { error: null, result: JSON.parse(prev.slice(prev.indexOf('|') + 1)) }
  const inv0 = getInv()
  const l = (inv0.lots ?? []).find((x) => x.id === lotId && x.businessId === biz && !x.voided)
  if (!l || !state.profiles.some((f) => f.productId === l.productId)) return { error: 'permission denied' }
  if (!allowed(biz, 'pharmacy-batches', 'pharmacy.manage')) return { error: 'permission denied' }
  if (!(DISPOSE_REASONS as readonly string[]).includes(reason)) return { error: 'choose a reason' }
  if (!(qty > 0) || qty > l.remaining) return { error: `quantity must be between 0 and the ${l.remaining} left in this batch` }
  const mapped = reason === 'expired' || reason === 'damaged' ? reason : 'other'
  lotForce.id = lotId
  let res
  try { res = demoRecordLoss(biz, { productId: l.productId, locationId: l.locationId ?? inv0.locations.find((x) => x.businessId === biz)!.id, quantity: qty, reason: mapped, notes: `${reason === 'recalled' || reason === 'other' ? `${reason[0].toUpperCase()}${reason.slice(1)}: ` : ''}${notes} (batch ${l.batchNumber ?? 'unnamed'})` }, `${key}:loss`) } finally { lotForce.id = null }
  if (res.error) return { error: res.error }
  const p: Pharm = JSON.parse(JSON.stringify(state)) as Pharm
  p.events.push({ id: newId('be'), businessId: biz, lotId, event: reason === 'recalled' ? 'recalled' : 'disposed', quantity: qty, reason: `${reason}${notes.trim() ? `: ${notes.trim()}` : ''}`, at: new Date().toISOString(), by: me() })
  const result = { estimatedLoss: res.result!.estimatedLoss }
  p.keys[`${biz}|${key}`] = `pharmacy_dispose|${JSON.stringify(result)}`
  commit(p)
  return { error: null, result }
}

// ------------------------------------------------------------- goods receiving
export interface ReceiveItem { productId: string; pack?: string | null; received: number; rejected?: number; reason?: string; unitCost: number | null; batch: string; expiry: string; manufactured?: string | null }
export function demoReceiveGoods(biz: string, v: { locationId: string; purchaseId: string | null; supplierId: string | null; invoice: string; items: ReceiveItem[] }, key: string) {
  return run(biz, 'pharmacy_receive', key, ({ p, inv }) => {
    need(biz, 'inventory', 'inventory.adjust')
    if (!inv.locations.some((l) => l.id === v.locationId && l.businessId === biz)) throw new Error('unknown or inactive location')
    if (!v.items.length || v.items.length > 200) throw new Error('items must be 1 to 200 lines')
    let supplier = v.supplierId
    if (v.purchaseId) { const po = getTrade().purchases.find((x) => x.id === v.purchaseId && x.businessId === biz); if (!po) throw new Error('purchase not found'); supplier = po.supplierId }
    const number = nextNumber(p, biz, 'pharmacy_grn', 'PGR'); const group = newId('g')
    const rec: GoodsReceipt = { id: newId('grn'), businessId: biz, number, purchaseId: v.purchaseId, supplierId: supplier, locationId: v.locationId, invoice: v.invoice.trim() || null, createdAt: new Date().toISOString(), items: [] }
    const posts: { pr: DProduct; acc: number; cost: number | null; it: ReceiveItem; manufactured: string | null }[] = []
    for (const it of v.items) {
      const pr = prodOf(inv, biz, it.productId)
      if (!pr || pr.status !== 'active' || !state.profiles.some((f) => f.productId === pr.id)) throw new Error('invalid medicine')
      const f = packFactorOf(it.productId, it.pack)
      const recv = r4(it.received * f); const rej = r4((it.rejected ?? 0) * f)
      if (!(recv > 0)) throw new Error('received quantity must be greater than zero')
      if (rej < 0 || rej > recv) throw new Error('rejected quantity cannot be more than received')
      if (rej > 0 && (it.reason ?? '').trim().length < 3) throw new Error(`say why ${pr.name} was rejected`)
      const acc = r4(recv - rej)
      if (!it.expiry) throw new Error(`enter the expiry date for ${pr.name}`)
      if (acc > 0 && it.expiry < today()) throw new Error(`the expiry date for ${pr.name} is in the past; reject expired goods`)
      if (!it.batch.trim()) throw new Error(`enter the batch number for ${pr.name}`)
      if ((pr.unit === 'each' || pr.unit === 'dozen') && (recv !== Math.trunc(recv) || rej !== Math.trunc(rej))) throw new Error(`${pr.name} is received in whole units`)
      const cost = it.unitCost === null ? null : r4(it.unitCost / f)
      if (cost !== null && cost < 0) throw new Error('unit cost cannot be negative')
      rec.items.push({ productId: pr.id, batch: it.batch.trim(), expiry: it.expiry, received: recv, accepted: acc, rejected: rej, reason: (it.reason ?? '').trim() || null, unitCost: cost })
      if (acc > 0) posts.push({ pr, acc, cost, it, manufactured: it.manufactured ?? null })
    }
    if (v.purchaseId && posts.length) {
      const sums = new Map<string, number>(); for (const x of posts) sums.set(x.pr.id, r4((sums.get(x.pr.id) ?? 0) + x.acc))
      demoApplyPurchaseReceipt(biz, v.purchaseId, [...sums].map(([productId, quantity]) => ({ productId, quantity })))
    }
    for (const x of posts) {
      const m = postMovement(inv, x.pr, v.locationId, 'receipt', x.acc, x.cost, v.invoice.trim() || number, group)
      const lot = (inv.lots ?? []).find((l) => l.batchId === `mv:${m.id}`)
      if (lot) Object.assign(lot, { batchNumber: x.it.batch.trim(), expiresOn: x.it.expiry, manufacturedOn: x.manufactured, supplierId: supplier, locationId: v.locationId })
    }
    p.receipts.push(rec)
    return { receiptId: rec.id, receiptNumber: number }
  })
}
export const demoReceipts = (biz: string) => state.receipts.filter((r) => r.businessId === biz).slice().reverse()

// ---------------------------------------------------------------- prescriptions
export interface RxInput { id: string | null; customerId: string | null; patient: string; prescriber: string; licence: string; prescribedOn: string; validUntil: string; refills: number; notes: string; items: { productId: string; quantity: number; directions: string }[]; submit: boolean }
export interface RxRow extends Rx { effectiveStatus: RxStatus | 'expired'; customerName: string | null }
const effective = (r: Rx): RxStatus | 'expired' => (['awaiting_review', 'approved', 'partially_dispensed'].includes(r.status) && r.validUntil < today() ? 'expired' : r.status)

export function demoSavePrescription(biz: string, v: RxInput, key: string) {
  return run(biz, 'pharmacy_rx', v.id === null ? key : null, ({ p, inv }) => {
    need(biz, 'pharmacy-prescriptions', 'pharmacy.rx')
    if (v.patient.trim().length < 2) throw new Error('enter the patient name')
    if (v.prescriber.trim().length < 2) throw new Error('enter the prescriber name')
    if (!v.prescribedOn || !v.validUntil || v.validUntil < v.prescribedOn) throw new Error('the prescription must be valid from its date')
    if (v.prescribedOn > today()) throw new Error('a prescription cannot be dated in the future')
    if (v.customerId && !getTrade().customers.some((c) => c.id === v.customerId && c.businessId === biz)) throw new Error('unknown customer')
    if (!v.items.length || v.items.length > 30) throw new Error('a prescription needs 1 to 30 medicines')
    const seen = new Set<string>()
    for (const it of v.items) {
      if (seen.has(it.productId)) throw new Error('each medicine can appear once on a prescription')
      seen.add(it.productId)
      const pr = prodOf(inv, biz, it.productId)
      if (!pr || pr.status !== 'active' || !p.profiles.some((f) => f.productId === it.productId)) throw new Error('invalid medicine')
      if (!(it.quantity > 0)) throw new Error('prescribed quantity must be greater than zero')
    }
    const items: RxItem[] = v.items.map((it) => ({ id: newId('rxi'), productId: it.productId, prescribed: r4(it.quantity), dispensed: 0, directions: it.directions.trim() || null }))
    if (v.id) {
      const r = p.prescriptions.find((x) => x.id === v.id && x.businessId === biz)
      if (!r) throw new Error('prescription not found')
      if (r.status !== 'draft') throw new Error('only a draft prescription can be edited')
      Object.assign(r, { customerId: v.customerId, patient: v.patient.trim(), prescriber: v.prescriber.trim(), licence: v.licence.trim() || null, prescribedOn: v.prescribedOn, validUntil: v.validUntil, refills: v.refills, notes: v.notes.trim() || null, items, status: v.submit ? 'awaiting_review' : 'draft' })
      return { prescriptionId: r.id, number: r.number }
    }
    const r: Rx = { id: newId('rx'), businessId: biz, number: nextNumber(p, biz, 'pharmacy_rx', 'RX'), customerId: v.customerId, patient: v.patient.trim(), prescriber: v.prescriber.trim(), licence: v.licence.trim() || null, prescribedOn: v.prescribedOn, validUntil: v.validUntil, refills: v.refills, status: v.submit ? 'awaiting_review' : 'draft', notes: v.notes.trim() || null, reviewNote: null, reviewedBy: null, reviewedAt: null, createdBy: me(), createdAt: new Date().toISOString(), items }
    p.prescriptions.push(r)
    return { prescriptionId: r.id, number: r.number }
  })
}

const rxOf = (p: Pharm, biz: string, id: string) => { const r = p.prescriptions.find((x) => x.id === id && x.businessId === biz); if (!r) throw new Error('prescription not found'); return r }

export function demoSubmitPrescription(biz: string, id: string): string | null {
  return run(biz, 'pharmacy_rx_submit', null, ({ p }) => {
    const r = rxOf(p, biz, id); need(biz, 'pharmacy-prescriptions', 'pharmacy.rx')
    if (r.status !== 'draft') throw new Error('only a draft can be submitted for review')
    r.status = 'awaiting_review'
    return null
  }).error
}

export function demoReviewPrescription(biz: string, id: string, decision: 'approve' | 'reject', note: string): string | null {
  return run(biz, 'pharmacy_rx_review', null, ({ p }) => {
    const r = rxOf(p, biz, id); need(biz, 'pharmacy-prescriptions', 'pharmacy.dispense')
    if (r.status !== 'awaiting_review') throw new Error('only a prescription awaiting review can be reviewed')
    if (decision !== 'approve' && decision !== 'reject') throw new Error('choose approve or reject')
    if (r.validUntil < today()) throw new Error('this prescription has expired')
    if (decision === 'reject' && note.trim().length < 3) throw new Error('say why the prescription is rejected')
    Object.assign(r, { status: decision === 'approve' ? 'approved' : 'rejected', reviewNote: note.trim() || null, reviewedBy: me(), reviewedAt: new Date().toISOString() })
    return null
  }).error
}

export function demoCancelPrescription(biz: string, id: string, reason: string): string | null {
  return run(biz, 'pharmacy_rx_cancel', null, ({ p }) => {
    const r = rxOf(p, biz, id); need(biz, 'pharmacy-prescriptions', 'pharmacy.rx')
    if (['dispensed', 'cancelled', 'rejected'].includes(r.status)) throw new Error(`a ${r.status} prescription cannot be cancelled`)
    if (reason.trim().length < 3) throw new Error('a reason is required')
    Object.assign(r, { status: 'cancelled', reviewNote: reason.trim() })
    return null
  }).error
}

export function demoDispense(biz: string, rxId: string, locationId: string, items: { itemId: string; quantity: number }[], payments: { method: string; amount: number }[], key: string): { error: string | null; result?: { dispensingId: string; saleId: string } } {
  const prev = state.keys[`${biz}|${key}`]
  if (prev) { const i = prev.indexOf('|'); return prev.slice(0, i) === 'pharmacy_dispense' ? { error: null, result: JSON.parse(prev.slice(i + 1)) } : { error: 'idempotency key already used for another operation' } }
  if (key.length < 8) return { error: 'an idempotency key of at least 8 characters is required' }
  try {
    const rx = rxOf(state, biz, rxId)
    need(biz, 'pharmacy-prescriptions', 'pharmacy.dispense')
    if (!['approved', 'partially_dispensed'].includes(rx.status)) throw new Error(`this prescription is ${rx.status.replace('_', ' ')} and cannot be dispensed`)
    if (rx.validUntil < today()) throw new Error('this prescription has expired')
    if (!items.length) throw new Error('choose what to dispense')
    const lines = items.map((it) => {
      const pi = rx.items.find((x) => x.id === it.itemId)
      if (!pi) throw new Error('that item is not on this prescription')
      const qty = r4(it.quantity); const left = r4(pi.prescribed - pi.dispensed)
      if (!(qty > 0)) throw new Error('quantity must be greater than zero')
      if (qty > left) throw new Error(`only ${left} remain to be dispensed for this item`)
      return { productId: pi.productId, quantity: qty }
    })
    dispensing = true
    let sale
    try { sale = demoPostSale(biz, locationId, rx.customerId, lines, payments, `${key}:sale`) } finally { dispensing = false }
    if (sale.error) throw new Error(sale.error)
    const p: Pharm = JSON.parse(JSON.stringify(state)) as Pharm
    const r2x = rxOf(p, biz, rxId)
    const d: Dispensing = { id: newId('dsp'), businessId: biz, rxId, saleId: sale.result!.saleId, by: me(), at: new Date().toISOString(), items: [] }
    for (const it of items) { const pi = r2x.items.find((x) => x.id === it.itemId)!; pi.dispensed = r4(pi.dispensed + r4(it.quantity)); d.items.push({ itemId: pi.id, productId: pi.productId, quantity: r4(it.quantity) }) }
    r2x.status = r2x.items.some((x) => x.dispensed < x.prescribed) ? 'partially_dispensed' : 'dispensed'
    p.dispensings.push(d)
    const result = { dispensingId: d.id, saleId: d.saleId }
    p.keys[`${biz}|${key}`] = `pharmacy_dispense|${JSON.stringify(result)}`
    commit(p)
    return { error: null, result }
  } catch (e) { return { error: (e as Error).message } }
}

export function demoPrescriptions(biz: string): RxRow[] {
  ensureDemoPharmacy(biz)
  if (!allowed(biz, 'pharmacy-prescriptions', 'pharmacy.rx')) return []
  const customers = getTrade().customers
  return state.prescriptions.filter((r) => r.businessId === biz).slice().reverse().map((r) => ({ ...r, effectiveStatus: effective(r), customerName: customers.find((c) => c.id === r.customerId)?.name ?? null }))
}
export const demoDispensings = (biz: string, rxId: string) => (allowed(biz, 'pharmacy-prescriptions', 'pharmacy.rx') ? state.dispensings.filter((d) => d.businessId === biz && d.rxId === rxId) : [])

// -------------------------------------------------------------------- overview
export interface PharmacyOverview extends MartOverview {
  expiredUnits: number; expiredValue: number | null; quarantinedBatches: number; undatedBatches: number; expiringCritical: number; expiringAlert: number; expiringWatch: number; pendingOrders: number
  rxAwaitingReview: number | null; rxReady: number | null
}
export function demoPharmacyOverview(biz: string, from: string, to: string): PharmacyOverview {
  ensureDemoPharmacy(biz)
  const base = demoMartOverview(biz, from, to)
  const lots = demoBatches(biz, true); const s = settingsOf(biz)
  const act = lots.filter((l) => l.status === 'active')
  const exp = act.filter((l) => l.expiresOn !== null && l.expiresOn < today())
  const within = (l: BatchRow, lo: number, hi: number) => l.daysLeft !== null && l.daysLeft >= lo && l.daysLeft <= hi
  const rxOk = allowed(biz, 'pharmacy-prescriptions', 'pharmacy.rx')
  const rxs = state.prescriptions.filter((r) => r.businessId === biz && r.validUntil >= today())
  return {
    ...base, expiredUnits: r4(exp.reduce((a, l) => a + l.remaining, 0)), expiredValue: base.financial ? r2(exp.reduce((a, l) => a + l.value, 0)) : null,
    quarantinedBatches: lots.filter((l) => l.status === 'quarantined').length, undatedBatches: act.filter((l) => l.expiresOn === null).length,
    expiringCritical: act.filter((l) => within(l, 0, s.critical)).length, expiringAlert: act.filter((l) => within(l, s.critical + 1, s.alert)).length, expiringWatch: act.filter((l) => within(l, s.alert + 1, s.warning)).length,
    pendingOrders: getTrade().purchases.filter((x) => x.businessId === biz && ['ordered', 'partially_received'].includes(x.status)).length,
    rxAwaitingReview: rxOk ? rxs.filter((r) => r.status === 'awaiting_review').length : null, rxReady: rxOk ? rxs.filter((r) => ['approved', 'partially_dispensed'].includes(r.status)).length : null,
  }
}

// ----------------------------------------------------------------- sample data
/** Seeds a demo pharmacy once: categories, a few clearly-demo medicines with batches (one near expiry, one expired, one in quarantine) and a pending prescription. */
export function ensureDemoPharmacy(biz: string) {
  if (state.seeded.includes(biz)) return
  const business = getDemoState().businesses.find((x) => x.id === biz)
  if (business?.industry !== 'pharmacy') return
  state.seeded.push(biz) // guard against re-entry while seeding
  ensureDemoInventory(biz, 'pharmacy')
  ensureDemoTrade(biz)
  const inv = cloneInv(getInv())
  const loc = inv.locations.find((l) => l.businessId === biz)!
  const supplier = getTrade().suppliers.find((s) => s.businessId === biz)?.id ?? null
  const cats: Record<string, string> = {}
  mutateMart((m) => { for (const name of ['Pain relief', 'Antibiotics', 'Vitamins', 'First aid']) { const id = newId('cat'); cats[name] = id; m.categories.push({ id, businessId: biz, name }) } })
  const p: Pharm = JSON.parse(JSON.stringify(state)) as Pharm
  p.seeded = [...new Set([...p.seeded, biz])]
  const add = (name: string, cat: string, o: { unit?: string; price: number; cost: number; reorder: number; classification: Classification; form: string; strength?: string; generic?: string; packs?: { name: string; units: number }[]; lots: { batch: string; qty: number; days: number; status?: 'quarantined'; reason?: string }[] }) => {
    const pr: DProduct = { id: newId('p'), businessId: biz, sku: null, barcode: null, name, unit: o.unit ?? 'each', sellingPrice: o.price, defaultCost: o.cost, reorderLevel: o.reorder, status: 'active', kind: 'goods' }
    inv.products.push(pr); (inv.pharmacyProducts ??= []).push(pr.id); (inv.martLotProducts ??= []).push(pr.id)
    p.profiles.push({ productId: pr.id, businessId: biz, genericName: o.generic ?? null, activeIngredient: o.generic ?? null, strength: o.strength ?? null, dosageForm: o.form, manufacturer: 'Demo Pharma Ltd', registrationNo: null, classification: o.classification, storage: 'Store below 25°C', maxStock: null })
    mutateMart((m) => {
      m.profiles.push({ productId: pr.id, businessId: biz, categoryId: cats[cat], brand: null, wholesale: null, supplierId: null, trackExpiry: true })
      for (const k of o.packs ?? []) m.packs.push({ id: newId('pk'), productId: pr.id, name: k.name, units: k.units })
    })
    for (const l of o.lots) {
      const mv = postMovement(inv, pr, loc.id, 'receipt', l.qty, o.cost, 'Opening stock (demo)', newId('g'))
      const lot = (inv.lots ?? []).find((x) => x.batchId === `mv:${mv.id}`)
      if (lot) Object.assign(lot, { batchNumber: l.batch, expiresOn: addDays(today(), l.days), supplierId: supplier, locationId: loc.id, status: l.status ?? 'active', statusReason: l.reason ?? null })
    }
    return pr
  }
  add('Paracetamol 500mg Tablets', 'Pain relief', { price: 20, cost: 9, reorder: 200, classification: 'otc', form: 'tablet', strength: '500mg', generic: 'Paracetamol', packs: [{ name: 'strip', units: 10 }, { name: 'pack', units: 100 }], lots: [{ batch: 'PCM-2301', qty: 300, days: 25 }, { batch: 'PCM-2410', qty: 900, days: 400 }] })
  const amox = add('Amoxicillin 500mg Capsules', 'Antibiotics', { price: 150, cost: 90, reorder: 100, classification: 'prescription_only', form: 'capsule', strength: '500mg', generic: 'Amoxicillin', packs: [{ name: 'course', units: 21 }], lots: [{ batch: 'AMX-77', qty: 420, days: 300 }, { batch: 'AMX-61', qty: 60, days: -10 }] })
  add('Vitamin C 1000mg Effervescent', 'Vitamins', { price: 1800, cost: 1200, reorder: 20, classification: 'otc', form: 'tablet', strength: '1000mg', generic: 'Ascorbic acid', lots: [{ batch: 'VTC-9', qty: 60, days: 200 }] })
  add('Diazepam 5mg Tablets', 'Antibiotics', { price: 120, cost: 70, reorder: 50, classification: 'controlled', form: 'tablet', strength: '5mg', generic: 'Diazepam', lots: [{ batch: 'DZP-3', qty: 200, days: 500 }] })
  add('Elastic Bandage 10cm', 'First aid', { price: 900, cost: 550, reorder: 10, classification: 'device', form: 'device', lots: [{ batch: 'BND-1', qty: 24, days: 900 }, { batch: 'BND-0', qty: 6, days: 700, status: 'quarantined', reason: 'Damaged packaging: awaiting supplier decision' }] })
  commitInv(inv)
  p.prescriptions.push({ id: newId('rx'), businessId: biz, number: 'RX-000001', customerId: null, patient: 'Demo Patient', prescriber: 'Dr Demo', licence: 'MDCN-DEMO', prescribedOn: today(), validUntil: addDays(today(), 30), refills: 0, status: 'awaiting_review', notes: null, reviewNote: null, reviewedBy: null, reviewedAt: null, createdBy: null, createdAt: new Date().toISOString(),
    items: [{ id: newId('rxi'), productId: amox.id, prescribed: 21, dispensed: 0, directions: 'One capsule three times a day for 7 days' }] })
  p.seq[`${biz}|pharmacy_rx`] = 1
  commit(p)
}

export { getMart }
