import { addDays, r2, r4, today } from '@/demo/demoBakery'
import { creditHook, getFinance } from '@/demo/demoFinance'
import { cloneInv, commitInv, ensureDemoInventory, getInv, newId, postMovement } from '@/demo/demoInventory'
import type { DProduct, Inv } from '@/demo/demoInventory'
import { getDemoState } from '@/demo/demoStore'
import { demoAllowed, demoCanTrade, demoCreatePurchase, demoPostSale, ensureDemoTrade, getTrade } from '@/demo/demoTrade'

/**
 * Browser-only mart (retail) records for demo mode. Mirrors supabase/migrations/20261021000014_retail_mart.sql: packs are converted
 * to base units on the "server", receipts of expiry-tracked products become lots served first-expiry-first-out, a manager approves
 * stock counts, losses and supplier returns are stock movements, and a shift's expected cash counts only the cashier's own cash.
 */
export interface MartCategory { id: string; businessId: string; name: string }
export interface MartProfile { productId: string; businessId: string; categoryId: string | null; brand: string | null; wholesale: number | null; supplierId: string | null; trackExpiry: boolean }
export interface MartPack { id: string; productId: string; name: string; units: number }
export const LOSS_REASONS = ['damaged', 'expired', 'missing', 'other'] as const
export type LossReason = (typeof LOSS_REASONS)[number]
export interface MartLoss { id: string; businessId: string; number: string; productId: string; locationId: string; quantity: number; reason: LossReason; loss: number; notes: string | null; status: 'posted' | 'voided'; voidReason: string | null; movementId: string; createdAt: string }
export interface MartReturn { id: string; businessId: string; number: string; supplierId: string; purchaseId: string | null; locationId: string; reason: string; totalCredit: number; createdAt: string; items: { productId: string; quantity: number; unitCost: number }[] }
export interface MartCount { id: string; businessId: string; locationId: string; status: 'open' | 'posted'; createdAt: string; items: { productId: string; expected: number; counted: number | null }[] }
export interface MartShift { id: string; businessId: string; number: string; cashierId: string; openedAt: string; openingCash: number; closedAt: string | null; counted: number | null; expected: number | null; variance: number | null; status: 'open' | 'closed' | 'reviewed'; notes: string | null; reviewedBy: string | null; reviewNote: string | null }
export interface CashMove { id: string; shiftId: string; direction: 'in' | 'out'; amount: number; reason: string; at: string }
interface Mart { categories: MartCategory[]; profiles: MartProfile[]; packs: MartPack[]; losses: MartLoss[]; returns: MartReturn[]; counts: MartCount[]; shifts: MartShift[]; moves: CashMove[]; seq: Record<string, number>; keys: Record<string, string>; seeded: string[] }

const KEY = 'doa.demo.mart.v1'
const empty = (): Mart => ({ categories: [], profiles: [], packs: [], losses: [], returns: [], counts: [], shifts: [], moves: [], seq: {}, keys: {}, seeded: [] })
function load(): Mart {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Mart) } } catch { /* fresh */ }
  return empty()
}
let state = load()
function commit(next: Mart) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}
export const getMart = () => state
export const resetDemoMart = () => commit(empty())
creditHook.credit = (purchaseId) => state.returns.filter((r) => r.purchaseId === purchaseId).reduce((a, r) => a + r.totalCredit, 0)

const me = () => getDemoState().userId
const c100 = (n: number) => Math.round(n * 100)

// ----------------------------------------------------------------- plumbing
type Out<R> = { error: string | null; result?: R }
type Ctx = { m: Mart; inv: Inv; biz: string }
function run<R>(biz: string, op: string, key: string | null, modules: string[], perms: string[], fn: (c: Ctx) => R): Out<R> {
  if (!modules.some((mod) => perms.some((p) => demoAllowed(biz, mod, p)))) return { error: 'permission denied' }
  if (key !== null) {
    if (key.length < 8) return { error: 'an idempotency key of at least 8 characters is required' }
    const prev = state.keys[`${biz}|${key}`]
    if (prev) {
      const i = prev.indexOf('|')
      return prev.slice(0, i) === op ? { error: null, result: JSON.parse(prev.slice(i + 1)) as R } : { error: 'idempotency key already used for another operation' }
    }
  }
  const inv = cloneInv(getInv())
  const m: Mart = JSON.parse(JSON.stringify(state)) as Mart
  try {
    const result = fn({ m, inv, biz })
    if (key !== null) m.keys[`${biz}|${key}`] = `${op}|${JSON.stringify(result ?? null)}`
    commitInv(inv)
    commit(m)
    return { error: null, result }
  } catch (e) {
    return { error: (e as Error).message }
  }
}
const nextNumber = (m: Mart, biz: string, kind: string, prefix: string) => {
  const k = `${biz}|${kind}`
  m.seq[k] = (m.seq[k] ?? 0) + 1
  return `${prefix}-${String(m.seq[k]).padStart(6, '0')}`
}
const prod = (inv: Inv, biz: string, id: string) => inv.products.find((p) => p.id === id && p.businessId === biz)
const onHand = (inv: Inv, biz: string, productId: string, locationId?: string) =>
  Object.entries(inv.balances).filter(([k]) => k.startsWith(`${biz}|${productId}|`) && (!locationId || k.endsWith(`|${locationId}`))).reduce((a, [, v]) => a + v.qty, 0)
