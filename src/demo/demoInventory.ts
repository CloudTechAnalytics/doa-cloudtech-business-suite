import { useSyncExternalStore } from 'react'
import { applyMovement } from '@/modules/inventory/ledger'
import type { Balance } from '@/modules/inventory/ledger'
import { demoModuleStatuses, demoRoleIn } from '@/demo/demoStore'
import { rolePermissions } from '@/core/permissions/roles'

/** Browser-only inventory for demo mode; uses the same ledger rules as the database (see ledger.ts). */

export interface DProduct { id: string; businessId: string; sku: string | null; barcode: string | null; name: string; unit: string; sellingPrice: number; defaultCost: number | null; reorderLevel: number | null; status: 'active' | 'archived'; kind?: 'ingredient' | 'finished_good' | 'goods'; /** false for a service: sold like a product but with no stock. */ tracksStock?: boolean; categoryId?: string | null }
export interface DCategory { id: string; businessId: string; name: string }
export interface DCountItem { productId: string; expected: number; counted: number | null }
export interface DCount { id: string; businessId: string; locationId: string; status: 'open' | 'posted'; createdAt: string; postedAt: string | null; items: DCountItem[] }
/** A batch of finished goods with an expiry date; stock leaves the oldest-expiring lot first (mirrors bakery_lots). */
export interface DLot { batchNumber?: string | null; status?: 'active' | 'quarantined'; statusReason?: string | null; manufacturedOn?: string | null; supplierId?: string | null; locationId?: string | null; id: string; businessId: string; productId: string; batchId: string; quantity: number; remaining: number; producedOn: string; expiresOn: string | null; voided: boolean }
export interface DAlloc { lotId: string; movementId: string; quantity: number; restored: boolean }
export interface DLocation { id: string; businessId: string; name: string; type?: string; status?: 'active' | 'archived' }
export interface DMovement { id: string; businessId: string; productId: string; locationId: string; type: string; delta: number; unitCost: number; reason: string | null; at: string; reversalOf: string | null; groupId: string }
export interface Inv {
  products: DProduct[]
  locations: DLocation[]
  movements: DMovement[]
  balances: Record<string, Balance> // `${business}|${product}|${location}`
  keys: Record<string, { op: string; result: string }>
  seeded: string[]
  /** Bakery finished-goods lots, kept here so they commit or roll back together with the stock movements that use them. */
  lots?: DLot[]
  allocs?: DAlloc[]
  lotProducts?: string[]
  /** Mart products that track expiry: every receipt becomes a lot, completed with batch and expiry afterwards. */
  martLotProducts?: string[]
  /** Pharmacy medicines: batch stock that never sells expired, quarantined or undated lots. */
  pharmacyProducts?: string[]
  categories?: DCategory[]
  counts?: DCount[]
}

const KEY = 'doa.demo.inv.v1'
let uid = Date.now()
const id = (p: string) => `${p}-${(uid++).toString(36)}`
const empty = (): Inv => ({ products: [], locations: [], movements: [], balances: {}, keys: {}, seeded: [], lots: [], allocs: [], lotProducts: [], martLotProducts: [], pharmacyProducts: [] })

/** A working copy for an operation that commits only if every step succeeds. */
export function cloneInv(inv: Inv): Inv {
  return { ...inv, balances: { ...inv.balances }, movements: [...inv.movements], keys: { ...inv.keys }, lots: (inv.lots ?? []).map((l) => ({ ...l })), allocs: (inv.allocs ?? []).map((a) => ({ ...a })), lotProducts: [...(inv.lotProducts ?? [])], martLotProducts: [...(inv.martLotProducts ?? [])], pharmacyProducts: [...(inv.pharmacyProducts ?? [])], categories: [...(inv.categories ?? [])], counts: (inv.counts ?? []).map((c) => ({ ...c, items: c.items.map((i) => ({ ...i })) })) }
}

function load(): Inv {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Inv) } } catch { /* start fresh */ }
  return empty()
}
let state = load()
const listeners = new Set<() => void>()
function commit(next: Inv) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
  listeners.forEach((l) => l())
}
export const useDemoInventory = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)
export function resetDemoInventory() { commit(empty()) }

