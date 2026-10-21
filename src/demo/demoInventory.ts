import { useSyncExternalStore } from 'react'
import { applyMovement } from '@/modules/inventory/ledger'
import type { Balance } from '@/modules/inventory/ledger'
import { demoModuleStatuses, demoRoleIn } from '@/demo/demoStore'
import { rolePermissions } from '@/core/permissions/roles'

/** Browser-only inventory for demo mode; uses the same ledger rules as the database (see ledger.ts). */

export interface DProduct { id: string; businessId: string; sku: string | null; barcode: string | null; name: string; unit: string; sellingPrice: number; defaultCost: number | null; reorderLevel: number | null; status: 'active' | 'archived'; kind?: 'ingredient' | 'finished_good' | 'goods' }
/** A batch of finished goods with an expiry date; stock leaves the oldest-expiring lot first (mirrors bakery_lots). */
export interface DLot { id: string; businessId: string; productId: string; batchId: string; quantity: number; remaining: number; producedOn: string; expiresOn: string | null; voided: boolean }
export interface DAlloc { lotId: string; movementId: string; quantity: number; restored: boolean }
export interface DLocation { id: string; businessId: string; name: string }
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
}

const KEY = 'doa.demo.inv.v1'
let uid = Date.now()
const id = (p: string) => `${p}-${(uid++).toString(36)}`
const empty = (): Inv => ({ products: [], locations: [], movements: [], balances: {}, keys: {}, seeded: [], lots: [], allocs: [], lotProducts: [] })

/** A working copy for an operation that commits only if every step succeeds. */
export function cloneInv(inv: Inv): Inv {
  return { ...inv, balances: { ...inv.balances }, movements: [...inv.movements], keys: { ...inv.keys }, lots: (inv.lots ?? []).map((l) => ({ ...l })), allocs: (inv.allocs ?? []).map((a) => ({ ...a })), lotProducts: [...(inv.lotProducts ?? [])] }
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
function allocateLots(inv: Inv, p: DProduct, m: DMovement) {
  if (!inv.lotProducts?.includes(p.id) || ['production_output', 'transfer_in', 'transfer_out'].includes(m.type)) return
  const lots = (inv.lots ??= []); const allocs = (inv.allocs ??= [])
  if (m.reversalOf) {
    for (const a of allocs.filter((x) => x.movementId === m.reversalOf && !x.restored)) {
      const lot = lots.find((l) => l.id === a.lotId)
      if (lot && !lot.voided) lot.remaining = Math.round((lot.remaining + a.quantity) * 10000) / 10000
      a.restored = true
    }
    return
  }
  if (m.delta >= 0) return
  let need = -m.delta
  const order = lots.filter((l) => l.businessId === p.businessId && l.productId === p.id && l.remaining > 0 && !l.voided)
    .sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') || a.producedOn.localeCompare(b.producedOn))
  for (const l of order) {
    if (need <= 0) break
    const take = Math.min(l.remaining, need)
    l.remaining = Math.round((l.remaining - take) * 10000) / 10000
    allocs.push({ lotId: l.id, movementId: m.id, quantity: take, restored: false })
    need = Math.round((need - take) * 10000) / 10000
  }
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

export function demoCreateProduct(businessId: string, p: { name: string; sku: string; barcode: string; unit: string; sellingPrice: number; defaultCost: number | null; reorderLevel: number | null }): string | null {
  const denied = guard(businessId)
  if (denied) return denied
  if (!p.name.trim()) return 'Enter the product name.'
  const dup = (f: 'sku' | 'barcode') => p[f].trim() && state.products.some((x) => x.businessId === businessId && x[f]?.toLowerCase() === p[f].trim().toLowerCase())
  if (dup('sku')) return 'duplicate key: this SKU already exists'
  if (dup('barcode')) return 'duplicate key: this barcode already exists'
  commit({ ...state, products: [...state.products, { id: id('p'), businessId, name: p.name.trim(), sku: p.sku.trim() || null, barcode: p.barcode.trim() || null, unit: p.unit, sellingPrice: p.sellingPrice, defaultCost: p.defaultCost, reorderLevel: p.reorderLevel, status: 'active' }] })
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