const avgCost = (inv: Inv, biz: string, productId: string) => {
  const rows = Object.entries(inv.balances).filter(([k]) => k.startsWith(`${biz}|${productId}|`)).map(([, v]) => v).filter((v) => v.qty > 0)
  const qty = rows.reduce((a, v) => a + v.qty, 0)
  return qty > 0 ? r4(rows.reduce((a, v) => a + v.qty * (v.avg ?? 0), 0) / qty) : null
}
const needLocation = (inv: Inv, biz: string, id: string) => { if (!inv.locations.some((l) => l.id === id && l.businessId === biz)) throw new Error('unknown or inactive location') }
/** Mirrors _pack_factor(): base units in the named pack (1 when no pack is named). */
function packFactor(m: Mart, productId: string, pack: string | null | undefined): number {
  if (!pack || !pack.trim()) return 1
  const k = m.packs.find((x) => x.productId === productId && x.name.trim().toLowerCase() === pack.trim().toLowerCase())
  if (!k) throw new Error(`this product has no pack called "${pack}"`)
  return k.units
}

// ---------------------------------------------------------------- categories
export function demoSaveCategory(biz: string, v: { id: string | null; name: string }): string | null {
  return run(biz, 'mart_category', null, ['inventory'], ['inventory.adjust'], ({ m }) => {
    if (!v.name.trim()) throw new Error('enter the category name')
    if (m.categories.some((c) => c.businessId === biz && c.id !== v.id && c.name.trim().toLowerCase() === v.name.trim().toLowerCase())) throw new Error('duplicate key: this category already exists')
    if (v.id === null) m.categories.push({ id: newId('cat'), businessId: biz, name: v.name.trim() })
    else { const c = m.categories.find((x) => x.id === v.id && x.businessId === biz); if (!c) throw new Error('category not found'); c.name = v.name.trim() }
    return null
  }).error
}

// ------------------------------------------------------------------ products
export interface MartProductInput {
  id: string | null; name: string; sku: string; barcode: string; categoryId: string | null; brand: string; unit: string; cost: number | null; price: number; wholesale: number | null
  reorder: number | null; supplierId: string | null; trackExpiry: boolean; active: boolean; packs: { name: string; units: number }[]
}
const UNIT_CODES = ['each', 'dozen', 'kg', 'g', 'l', 'ml']

export function demoSaveMartProduct(biz: string, v: MartProductInput, key: string) {
  return run(biz, 'mart_product', v.id === null ? key : null, ['retail-products'], ['retail.manage'], ({ m, inv }) => {
    if (v.name.trim().length < 2) throw new Error('enter the product name (at least 2 characters)')
    if (!(v.price >= 0) || r2(v.price) !== v.price) throw new Error('the selling price must be zero or more with at most 2 decimals')
    if (v.cost !== null && v.cost < 0) throw new Error('the cost price cannot be negative')
    if (v.wholesale !== null && (!(v.wholesale >= 0) || r2(v.wholesale) !== v.wholesale)) throw new Error('the wholesale price must be zero or more with at most 2 decimals')
    if (v.reorder !== null && v.reorder < 0) throw new Error('the reorder level cannot be negative')
    if (v.categoryId && !m.categories.some((c) => c.id === v.categoryId && c.businessId === biz)) throw new Error('unknown category')
    if (inv.products.some((p) => p.businessId === biz && p.id !== v.id && p.name.trim().toLowerCase() === v.name.trim().toLowerCase())) throw new Error('duplicate key: a product with this name already exists')
    const dup = (field: 'sku' | 'barcode', value: string) => value.trim() && inv.products.some((p) => p.businessId === biz && p.id !== v.id && p[field]?.toLowerCase() === value.trim().toLowerCase())
    if (dup('sku', v.sku) || dup('barcode', v.barcode)) throw new Error('duplicate key: this SKU or barcode is already used by another product')
    const seen = new Set<string>()
    for (const k of v.packs) {
      if (!k.name.trim()) throw new Error('every pack needs a name')
      if (!(k.units > 0)) throw new Error(`pack "${k.name}" must contain more than zero units`)
      if (seen.has(k.name.trim().toLowerCase())) throw new Error('each pack name can be used once')
      seen.add(k.name.trim().toLowerCase())
    }
    let p: DProduct
    if (v.id === null) {
      if (!UNIT_CODES.includes(v.unit)) throw new Error('unknown unit')
      p = { id: newId('p'), businessId: biz, sku: v.sku.trim() || null, barcode: v.barcode.trim() || null, name: v.name.trim(), unit: v.unit, sellingPrice: v.price, defaultCost: v.cost, reorderLevel: v.reorder, status: 'active', kind: 'goods' }
      inv.products.push(p)
    } else {
      const found = prod(inv, biz, v.id)
      if (!found || (found.kind && found.kind !== 'goods')) throw new Error('product not found')
      p = found
      // a price or cost change affects future sales only: sold lines keep the price they were sold at
      Object.assign(p, { name: v.name.trim(), sku: v.sku.trim() || null, barcode: v.barcode.trim() || null, sellingPrice: v.price, defaultCost: v.cost, reorderLevel: v.reorder, status: v.active ? 'active' : 'archived', kind: 'goods' })
    }
    const profile = m.profiles.find((x) => x.productId === p.id)
    const fields = { categoryId: v.categoryId, brand: v.brand.trim() || null, wholesale: v.wholesale, supplierId: v.supplierId, trackExpiry: v.trackExpiry }
    if (profile) Object.assign(profile, fields); else m.profiles.push({ productId: p.id, businessId: biz, ...fields })
    const tracked = (inv.martLotProducts ??= [])
    const at = tracked.indexOf(p.id)
    if (v.trackExpiry && at < 0) tracked.push(p.id)
    if (!v.trackExpiry && at >= 0) tracked.splice(at, 1)
    m.packs = m.packs.filter((k) => k.productId !== p.id)
    for (const k of v.packs) m.packs.push({ id: newId('pk'), productId: p.id, name: k.name.trim(), units: r4(k.units) })
    return { productId: p.id }
  })
}