const SEEDS: Record<string, { name: string; unit: string; price: number; cost: number; qty: number; reorder: number; sku: string }[]> = {
  retail: [
    { name: 'Indomie Noodles 70g (carton)', unit: 'each', price: 5200, cost: 4300, qty: 40, reorder: 10, sku: 'NOOD-70' },
    { name: 'Peak Milk Tin 400g', unit: 'each', price: 2100, cost: 1700, qty: 6, reorder: 12, sku: 'MILK-400' },
    { name: 'Rice 50kg bag', unit: 'each', price: 78000, cost: 71000, qty: 0, reorder: 3, sku: 'RICE-50' },
    { name: 'Vegetable Oil 5L', unit: 'each', price: 9800, cost: 8600, qty: 25, reorder: 8, sku: 'OIL-5L' },
  ],
  farm: [
    { name: 'Layer Mash', unit: 'kg', price: 600, cost: 480, qty: 2400, reorder: 800, sku: 'FEED-LAY' },
    { name: 'Grower Mash', unit: 'kg', price: 580, cost: 460, qty: 350, reorder: 500, sku: 'FEED-GRO' },
    { name: 'Newcastle Vaccine', unit: 'each', price: 3500, cost: 2800, qty: 30, reorder: 10, sku: 'VAC-NCD' },
    { name: 'Table eggs (crate)', unit: 'each', price: 1800, cost: 1200, qty: 0, reorder: 0, sku: 'EGG-CR' },
    { name: 'Catfish (kg)', unit: 'kg', price: 2500, cost: 1700, qty: 0, reorder: 0, sku: 'FISH-KG' },
  ],
  bakery: [
    { name: 'Wheat Flour', unit: 'kg', price: 1500, cost: 1250, qty: 420, reorder: 200, sku: 'ING-FLR' },
    { name: 'Granulated Sugar', unit: 'kg', price: 1600, cost: 1350, qty: 90, reorder: 100, sku: 'ING-SUG' },
    { name: 'Instant Yeast', unit: 'kg', price: 5500, cost: 4700, qty: 8, reorder: 5, sku: 'ING-YST' },
  ],
}

/** Seeds a demo business once, by posting real receipts through the ledger. */
export function ensureDemoInventory(businessId: string, industry: string) {
  if (state.seeded.includes(businessId)) return
  const seed = SEEDS[industry] ?? []
  const loc: DLocation = { id: id('l'), businessId, name: 'Main store' }
  const next: Inv = { ...state, locations: [...state.locations, loc, { id: id('l'), businessId, name: 'Shelf 1' }], seeded: [...state.seeded, businessId], balances: { ...state.balances }, movements: [...state.movements], products: [...state.products] }
  for (const s of seed) {
    const p: DProduct = { id: id('p'), businessId, sku: s.sku, barcode: null, name: s.name, unit: s.unit, sellingPrice: s.price, defaultCost: s.cost, reorderLevel: s.reorder, status: 'active' }
    next.products.push(p)
    if (s.qty > 0) postMovement(next, p, loc.id, 'receipt', s.qty, s.cost, 'Opening stock', id('g'))
  }
  commit(next)
}

/** Mirrors bakery_allocate_lots(): outgoing stock takes from the oldest-expiring lot; a reversal gives it back to the same lots. */
/** Set while a named batch is being written off, so that disposal can take from a quarantined or expired lot. */
export const lotForce: { id: string | null } = { id: null }