/** Completes a lot that was created without batch or expiry (for example by a purchase receipt). */
export function demoSetLot(biz: string, lotId: string, batch: string, expiry: string | null): string | null {
  return run(biz, 'mart_set_lot', null, ['inventory'], ['inventory.adjust'], ({ inv }) => {
    const l = (inv.lots ?? []).find((x) => x.id === lotId && x.businessId === biz)
    if (!l) throw new Error('permission denied')
    l.batchNumber = batch.trim() || null; l.expiresOn = expiry
    return null
  }).error
}

// ------------------------------------------------------- receiving, buying, selling in packs
export function demoReceiveStock(biz: string, v: { locationId: string; reference: string; items: { productId: string; quantity: number; pack?: string | null; unitCost: number | null; batch?: string; expiry?: string | null }[] }, key: string) {
  return run(biz, 'mart_receive', key, ['inventory'], ['inventory.adjust'], ({ m, inv }) => {
    needLocation(inv, biz, v.locationId)
    if (!v.items.length || v.items.length > 200) throw new Error('items must be 1 to 200 lines')
    const group = newId('g')
    for (const it of v.items) {
      const p = prod(inv, biz, it.productId)
      if (!p || p.status !== 'active') throw new Error('invalid product')
      const f = packFactor(m, p.id, it.pack)
      const qty = r4(it.quantity * f)
      if (!(qty > 0)) throw new Error('quantity must be greater than zero')
      const cost = it.unitCost === null ? null : r4(it.unitCost / f)
      if (cost !== null && cost < 0) throw new Error('unit cost cannot be negative')
      const tracked = m.profiles.find((x) => x.productId === p.id)?.trackExpiry
      if (tracked && !it.expiry) throw new Error(`enter the expiry date for ${p.name}`)
      const mv = postMovement(inv, p, v.locationId, 'receipt', qty, cost, v.reference, group)
      if (tracked) { const lot = (inv.lots ?? []).find((l) => l.batchId === `mv:${mv.id}`); if (lot) { lot.batchNumber = it.batch?.trim() || null; lot.expiresOn = it.expiry ?? null } }
    }
    return { groupId: group }
  })
}

export function demoCreateMartPurchase(biz: string, supplierId: string, items: { productId: string; quantity: number; pack?: string | null; unitCost: number }[], reference: string, key: string) {
  if (!demoAllowed(biz, 'purchases', 'purchases.manage')) return { error: 'permission denied' as string | null }
  try {
    const lines = items.map((it) => { const f = packFactor(state, it.productId, it.pack); return { productId: it.productId, quantity: r4(it.quantity * f), unitCost: r4(it.unitCost / f) } })
    return demoCreatePurchase(biz, supplierId, lines, reference, key)
  } catch (e) { return { error: (e as Error).message as string | null } }
}

export function demoMartSale(biz: string, locationId: string, customerId: string | null, items: { productId: string; quantity: number; pack?: string | null; unitPrice?: number; discount?: number }[], payments: { method: string; amount: number }[], key: string) {
  try {
    const lines = items.map((it) => { const f = packFactor(state, it.productId, it.pack); return { productId: it.productId, quantity: r4(it.quantity * f), unitPrice: it.unitPrice === undefined ? undefined : r4(it.unitPrice / f), discount: it.discount ?? 0 } })
    return demoPostSale(biz, locationId, customerId, lines, payments, key)
  } catch (e) { return { error: (e as Error).message as string | null, result: undefined } }
}

// -------------------------------------------------------------------- counts
export function demoStartCount(biz: string, locationId: string, categoryId: string | null, key: string) {
  return run(biz, 'mart_count_start', key, ['inventory'], ['inventory.adjust'], ({ m, inv }) => {
    needLocation(inv, biz, locationId)
    if (categoryId && !m.categories.some((c) => c.id === categoryId && c.businessId === biz)) throw new Error('unknown category')
    const items = inv.products.filter((p) => p.businessId === biz && p.status === 'active' && (p.kind === 'goods' || !p.kind) && (!categoryId || m.profiles.find((x) => x.productId === p.id)?.categoryId === categoryId))
      .map((p) => ({ productId: p.id, expected: r4(onHand(inv, biz, p.id, locationId)), counted: null as number | null }))
    if (!items.length) throw new Error('no products to count in that selection')
    const c: MartCount = { id: newId('cnt'), businessId: biz, locationId, status: 'open', createdAt: new Date().toISOString(), items }
    m.counts.push(c)
    return { countId: c.id }
  })
}

export function demoRecordCount(biz: string, countId: string, productId: string, counted: number): string | null {
  return run(biz, 'mart_count_record', null, ['inventory'], ['inventory.adjust'], ({ m }) => {
    const c = m.counts.find((x) => x.id === countId && x.businessId === biz)
    if (!c) throw new Error('count not found')
    if (c.status !== 'open') throw new Error('count is already posted')
    if (!(counted >= 0)) throw new Error('counted quantity must be zero or more')
    const it = c.items.find((x) => x.productId === productId)
    if (!it) throw new Error('product is not part of this count')
    it.counted = counted
    return null
  }).error
}

/** Posting variances needs a manager; each is applied against today's balance so the result equals the count. */
export function demoPostCount(biz: string, countId: string, key: string) {
  return run(biz, 'mart_count_post', key, ['inventory'], ['inventory.adjust'], ({ m, inv }) => {
    const c = m.counts.find((x) => x.id === countId && x.businessId === biz)
    if (!c) throw new Error('count not found')
    if (!demoCanTrade(biz, 'retail.manage')) throw new Error('a manager must approve a stock count before it is posted')
    if (c.status !== 'open') throw new Error('count is already posted')
    const group = newId('g')
    for (const it of c.items.filter((x) => x.counted !== null)) {
      const cur = onHand(inv, biz, it.productId, c.locationId)
      if (it.counted !== cur) postMovement(inv, prod(inv, biz, it.productId)!, c.locationId, 'count_adjustment', r4((it.counted as number) - cur), null, `Stock count ${c.id.slice(0, 8)}`, group)
    }
    c.status = 'posted'
    return { groupId: group }
  })
}

// -------------------------------------------------------------------- losses
export function demoRecordLoss(biz: string, v: { productId: string; locationId: string; quantity: number; reason: LossReason; notes: string }, key: string) {
  return run(biz, 'mart_loss', key, ['retail-losses'], ['inventory.adjust'], ({ m, inv }) => {
    if (!(v.quantity > 0)) throw new Error('quantity must be greater than zero')
    if (!LOSS_REASONS.includes(v.reason)) throw new Error('choose a reason')
    const p = prod(inv, biz, v.productId)
    if (!p) throw new Error('invalid product')
    needLocation(inv, biz, v.locationId)
    const mv = postMovement(inv, p, v.locationId, 'adjustment', -v.quantity, null, `Stock loss (${v.reason})`, newId('g'))
    const rec: MartLoss = { id: newId('los'), businessId: biz, number: nextNumber(m, biz, 'stock_loss', 'LOS'), productId: v.productId, locationId: v.locationId, quantity: v.quantity, reason: v.reason, loss: r2(v.quantity * mv.unitCost), notes: v.notes.trim() || null, status: 'posted', voidReason: null, movementId: mv.id, createdAt: new Date().toISOString() }
    m.losses.push(rec)
    return { lossId: rec.id, number: rec.number, estimatedLoss: rec.loss }
  })
}

export function demoVoidLoss(biz: string, lossId: string, reason: string, key: string) {
  return run(biz, 'mart_void_loss', key, ['retail-losses'], ['retail.manage'], ({ m, inv }) => {
    const w = m.losses.find((x) => x.id === lossId && x.businessId === biz)
    if (!w) throw new Error('record not found')
    if (w.status !== 'posted') throw new Error('record is already voided')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    const mv = inv.movements.find((x) => x.id === w.movementId)!
    postMovement(inv, prod(inv, biz, w.productId)!, mv.locationId, 'reversal', -mv.delta, mv.unitCost, `Void ${w.number}`, newId('g'), mv.id)
    w.status = 'voided'; w.voidReason = reason.trim()
    return { lossId }
  }).error
}