function allocateLots(inv: Inv, p: DProduct, m: DMovement) {
  const pharm = !!inv.pharmacyProducts?.includes(p.id)
  const mart = pharm || !!inv.martLotProducts?.includes(p.id)
  if ((!inv.lotProducts?.includes(p.id) && !mart) || ['production_output', 'transfer_in', 'transfer_out'].includes(m.type)) return
  const lots = (inv.lots ??= []); const allocs = (inv.allocs ??= [])
  if (m.reversalOf) {
    if (mart) { const l = lots.find((x) => x.batchId === `mv:${m.reversalOf}`); if (l) { l.remaining = 0; l.voided = true } }
    for (const a of allocs.filter((x) => x.movementId === m.reversalOf && !x.restored)) {
      const lot = lots.find((l) => l.id === a.lotId)
      if (lot && !lot.voided) lot.remaining = Math.round((lot.remaining + a.quantity) * 10000) / 10000
      a.restored = true
    }
    return
  }
  if (mart && (pharm ? ['receipt', 'return_in', 'adjustment', 'count_adjustment'] : ['receipt', 'return_in']).includes(m.type) && m.delta > 0) {
    const waiting = pharm && m.type !== 'receipt'
    lots.push({ id: id('lt'), businessId: p.businessId, productId: p.id, batchId: `mv:${m.id}`, batchNumber: null, quantity: m.delta, remaining: m.delta, producedOn: m.at.slice(0, 10), expiresOn: null, voided: false, locationId: m.locationId,
      status: waiting ? 'quarantined' : 'active', statusReason: waiting ? (m.type === 'return_in' ? 'Customer return awaiting inspection' : 'Stock added by adjustment: confirm batch and expiry') : null })
    return
  }
  if (m.delta >= 0) return
  let need = -m.delta
  const todayIso = new Date().toISOString().slice(0, 10)
  const sellable = (l: DLot) => (l.status ?? 'active') === 'active' && !!l.expiresOn && l.expiresOn >= todayIso
  const order = lots.filter((l) => l.businessId === p.businessId && l.productId === p.id && l.remaining > 0 && !l.voided && (!pharm || (lotForce.id ? l.id === lotForce.id : m.type === 'return_out' || sellable(l))))
    .sort((a, b) => (pharm && m.type === 'return_out' && !lotForce.id ? Number(sellable(a)) - Number(sellable(b)) : 0) || (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') || a.producedOn.localeCompare(b.producedOn))
  for (const l of order) {
    if (need <= 0) break
    const take = Math.min(l.remaining, need)
    l.remaining = Math.round((l.remaining - take) * 10000) / 10000
    allocs.push({ lotId: l.id, movementId: m.id, quantity: take, restored: false })
    need = Math.round((need - take) * 10000) / 10000
  }
  if (pharm && need > 0) throw new Error(`not enough saleable stock of ${p.name}: expired, quarantined or undated batches are excluded`)
}

export function postMovement(inv: Inv, p: DProduct, locationId: string, type: string, delta: number, cost: number | null, reason: string | null, groupId: string, reversalOf: string | null = null): DMovement {
  const k = `${p.businessId}|${p.id}|${locationId}`
  const r = applyMovement(inv.balances[k] ?? { qty: 0, avg: null }, delta, cost, { allowNegative: false, defaultCost: p.defaultCost })
  inv.balances[k] = r.balance
  const m: DMovement = { id: id('m'), businessId: p.businessId, productId: p.id, locationId, type, delta, unitCost: r.unitCost, reason, at: new Date().toISOString(), reversalOf, groupId }
  inv.movements.push(m)
  allocateLots(inv, p, m)
  return m
}

function guard(businessId: string): string | null {
  const role = demoRoleIn(businessId)
  const usable = demoModuleStatuses(businessId).find((s) => s.code === 'inventory')?.usable
  if (!role || !usable || !rolePermissions(role).has('inventory.adjust')) return 'permission denied'
  return null
}

const LOCATION_TYPES = ['store', 'shelf', 'warehouse', 'farm_store', 'kitchen']
const onHandAt = (businessId: string, locationId: string) => Object.entries(state.balances).filter(([k, v]) => k.startsWith(`${businessId}|`) && k.endsWith(`|${locationId}`) && v.qty !== 0).length

/** Adds, renames or archives a stock location (mirrors the inventory_locations policies and the guard trigger). */
export function demoSaveLocation(businessId: string, v: { id: string | null; name: string; type: string }): string | null {
  const denied = guard(businessId); if (denied) return denied
  const name = v.name.trim()
  if (!name) return 'Enter the location name.'
  if (!LOCATION_TYPES.includes(v.type)) return 'Choose what kind of place it is.'
  if (state.locations.some((l) => l.businessId === businessId && l.id !== v.id && l.name.trim().toLowerCase() === name.toLowerCase())) return 'duplicate key: a location with this name already exists'
  if (v.id === null) { commit({ ...state, locations: [...state.locations, { id: id('l'), businessId, name, type: v.type, status: 'active' }] }); return null }
  if (!state.locations.some((l) => l.id === v.id && l.businessId === businessId)) return 'Location not found.'
  commit({ ...state, locations: state.locations.map((l) => (l.id === v.id ? { ...l, name, type: v.type } : l)) })
  return null
}
export function demoSetLocationStatus(businessId: string, locationId: string, status: 'active' | 'archived'): string | null {
  const denied = guard(businessId); if (denied) return denied
  const loc = state.locations.find((l) => l.id === locationId && l.businessId === businessId)
  if (!loc) return 'Location not found.'
  if (status === 'archived' && (loc.status ?? 'active') === 'active') {
    if (onHandAt(businessId, locationId) > 0) return `move or sell the stock in "${loc.name}" before archiving it`
    if (!state.locations.some((l) => l.businessId === businessId && l.id !== locationId && (l.status ?? 'active') === 'active')) return 'keep at least one active location'
  }
  commit({ ...state, locations: state.locations.map((l) => (l.id === locationId ? { ...l, status } : l)) })
  return null
}
export const demoLocations = (businessId: string) => state.locations.filter((l) => l.businessId === businessId).map((l) => ({
  id: l.id, name: l.name, type: l.type ?? 'store', active: (l.status ?? 'active') === 'active', stocked: onHandAt(businessId, l.id),
}))

export function demoCan(businessId: string, perm: string): boolean {
  const role = demoRoleIn(businessId)
  return !!role && rolePermissions(role).has(perm)
}

interface Line { productId: string; quantity: number; unitCost?: number | null }

/** Runs `fn` on a copy; commits only if every step succeeds (atomic, like the SQL functions). */
function transaction(businessId: string, op: string, key: string, fn: (inv: Inv) => void): string | null {
  const denied = guard(businessId)
  if (denied) return denied
  if (!key || key.length < 8) return 'an idempotency key of at least 8 characters is required'
  const prev = state.keys[`${businessId}|${key}`]
  if (prev) return prev.op === op ? null : 'idempotency key already used for another operation'
  const next: Inv = cloneInv(state)
  try {
    fn(next)
  } catch (e) {
    return (e as Error).message
  }
  next.keys[`${businessId}|${key}`] = { op, result: 'ok' }
  commit(next)
  return null
}

const product = (inv: Inv, businessId: string, pid: string) => {
  const p = inv.products.find((x) => x.id === pid && x.businessId === businessId)
  if (!p || p.status !== 'active') throw new Error('invalid product')
  if (p.tracksStock === false) throw new Error('product does not track stock')
  return p
}
const location = (inv: Inv, businessId: string, lid: string) => {
  if (!inv.locations.some((l) => l.id === lid && l.businessId === businessId)) throw new Error('unknown or inactive location')
}
const checkLines = (lines: Line[]) => {
  if (!lines.length || lines.length > 200) throw new Error('items must be an array of 1 to 200 lines')
  for (const l of lines) {
    if (!(l.quantity > 0)) throw new Error('quantity must be greater than zero')
    if (l.unitCost != null && l.unitCost < 0) throw new Error('unit cost cannot be negative')
  }
}
const needReason = (r: string, what = 'a reason') => { if (r.trim().length < 3) throw new Error(`${what} is required`) }

export function demoReceive(businessId: string, locationId: string, lines: Line[], reference: string, key: string) {
  return transaction(businessId, 'receive', key, (inv) => {
    checkLines(lines); location(inv, businessId, locationId)
    const g = id('g')
    for (const l of lines) postMovement(inv, product(inv, businessId, l.productId), locationId, 'receipt', l.quantity, l.unitCost ?? null, reference || null, g)
  })
}

export function demoAdjust(businessId: string, locationId: string, productId: string, delta: number, reason: string, key: string) {
  return transaction(businessId, 'adjust', key, (inv) => {
    if (!delta) throw new Error('adjustment quantity cannot be zero')
    needReason(reason, 'an adjustment reason'); location(inv, businessId, locationId)
    postMovement(inv, product(inv, businessId, productId), locationId, 'adjustment', delta, null, reason, id('g'))
  })
}

export function demoIssue(businessId: string, locationId: string, lines: Line[], reason: string, key: string) {
  return transaction(businessId, 'issue', key, (inv) => {
    checkLines(lines); needReason(reason); location(inv, businessId, locationId)
    const g = id('g')
    for (const l of lines) postMovement(inv, product(inv, businessId, l.productId), locationId, 'issue', -l.quantity, null, reason, g)
  })
}

export function demoTransfer(businessId: string, from: string, to: string, lines: Line[], key: string) {
  return transaction(businessId, 'transfer', key, (inv) => {
    if (from === to) throw new Error('source and destination must differ')
    checkLines(lines); location(inv, businessId, from); location(inv, businessId, to)
    const g = id('g')
    for (const l of lines) {
      const p = product(inv, businessId, l.productId)
      const out = postMovement(inv, p, from, 'transfer_out', -l.quantity, null, null, g)
      postMovement(inv, p, to, 'transfer_in', l.quantity, out.unitCost, null, g)
    }
  })
}

export function demoReverse(businessId: string, movementId: string, reason: string, key: string) {
  return transaction(businessId, 'reverse', key, (inv) => {
    const m = inv.movements.find((x) => x.id === movementId && x.businessId === businessId)
    if (!m) throw new Error('movement not found')
    needReason(reason)
    if (m.type === 'reversal') throw new Error('a reversal cannot be reversed')
    if (m.type.startsWith('transfer')) throw new Error('transfers cannot be reversed leg by leg; post a counter-transfer')
    if (inv.movements.some((x) => x.reversalOf === movementId)) throw new Error('movement was already reversed')
    postMovement(inv, inv.products.find((p) => p.id === m.productId)!, m.locationId, 'reversal', -m.delta, m.unitCost, reason, id('g'), m.id)
  })
}

export function demoCreateProduct(businessId: string, p: { name: string; sku: string; barcode: string; unit: string; sellingPrice: number; defaultCost: number | null; reorderLevel: number | null; tracksStock?: boolean; categoryId?: string | null }): string | null {
  const denied = guard(businessId)
  if (denied) return denied
  if (!p.name.trim()) return 'Enter the product name.'
  const dup = (f: 'sku' | 'barcode') => p[f].trim() && state.products.some((x) => x.businessId === businessId && x[f]?.toLowerCase() === p[f].trim().toLowerCase())
  if (dup('sku')) return 'duplicate key: this SKU already exists'
  if (dup('barcode')) return 'duplicate key: this barcode already exists'
  commit({ ...state, products: [...state.products, { id: id('p'), businessId, name: p.name.trim(), sku: p.sku.trim() || null, barcode: p.barcode.trim() || null, unit: p.unit, sellingPrice: p.sellingPrice, defaultCost: p.defaultCost, reorderLevel: p.reorderLevel, status: 'active', tracksStock: p.tracksStock ?? true, categoryId: p.categoryId ?? null }] })
  return null
}

export function demoSetProductStatus(businessId: string, productId: string, status: 'active' | 'archived'): string | null {
  const denied = guard(businessId)
  if (denied) return denied
  commit({ ...state, products: state.products.map((p) => (p.id === productId && p.businessId === businessId ? { ...p, status } : p)) })
  return null
}

/** Demo parity of inventory_reconcile(): always empty because balances are only changed by post(). */
export const demoUnits = ['each', 'dozen', 'kg', 'g', 'l', 'ml']

/** For the demo trade store: read the current inventory state and commit a replacement atomically. */
export const getInv = () => state
export const commitInv = commit
export const newId = id

/** Adds a product to a demo business if it does not exist yet (used when a module needs a produce item). */
export function demoEnsureProduct(businessId: string, p: { name: string; unit: string; price: number; sku: string }): string {
  const found = state.products.find((x) => x.businessId === businessId && x.name === p.name)
  if (found) return found.id
  const product: DProduct = { id: id('p'), businessId, sku: p.sku, barcode: null, name: p.name, unit: p.unit, sellingPrice: p.price, defaultCost: null, reorderLevel: null, status: 'active' }
  commit({ ...state, products: [...state.products, product] })
  return product.id
}

// ---------------------------------------------------------------- categories, product edits, counts, import (mirror 20261021000003 and 20261021000053)
export const demoCategories = (businessId: string) => (state.categories ?? []).filter((c) => c.businessId === businessId).sort((a, b) => a.name.localeCompare(b.name))
export function demoCreateCategory(businessId: string, name: string): { error: string | null; id?: string } {
  const denied = guard(businessId); if (denied) return { error: denied }
  const n = name.trim()
  if (!n) return { error: 'Enter the category name.' }
  const have = demoCategories(businessId).find((c) => c.name.toLowerCase() === n.toLowerCase())
  if (have) return { error: 'duplicate key: this category already exists', id: have.id }
  const c: DCategory = { id: id('cat'), businessId, name: n }
  commit({ ...state, categories: [...(state.categories ?? []), c] })
  return { error: null, id: c.id }
}

/** Edits a product's details. Whether it tracks stock cannot be changed once it exists (the database does not allow it either). */
export function demoUpdateProduct(businessId: string, productId: string, v: { name: string; sku: string; barcode: string; sellingPrice: number; defaultCost: number | null; reorderLevel: number | null; categoryId: string | null }): string | null {
  const denied = guard(businessId); if (denied) return denied
  if (!v.name.trim()) return 'Enter the product name.'
  if (!(v.sellingPrice >= 0)) return 'Price cannot be negative.'
  const dup = (f: 'sku' | 'barcode') => v[f].trim() && state.products.some((x) => x.businessId === businessId && x.id !== productId && x[f]?.toLowerCase() === v[f].trim().toLowerCase())
  if (dup('sku')) return 'duplicate key: this SKU already exists'
  if (dup('barcode')) return 'duplicate key: this barcode already exists'
  if (!state.products.some((p) => p.id === productId && p.businessId === businessId)) return 'product not found'
  commit({ ...state, products: state.products.map((p) => (p.id === productId ? { ...p, name: v.name.trim(), sku: v.sku.trim() || null, barcode: v.barcode.trim() || null, sellingPrice: v.sellingPrice, defaultCost: v.defaultCost, reorderLevel: v.reorderLevel, categoryId: v.categoryId } : p)) })
  return null
}

function withResult<T>(businessId: string, op: string, key: string, fn: (inv: Inv) => T): { error: string | null; result?: T } {
  const denied = guard(businessId); if (denied) return { error: denied }
  if (!key || key.length < 8) return { error: 'an idempotency key of at least 8 characters is required' }
  const prev = state.keys[`${businessId}|${key}`]
  if (prev) return prev.op === op ? { error: null, result: JSON.parse(prev.result) as T } : { error: 'idempotency key already used for another operation' }
  const next = cloneInv(state)
  let result: T
  try { result = fn(next) } catch (e) { return { error: (e as Error).message } }
  next.keys[`${businessId}|${key}`] = { op, result: JSON.stringify(result) }
  commit(next)
  return { error: null, result }
}

export const demoCounts = (businessId: string) => (state.counts ?? []).filter((c) => c.businessId === businessId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
/** Starts a count of one location: every active product that tracks stock, with what the books say is there. */
export function demoStartCount(businessId: string, locationId: string, key: string) {
  return withResult(businessId, 'count_start', key, (inv) => {
    location(inv, businessId, locationId)
    const c: DCount = { id: id('cnt'), businessId, locationId, status: 'open', createdAt: new Date().toISOString(), postedAt: null,
      items: inv.products.filter((p) => p.businessId === businessId && p.status === 'active' && p.tracksStock !== false).map((p) => ({ productId: p.id, expected: inv.balances[`${businessId}|${p.id}|${locationId}`]?.qty ?? 0, counted: null })) }
    inv.counts = [...(inv.counts ?? []), c]
    return { countId: c.id }
  })
}
export function demoRecordCount(businessId: string, countId: string, productId: string, counted: number | null): string | null {
  const denied = guard(businessId); if (denied) return denied
  const c = (state.counts ?? []).find((x) => x.id === countId && x.businessId === businessId)
  if (!c) return 'count not found'
  if (c.status !== 'open') return 'count is already posted'
  if (counted !== null && !(counted >= 0)) return 'counted quantity must be zero or more'
  if (!c.items.some((i) => i.productId === productId)) return 'product is not part of this count'
  commit({ ...state, counts: (state.counts ?? []).map((x) => (x.id === countId ? { ...x, items: x.items.map((i) => (i.productId === productId ? { ...i, counted } : i)) } : x)) })
  return null
}
/** Applies each counted difference against the balance now (not the one when the count started), so stock ends up equal to what was counted. */
export function demoPostCount(businessId: string, countId: string, key: string) {
  return withResult(businessId, 'count_post', key, (inv) => {
    const c = (inv.counts ?? []).find((x) => x.id === countId && x.businessId === businessId)
    if (!c) throw new Error('count not found')
    if (c.status !== 'open') throw new Error('count is already posted')
    const group = id('g'); let adjusted = 0
    for (const i of c.items.filter((x) => x.counted !== null)) {
      const cur = inv.balances[`${businessId}|${i.productId}|${c.locationId}`]?.qty ?? 0
      if (i.counted !== cur) { postMovement(inv, inv.products.find((p) => p.id === i.productId)!, c.locationId, 'count_adjustment', (i.counted as number) - cur, null, `Stock count ${c.id.slice(0, 8)}`, group); adjusted++ }
    }
    c.status = 'posted'; c.postedAt = new Date().toISOString()
    return { adjusted }
  })
}

export interface DProductImportRow { name?: string; sku?: string; barcode?: string; unit?: string; type?: string; category?: string; price?: string; cost?: string; reorder?: string; quantity?: string }
export interface DProductImportResult { created: number; stocked: number; duplicates: number[]; invalid: { row: number; reason: string }[] }
/** Mirrors inventory_import_products(): up to 500 rows, duplicates by SKU, barcode or name skipped, services have no stock, opening stock goes through the ledger, all or nothing. */
export function demoImportProducts(businessId: string, locationId: string | null, rows: DProductImportRow[], key: string) {
  return withResult(businessId, 'import_products', key, (inv): DProductImportResult => {
    if (!rows.length) throw new Error('there are no rows to import')
    if (rows.length > 500) throw new Error('import at most 500 rows at a time')
    if (locationId) location(inv, businessId, locationId)
    const dups: number[] = []; const bad: { row: number; reason: string }[] = []; const seen = new Set<string>(); const group = id('g'); let created = 0; let stocked = 0
    const num = (s: string | undefined) => (s === undefined || s.trim() === '' ? null : Number(s))
    rows.forEach((r, idx) => {
      const i = idx + 1; const name = (r.name ?? '').trim(); const sku = (r.sku ?? '').trim() || null; const barcode = (r.barcode ?? '').trim() || null
      const unit = ((r.unit ?? '').trim() || 'each').toLowerCase(); const service = ['service', 'services'].includes((r.type ?? '').toLowerCase())
      if (!name) return void bad.push({ row: i, reason: 'no name' })
      if (name.length > 200) return void bad.push({ row: i, reason: 'name is too long' })
      if (!demoUnits.includes(unit)) return void bad.push({ row: i, reason: `unknown unit ${unit}` })
      const price = num(r.price) ?? 0; const cost = num(r.cost); const reorder = num(r.reorder); const qty = num(r.quantity) ?? 0
      if ([price, cost, reorder, qty].some((x) => x !== null && Number.isNaN(x))) return void bad.push({ row: i, reason: 'a price, cost, reorder level or quantity is not a number' })
      if (price < 0 || (cost ?? 0) < 0 || (reorder ?? 0) < 0 || qty < 0) return void bad.push({ row: i, reason: 'a price, cost, reorder level or quantity is negative' })
      if (qty > 0 && service) return void bad.push({ row: i, reason: 'a service has no stock to count' })
      if (qty > 0 && !locationId) return void bad.push({ row: i, reason: 'choose where the opening stock goes' })
      const k = sku ? `s:${sku.toLowerCase()}` : barcode ? `b:${barcode.toLowerCase()}` : `n:${name.toLowerCase()}`
      const mine = inv.products.filter((p) => p.businessId === businessId)
      if (seen.has(k) || (sku && mine.some((p) => p.sku?.toLowerCase() === sku.toLowerCase())) || (barcode && mine.some((p) => p.barcode?.toLowerCase() === barcode.toLowerCase())) || (!sku && !barcode && mine.some((p) => p.name.toLowerCase() === name.toLowerCase()))) return void dups.push(i)
      seen.add(k)
      let categoryId: string | null = null; const cat = (r.category ?? '').trim()
      if (cat) {
        let c = (inv.categories ?? []).find((x) => x.businessId === businessId && x.name.toLowerCase() === cat.toLowerCase())
        if (!c) { c = { id: id('cat'), businessId, name: cat }; inv.categories = [...(inv.categories ?? []), c] }
        categoryId = c.id
      }
      const p: DProduct = { id: id('p'), businessId, sku, barcode, name, unit, sellingPrice: Math.round(price * 100) / 100, defaultCost: cost, reorderLevel: reorder, status: 'active', tracksStock: !service, categoryId }
      inv.products.push(p); created++
      if (qty > 0) { postMovement(inv, p, locationId as string, 'receipt', qty, cost, 'Opening stock (import)', group); stocked++ }
    })
    return { created, stocked, duplicates: dups, invalid: bad }
  })
}