// ----------------------------------------------------------- supplier returns
export function demoSupplierReturn(biz: string, v: { supplierId: string; purchaseId: string | null; locationId: string; items: { productId: string; quantity: number; unitCost: number }[]; reason: string }, key: string) {
  return run(biz, 'mart_supplier_return', key, ['retail-returns'], ['purchases.manage'], ({ m, inv }) => {
    const t = getTrade()
    if (!t.suppliers.some((s) => s.id === v.supplierId && s.businessId === biz)) throw new Error('unknown supplier')
    if (v.purchaseId && !t.purchases.some((p) => p.id === v.purchaseId && p.businessId === biz && p.supplierId === v.supplierId)) throw new Error('that purchase order is not from this supplier')
    if (v.reason.trim().length < 3) throw new Error('a reason is required')
    if (!v.items.length || v.items.length > 100) throw new Error('a return needs 1 to 100 lines')
    needLocation(inv, biz, v.locationId)
    const group = newId('g')
    const number = nextNumber(m, biz, 'supplier_return', 'SRT')
    let total = 0
    for (const it of v.items) {
      const p = prod(inv, biz, it.productId)
      if (!p) throw new Error('invalid product')
      const qty = r4(it.quantity)
      if (!(qty > 0)) throw new Error('quantity must be greater than zero')
      if (it.unitCost < 0) throw new Error('unit cost cannot be negative')
      if (v.purchaseId) {
        const pi = t.purchaseItems.find((x) => x.purchaseId === v.purchaseId && x.productId === it.productId)
        if (!pi) throw new Error('that product is not on the purchase order')
        const already = m.returns.filter((r) => r.purchaseId === v.purchaseId).flatMap((r) => r.items).filter((x) => x.productId === it.productId).reduce((a, x) => a + x.quantity, 0)
        if (qty > pi.received - already) throw new Error('you can only return what was received on that order')
      }
      postMovement(inv, p, v.locationId, 'return_out', -qty, null, `Supplier return ${number}: ${v.reason.trim()}`, group)
      total += c100(qty * it.unitCost)
    }
    m.returns.push({ id: newId('srt'), businessId: biz, number, supplierId: v.supplierId, purchaseId: v.purchaseId, locationId: v.locationId, reason: v.reason.trim(), totalCredit: total / 100, createdAt: new Date().toISOString(), items: v.items.map((i) => ({ productId: i.productId, quantity: r4(i.quantity), unitCost: i.unitCost })) })
    return { number, totalCredit: total / 100 }
  })
}

// -------------------------------------------------------------------- shifts
export interface ShiftSummary extends MartShift { cashierName: string; cashSales: number; cashRefunds: number; movedIn: number; movedOut: number; otherMethods: number; expectedCash: number }

/** Mirrors shift_summary: only the cashier's own successful cash payments inside the shift window count towards cash. */
export function demoShiftSummaries(biz: string): ShiftSummary[] {
  const t = getTrade(); const users = getDemoState().users
  const meId = me(); const manager = demoCanTrade(biz, 'retail.manage')
  return state.shifts.filter((s) => s.businessId === biz && (s.cashierId === meId || manager)).map((s) => {
    const end = s.closedAt ?? new Date().toISOString()
    const pays = t.payments.filter((p) => p.businessId === biz && p.by === s.cashierId && p.status === 'successful' && p.at >= s.openedAt && p.at <= end)
    const sum = (xs: typeof pays, type: string) => xs.filter((p) => p.type === type).reduce((a, p) => a + c100(p.amount), 0)
    const cash = pays.filter((p) => p.method === 'cash'); const other = pays.filter((p) => p.method !== 'cash')
    const mv = state.moves.filter((x) => x.shiftId === s.id)
    const movedIn = mv.filter((x) => x.direction === 'in').reduce((a, x) => a + c100(x.amount), 0)
    const movedOut = mv.filter((x) => x.direction === 'out').reduce((a, x) => a + c100(x.amount), 0)
    const cashSales = sum(cash, 'sale_receipt'); const cashRefunds = sum(cash, 'refund')
    const expected = s.expected ?? (c100(s.openingCash) + cashSales - cashRefunds + movedIn - movedOut) / 100
    return { ...s, cashierName: users.find((u) => u.id === s.cashierId)?.name ?? 'Cashier', cashSales: cashSales / 100, cashRefunds: cashRefunds / 100, movedIn: movedIn / 100, movedOut: movedOut / 100, otherMethods: (sum(other, 'sale_receipt') - sum(other, 'refund')) / 100, expectedCash: expected }
  }).sort((a, b) => b.openedAt.localeCompare(a.openedAt))
}
export const demoCashMoves = (shiftId: string) => state.moves.filter((x) => x.shiftId === shiftId)

export function demoOpenShift(biz: string, opening: number, key: string) {
  return run(biz, 'mart_open_shift', key, ['retail-shifts'], ['sales.create'], ({ m }) => {
    if (!(opening >= 0) || r2(opening) !== opening) throw new Error('opening cash must be zero or more with at most 2 decimals')
    if (m.shifts.some((s) => s.businessId === biz && s.cashierId === me() && s.status === 'open')) throw new Error('you already have an open shift; close it first')
    const s: MartShift = { id: newId('shf'), businessId: biz, number: nextNumber(m, biz, 'shift', 'SHF'), cashierId: me()!, openedAt: new Date().toISOString(), openingCash: opening, closedAt: null, counted: null, expected: null, variance: null, status: 'open', notes: null, reviewedBy: null, reviewNote: null }
    m.shifts.push(s)
    return { shiftId: s.id, number: s.number }
  })
}

const ownOrManager = (biz: string, s: MartShift) => { if (s.cashierId !== me() && !demoCanTrade(biz, 'retail.manage')) throw new Error('permission denied') }

export function demoCashMovement(biz: string, shiftId: string, direction: 'in' | 'out', amount: number, reason: string, key: string) {
  return run(biz, 'mart_cash_movement', key, ['retail-shifts'], ['sales.create'], ({ m }) => {
    const s = m.shifts.find((x) => x.id === shiftId && x.businessId === biz)
    if (!s) throw new Error('permission denied')
    ownOrManager(biz, s)
    if (s.status !== 'open') throw new Error('the shift is closed')
    if (direction !== 'in' && direction !== 'out') throw new Error('choose cash in or cash out')
    if (!(amount > 0) || r2(amount) !== amount) throw new Error('amount must be positive with at most 2 decimals')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    m.moves.push({ id: newId('cm'), shiftId, direction, amount, reason: reason.trim(), at: new Date().toISOString() })
    return { shiftId }
  })
}

/** Expected cash = opening cash + cash sales - cash refunds + cash put in - cash taken out. Other methods never count. */
export function demoCloseShift(biz: string, shiftId: string, counted: number, notes: string, key: string) {
  return run(biz, 'mart_close_shift', key, ['retail-shifts'], ['sales.create'], ({ m }) => {
    const s = m.shifts.find((x) => x.id === shiftId && x.businessId === biz)
    if (!s) throw new Error('permission denied')
    ownOrManager(biz, s)
    if (s.status !== 'open') throw new Error('the shift is already closed')
    if (!(counted >= 0) || r2(counted) !== counted) throw new Error('enter the cash you counted (zero or more, at most 2 decimals)')
    s.closedAt = new Date().toISOString()
    const expected = demoShiftSummaries(biz).find((x) => x.id === shiftId)!.expectedCash
    Object.assign(s, { status: 'closed', counted, expected, variance: r2(counted - expected), notes: notes.trim() || null })
    return { shiftId, expectedCash: expected, variance: r2(counted - expected) }
  })
}

export function demoReviewShift(biz: string, shiftId: string, note: string): string | null {
  return run(biz, 'mart_review_shift', null, ['retail-shifts'], ['retail.manage'], ({ m }) => {
    const s = m.shifts.find((x) => x.id === shiftId && x.businessId === biz)
    if (!s) throw new Error('permission denied')
    if (s.status !== 'closed') throw new Error('only a closed shift can be reviewed')
    if (s.variance !== 0 && note.trim().length < 3) throw new Error('explain the cash variance in the review note')
    Object.assign(s, { status: 'reviewed', reviewedBy: me(), reviewNote: note.trim() || null })
    return null
  }).error
}

// --------------------------------------------------------------------- views
export interface MartProductRow {
  id: string; name: string; sku: string | null; barcode: string | null; categoryId: string | null; categoryName: string | null; brand: string | null; unit: string; costPrice: number | null; price: number; wholesale: number | null
  reorder: number | null; supplierId: string | null; trackExpiry: boolean; active: boolean; onHand: number; avgCost: number | null; stockValue: number; low: boolean; out: boolean; packs: { name: string; units: number }[]; nextExpiry: string | null
}
export function demoMartProducts(biz: string): MartProductRow[] {
  ensureDemoMart(biz)
  const inv = getInv()
  return inv.products.filter((p) => p.businessId === biz && (p.kind === 'goods' || !p.kind)).map((p) => {
    const f = state.profiles.find((x) => x.productId === p.id)
    const have = r4(onHand(inv, biz, p.id)); const avg = avgCost(inv, biz, p.id)
    const exp = (inv.lots ?? []).filter((l) => l.productId === p.id && l.remaining > 0 && !l.voided && l.expiresOn).map((l) => l.expiresOn as string).sort()[0] ?? null
    return {
      id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, categoryId: f?.categoryId ?? null, categoryName: state.categories.find((c) => c.id === f?.categoryId)?.name ?? null, brand: f?.brand ?? null, unit: p.unit,
      costPrice: p.defaultCost, price: p.sellingPrice, wholesale: f?.wholesale ?? null, reorder: p.reorderLevel, supplierId: f?.supplierId ?? null, trackExpiry: f?.trackExpiry ?? false, active: p.status === 'active',
      onHand: have, avgCost: avg, stockValue: r2(have * (avg ?? p.defaultCost ?? 0)), low: (p.reorderLevel ?? 0) > 0 && have > 0 && have <= (p.reorderLevel ?? 0), out: have <= 0,
      packs: state.packs.filter((k) => k.productId === p.id).sort((a, b) => a.units - b.units).map((k) => ({ name: k.name, units: k.units })), nextExpiry: exp,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export interface MartLotRow { id: string; productId: string; productName: string; batchNumber: string | null; quantity: number; remaining: number; receivedOn: string; expiresOn: string | null; daysLeft: number | null; status: 'ok' | 'expiring' | 'expired' | 'unknown' }
export function demoMartLots(biz: string): MartLotRow[] {
  const inv = getInv()
  return (inv.lots ?? []).filter((l) => l.businessId === biz && l.batchId.startsWith('mv:') && l.remaining > 0 && !l.voided).map((l) => {
    const days = l.expiresOn ? Math.floor((Date.parse(l.expiresOn) - Date.parse(today())) / 86400000) : null
    return { id: l.id, productId: l.productId, productName: prod(inv, biz, l.productId)?.name ?? '', batchNumber: l.batchNumber ?? null, quantity: l.quantity, remaining: l.remaining, receivedOn: l.producedOn, expiresOn: l.expiresOn, daysLeft: days, status: days === null ? 'unknown' as const : days < 0 ? 'expired' as const : days <= 7 ? 'expiring' as const : 'ok' as const }
  }).sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999'))
}

// ------------------------------------------------------------------ overview
export interface MartOverview {
  transactions: number; unitsSold: number; avgTransaction: number | null; lowStock: number; outOfStock: number; expiringLots: number; expiredLots: number; openShifts: number
  daily: { day: string; netSales: number; sales: number }[]; bestSellers: { product: string; units: number; revenue: number }[]
  recentSales: { number: string; at: string; total: number; status: string }[]; recentMovements: { product: string; type: string; quantity: number; at: string }[]; slowMovers: { product: string; onHand: number; value: number }[]
  financial: null | {
    netSales: number; discounts: number; refunds: number; cogs: number; grossProfit: number; grossMarginPercent: number | null; operatingExpenses: number; operatingProfitEstimate: number; inventoryValue: number
    supplierBalances: number; customerBalances: number; shiftVariance: number; byCategory: { category: string; units: number; revenue: number }[]; byCashier: { cashier: string; sales: number; netSales: number }[]; paymentMethods: { method: string; amount: number }[]
  }
}

/** Same definitions as mart_overview(). */
export function demoMartOverview(biz: string, from: string, to: string): MartOverview {
  if (!demoAllowed(biz, 'dashboard', 'dashboard.read')) throw new Error('permission denied')
  if (!from || !to || to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new Error('choose a valid period of up to a year')
  ensureDemoMart(biz)
  const t = getTrade(); const inv = getInv()
  const inRange = (iso: string) => iso.slice(0, 10) >= from && iso.slice(0, 10) <= to
  const sales = t.sales.filter((s) => s.businessId === biz && s.status !== 'voided' && inRange(s.soldAt))
  const net = (s: (typeof sales)[number]) => c100(s.grandTotal) - c100(s.taxTotal) - c100(s.returnedTotal)
  const items = t.saleItems.filter((i) => sales.some((s) => s.id === i.saleId))
  const restocked = (id: string) => t.returnItems.filter((r) => r.saleItemId === id && r.disposition === 'restock').reduce((a, r) => a + r.quantity, 0)
  const cogs = items.reduce((a, i) => a + Math.round((i.quantity - restocked(i.id)) * (i.unitCost ?? 0) * 100), 0)
  const products = demoMartProducts(biz)
  const live = products.filter((p) => p.active)
  const lots = demoMartLots(biz)
  const salesNet = sales.reduce((a, s) => a + net(s), 0)
  const grouped = <K extends string>(keyOf: (i: (typeof items)[number]) => K) => { const mp = new Map<K, { units: number; revenue: number }>(); for (const i of items) { const k = keyOf(i); const cur = mp.get(k) ?? { units: 0, revenue: 0 }; mp.set(k, { units: cur.units + i.quantity, revenue: cur.revenue + c100(i.total) - c100(i.tax) }) } return mp }
  const byProduct = grouped((i) => (prod(inv, biz, i.productId)?.name ?? i.description) as string)
  const catOf = (i: (typeof items)[number]) => state.categories.find((c) => c.id === state.profiles.find((p) => p.productId === i.productId)?.categoryId)?.name ?? 'Uncategorised'
  const byCat = grouped(catOf)
  const dayNet = new Map<string, { net: number; n: number }>()
  for (const s of sales) { const k = s.soldAt.slice(0, 10); const cur = dayNet.get(k) ?? { net: 0, n: 0 }; dayNet.set(k, { net: cur.net + net(s), n: cur.n + 1 }) }
  const cashiers = new Map<string, { sales: number; net: number }>()
  for (const s of sales) { const nm = getDemoState().users.find((u) => u.id === s.by)?.name ?? 'Unknown'; const cur = cashiers.get(nm) ?? { sales: 0, net: 0 }; cashiers.set(nm, { sales: cur.sales + 1, net: cur.net + net(s) }) }
  const methods = new Map<string, number>()
  for (const p of t.payments.filter((x) => x.businessId === biz && x.status === 'successful' && x.type === 'sale_receipt' && inRange(x.at))) methods.set(p.method, (methods.get(p.method) ?? 0) + c100(p.amount))
  const soldIds = new Set(items.map((i) => i.productId))
  const out: MartOverview = {
    transactions: sales.length, unitsSold: items.reduce((a, i) => a + i.quantity, 0), avgTransaction: sales.length ? Math.round(salesNet / sales.length) / 100 : null,
    lowStock: live.filter((p) => p.low).length, outOfStock: live.filter((p) => p.out).length, expiringLots: lots.filter((l) => l.status === 'expiring').length, expiredLots: lots.filter((l) => l.status === 'expired').length,
    openShifts: state.shifts.filter((s) => s.businessId === biz && s.status === 'open').length,
    daily: [...dayNet].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, netSales: v.net / 100, sales: v.n })),
    bestSellers: [...byProduct].sort((a, b) => b[1].units - a[1].units).slice(0, 8).map(([product, v]) => ({ product, units: v.units, revenue: v.revenue / 100 })),
    recentSales: t.sales.filter((s) => s.businessId === biz).slice(-8).reverse().map((s) => ({ number: s.number, at: s.soldAt, total: s.grandTotal, status: s.status })),
    recentMovements: inv.movements.filter((x) => x.businessId === biz).slice(-8).reverse().map((x) => ({ product: prod(inv, biz, x.productId)?.name ?? '', type: x.type, quantity: x.delta, at: x.at })),
    slowMovers: live.filter((p) => p.onHand > 0 && !soldIds.has(p.id)).sort((a, b) => b.stockValue - a.stockValue).slice(0, 8).map((p) => ({ product: p.name, onHand: p.onHand, value: p.stockValue })),
    financial: null,
  }
  if (demoCanTrade(biz, 'reports.finance.read')) {
    const exps = getFinance().expenses.filter((e) => e.businessId === biz && e.status === 'posted' && e.date >= from && e.date <= to).reduce((a, e) => a + c100(e.amount), 0)
    const owedByUs = t.purchases.filter((p) => p.businessId === biz && p.status !== 'cancelled').reduce((a, p) => a + Math.max(c100(p.total) - c100(p.amountPaid) - c100(creditHook.credit(p.id)), 0), 0)
    const owedToUs = t.sales.filter((s) => s.businessId === biz && s.status !== 'voided' && s.balanceDue > 0).reduce((a, s) => a + c100(s.balanceDue), 0)
    out.financial = {
      netSales: salesNet / 100, discounts: sales.reduce((a, s) => a + c100(s.discountTotal), 0) / 100, refunds: sales.reduce((a, s) => a + c100(s.returnedTotal), 0) / 100, cogs: cogs / 100, grossProfit: (salesNet - cogs) / 100,
      grossMarginPercent: salesNet > 0 ? Math.round(((salesNet - cogs) * 1000) / salesNet) / 10 : null, operatingExpenses: exps / 100, operatingProfitEstimate: (salesNet - cogs - exps) / 100,
      inventoryValue: r2(live.reduce((a, p) => a + p.stockValue, 0)), supplierBalances: owedByUs / 100, customerBalances: owedToUs / 100,
      shiftVariance: r2(state.shifts.filter((s) => s.businessId === biz && s.status !== 'open' && s.closedAt && inRange(s.closedAt)).reduce((a, s) => a + (s.variance ?? 0), 0)),
      byCategory: [...byCat].sort((a, b) => b[1].revenue - a[1].revenue).map(([category, v]) => ({ category, units: v.units, revenue: v.revenue / 100 })),
      byCashier: [...cashiers].sort((a, b) => b[1].net - a[1].net).map(([cashier, v]) => ({ cashier, sales: v.sales, netSales: v.net / 100 })),
      paymentMethods: [...methods].map(([method, amount]) => ({ method, amount: amount / 100 })),
    }
  }
  return out
}

export { addDays }

// ---------------------------------------------------------------- sample data
/** Seeds a demo mart once: the starter products get profiles, two sample categories and one pack. Clearly demo data. */
export function ensureDemoMart(biz: string) {
  if (state.seeded.includes(biz)) return
  const business = getDemoState().businesses.find((x) => x.id === biz)
  if (business?.industry !== 'retail') return
  ensureDemoInventory(biz, 'retail')
  ensureDemoTrade(biz)
  const inv = cloneInv(getInv())
  const m: Mart = JSON.parse(JSON.stringify(state)) as Mart
  m.seeded.push(biz)
  const groceries: MartCategory = { id: newId('cat'), businessId: biz, name: 'Groceries' }
  const household: MartCategory = { id: newId('cat'), businessId: biz, name: 'Household' }
  m.categories.push(groceries, household)
  for (const p of inv.products.filter((x) => x.businessId === biz && !x.kind)) {
    p.kind = 'goods'
    m.profiles.push({ productId: p.id, businessId: biz, categoryId: /oil|soap/i.test(p.name) ? household.id : groceries.id, brand: null, wholesale: null, supplierId: null, trackExpiry: false })
  }
  const milk = inv.products.find((p) => p.businessId === biz && p.name.startsWith('Peak Milk'))
  if (milk) m.packs.push({ id: newId('pk'), productId: milk.id, name: 'carton', units: 24 })
  commitInv(inv)
  commit(m)
}
