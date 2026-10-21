import { commitInv, demoEnsureProduct, ensureDemoInventory, getInv, newId, postMovement } from '@/demo/demoInventory'
import type { Inv } from '@/demo/demoInventory'
import { demoAllowed } from '@/demo/demoTrade'

/**
 * Browser-only farm records for demo mode. Mirrors supabase/migrations/20261021000006_farm.sql:
 * population is the sum of an append-only event list, corrections are opposite-sign events, estimated counts
 * record an explicit adjustment, feed and produce move through the shared demo inventory.
 */
export type Production = 'poultry' | 'fish' | 'crop' | 'livestock'
export interface FUnit { id: string; businessId: string; name: string; unitType: string; productionType: Production; capacity: number | null; status: 'active' | 'archived' }
export interface FBatch { id: string; businessId: string; unitId: string; code: string; productionType: Production; species: string; variety: string | null; basis: 'exact' | 'estimated'; opening: number; startDate: string; plannedEnd: string | null; status: 'active' | 'closed'; closeReason: string | null }
export interface FEvent { id: string; businessId: string; batchId: string; type: string; quantity: number; reason: string | null; on: string; reversesId: string | null }
export interface FFeed { id: string; businessId: string; batchId: string; productId: string; quantity: number; on: string; notes: string | null; status: 'posted' | 'voided'; movementId: string }
export interface FHarvest { id: string; businessId: string; batchId: string; productId: string; quantity: number; date: string; animalsRemoved: number | null; removalEventId: string | null; status: 'posted' | 'voided'; movementId: string }
export interface FActivity { id: string; businessId: string; batchId: string | null; unitId: string | null; type: string; notes: string; on: string }

interface Farm { units: FUnit[]; batches: FBatch[]; events: FEvent[]; feeds: FFeed[]; harvests: FHarvest[]; activities: FActivity[]; keys: Record<string, string>; seeded: string[] }
const KEY = 'doa.demo.farm.v1'
const empty = (): Farm => ({ units: [], batches: [], events: [], feeds: [], harvests: [], activities: [], keys: {}, seeded: [] })
function load(): Farm {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Farm) } } catch { /* fresh */ }
  return empty()
}
let state = load()
function commit(next: Farm) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}
export const getFarm = () => state
export const resetDemoFarm = () => commit(empty())

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
const pop = (f: Farm, batchId: string) => f.events.filter((e) => e.batchId === batchId).reduce((a, e) => a + e.quantity, 0)

export function ensureDemoFarm(biz: string) {
  if (state.seeded.includes(biz)) return
  ensureDemoInventory(biz, 'farm')
  demoEnsureProduct(biz, { name: 'Table eggs (crate)', unit: 'each', price: 1800, sku: 'EGG-CR' })
  demoEnsureProduct(biz, { name: 'Catfish (kg)', unit: 'kg', price: 2500, sku: 'FISH-KG' })
  const f: Farm = { ...state, units: [...state.units], batches: [...state.batches], events: [...state.events], seeded: [...state.seeded, biz] }
  const house: FUnit = { id: newId('fu'), businessId: biz, name: 'House A', unitType: 'poultry_house', productionType: 'poultry', capacity: 6000, status: 'active' }
  const pond: FUnit = { id: newId('fu'), businessId: biz, name: 'Pond 1', unitType: 'pond', productionType: 'fish', capacity: null, status: 'active' }
  f.units.push(house, pond)
  const layers: FBatch = { id: newId('fb'), businessId: biz, unitId: house.id, code: 'B-2026-04', productionType: 'poultry', species: 'Layer', variety: 'ISA Brown', basis: 'exact', opening: 5000, startDate: daysAgo(60), plannedEnd: null, status: 'active', closeReason: null }
  const cat: FBatch = { id: newId('fb'), businessId: biz, unitId: pond.id, code: 'F-2026-02', productionType: 'fish', species: 'Catfish', variety: null, basis: 'estimated', opening: 3000, startDate: daysAgo(45), plannedEnd: null, status: 'active', closeReason: null }
  f.batches.push(layers, cat)
  const ev = (b: FBatch, type: string, quantity: number, reason: string, on: string) => f.events.push({ id: newId('fe'), businessId: biz, batchId: b.id, type, quantity, reason, on, reversesId: null })
  ev(layers, 'opening', 5000, 'Opening quantity', layers.startDate); ev(layers, 'mortality', -120, 'Heat stress', daysAgo(20)); ev(layers, 'mortality', -60, 'Disease', daysAgo(6))
  ev(cat, 'opening', 3000, 'Opening quantity', cat.startDate); ev(cat, 'mortality', -90, 'Low oxygen', daysAgo(10))
  commit(f)
}

type Ctx = { f: Farm; inv: Inv; biz: string }
function run<R>(biz: string, op: string, key: string, module: string, perm: string, fn: (c: Ctx) => R): { error: string | null; result?: R } {
  if (!demoAllowed(biz, module, perm)) return { error: 'permission denied' }
  if (!key || key.length < 8) return { error: 'an idempotency key of at least 8 characters is required' }
  const prev = state.keys[`${biz}|${key}`]
  if (prev) {
    const i = prev.indexOf('|')
    return prev.slice(0, i) === op ? { error: null, result: JSON.parse(prev.slice(i + 1)) as R } : { error: 'idempotency key already used for another operation' }
  }
  const inv0 = getInv()
  const inv: Inv = { ...inv0, balances: { ...inv0.balances }, movements: [...inv0.movements] }
  const f: Farm = JSON.parse(JSON.stringify(state)) as Farm
  try {
    const result = fn({ f, inv, biz })
    f.keys[`${biz}|${key}`] = `${op}|${JSON.stringify(result ?? null)}`
    commitInv(inv)
    commit(f)
    return { error: null, result }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

const batchOf = (f: Farm, biz: string, id: string) => {
  const b = f.batches.find((x) => x.id === id && x.businessId === biz)
  if (!b) throw new Error('batch not found')
  return b
}
const active = (b: FBatch) => { if (b.status !== 'active') throw new Error(`batch ${b.code} is closed`) }
const trim = (n: number) => String(Math.round(n * 100) / 100)

function postEvent(f: Farm, biz: string, b: FBatch, type: string, quantity: number, reason: string | null, on: string, reversesId: string | null = null): FEvent {
  active(b)
  const p = pop(f, b.id)
  if (p + quantity < 0) {
    if (b.basis === 'estimated' && ['removal', 'cull', 'mortality'].includes(type)) {
      f.events.push({ id: newId('fe'), businessId: biz, batchId: b.id, type: 'adjustment', quantity: -(p + quantity), reason: 'Count exceeded the estimated population', on, reversesId: null })
    } else throw new Error(`only ${trim(p)} remain in batch ${b.code}`)
  }
  const e: FEvent = { id: newId('fe'), businessId: biz, batchId: b.id, type, quantity, reason, on, reversesId }
  f.events.push(e)
  return e
}
const needReason = (r: string | null | undefined, what: string) => { if ((r ?? '').trim().length < 3) throw new Error(`${what} is required`) }

export function demoCreateUnit(biz: string, u: { name: string; unitType: string; productionType: Production; capacity: number | null }): string | null {
  if (!demoAllowed(biz, 'farm-units', 'farm.manage')) return 'permission denied'
  if (!u.name.trim()) return 'Enter the unit name.'
  if (state.units.some((x) => x.businessId === biz && x.name.toLowerCase() === u.name.trim().toLowerCase())) return 'duplicate key: a unit with this name already exists'
  commit({ ...state, units: [...state.units, { id: newId('fu'), businessId: biz, name: u.name.trim(), unitType: u.unitType, productionType: u.productionType, capacity: u.capacity, status: 'active' }] })
  return null
}

export function demoStartBatch(biz: string, b: { unitId: string; code: string; species: string; variety: string; productionType: Production; opening: number; startDate: string; plannedEnd: string | null; basis: 'exact' | 'estimated' }, key: string) {
  return run(biz, 'farm_start_batch', key, 'farm-batches', 'farm.manage', ({ f }) => {
    const unit = f.units.find((u) => u.id === b.unitId && u.businessId === biz && u.status === 'active')
    if (!unit) throw new Error('unknown or archived production unit')
    if (unit.productionType !== b.productionType) throw new Error(`unit "${unit.name}" is for ${unit.productionType} production, not ${b.productionType}`)
    if (!b.code.trim()) throw new Error('Enter a batch code.')
    if (f.batches.some((x) => x.businessId === biz && x.code === b.code.trim())) throw new Error('duplicate key: this batch code already exists')
    if (!(b.opening > 0)) throw new Error('opening quantity must be greater than zero')
    if (b.plannedEnd && b.plannedEnd < b.startDate) throw new Error('planned end date is before the start date')
    const batch: FBatch = { id: newId('fb'), businessId: biz, unitId: b.unitId, code: b.code.trim(), productionType: b.productionType, species: b.species, variety: b.variety.trim() || null, basis: b.basis, opening: b.opening, startDate: b.startDate, plannedEnd: b.plannedEnd, status: 'active', closeReason: null }
    f.batches.push(batch)
    f.events.push({ id: newId('fe'), businessId: biz, batchId: batch.id, type: 'opening', quantity: b.opening, reason: 'Opening quantity', on: b.startDate, reversesId: null })
    return { batchId: batch.id }
  })
}

export function demoRecordMortality(biz: string, batchId: string, qty: number, cause: string, on: string, key: string) {
  return run(biz, 'farm_mortality', key, 'farm-mortality', 'farm.record', ({ f }) => {
    if (!(qty > 0)) throw new Error('quantity must be greater than zero')
    needReason(cause, 'a cause')
    return { eventId: postEvent(f, biz, batchOf(f, biz, batchId), 'mortality', -qty, cause, on).id }
  }).error
}

export function demoAdjustPopulation(biz: string, batchId: string, type: 'cull' | 'removal' | 'adjustment', qty: number, reason: string, on: string, key: string) {
  return run(biz, 'farm_adjust', key, 'farm-batches', 'farm.manage', ({ f }) => {
    if (!qty) throw new Error('quantity cannot be zero')
    if (type !== 'adjustment' && qty < 0) throw new Error('enter a positive quantity')
    if (type !== 'removal') needReason(reason, 'a reason')
    return { eventId: postEvent(f, biz, batchOf(f, biz, batchId), type, type === 'adjustment' ? qty : -qty, reason, on).id }
  }).error
}

export function demoRecordFeeding(biz: string, batchId: string, productId: string, locationId: string, qty: number, on: string, notes: string, key: string) {
  return run(biz, 'farm_feeding', key, 'farm-feeding', 'farm.record', ({ f, inv }) => {
    const b = batchOf(f, biz, batchId); active(b)
    if (!(qty > 0)) throw new Error('quantity must be greater than zero')
    const p = inv.products.find((x) => x.id === productId && x.businessId === biz && x.status === 'active')
    if (!p) throw new Error('invalid feed product')
    if (!inv.locations.some((l) => l.id === locationId && l.businessId === biz)) throw new Error('unknown or inactive location')
    const m = postMovement(inv, p, locationId, 'production_consumption', -qty, null, `Feed ${b.code}`, newId('g'))
    f.feeds.push({ id: newId('ff'), businessId: biz, batchId, productId, quantity: qty, on, notes: notes || null, status: 'posted', movementId: m.id })
    return {}
  }).error
}

export function demoRecordHarvest(biz: string, batchId: string, productId: string, locationId: string, qty: number, on: string, animalsRemoved: number | null, key: string) {
  return run(biz, 'farm_harvest', key, 'farm-harvests', 'farm.record', ({ f, inv }) => {
    const b = batchOf(f, biz, batchId); active(b)
    if (!(qty > 0)) throw new Error('quantity must be greater than zero')
    if (animalsRemoved !== null && !(animalsRemoved > 0)) throw new Error('animals removed must be greater than zero')
    const p = inv.products.find((x) => x.id === productId && x.businessId === biz && x.status === 'active')
    if (!p) throw new Error('invalid produce product')
    if (!inv.locations.some((l) => l.id === locationId && l.businessId === biz)) throw new Error('unknown or inactive location')
    const ev = animalsRemoved !== null ? postEvent(f, biz, b, 'removal', -animalsRemoved, 'Harvest', on) : null
    const m = postMovement(inv, p, locationId, 'production_output', qty, null, `Harvest ${b.code}`, newId('g'))
    f.harvests.push({ id: newId('fh'), businessId: biz, batchId, productId, quantity: qty, date: on, animalsRemoved, removalEventId: ev?.id ?? null, status: 'posted', movementId: m.id })
    return {}
  }).error
}

export function demoReverseEvent(biz: string, eventId: string, reason: string, key: string) {
  return run(biz, 'farm_reverse', key, 'farm-batches', 'farm.manage', ({ f }) => {
    const e = f.events.find((x) => x.id === eventId && x.businessId === biz)
    if (!e) throw new Error('event not found')
    if (!['mortality', 'removal', 'cull', 'adjustment'].includes(e.type)) throw new Error('this kind of event cannot be reversed')
    if (f.events.some((x) => x.reversesId === eventId)) throw new Error('event was already reversed')
    if (f.harvests.some((h) => h.removalEventId === eventId)) throw new Error('void the harvest instead')
    needReason(reason, 'a reason')
    return { eventId: postEvent(f, biz, batchOf(f, biz, e.batchId), 'correction', -e.quantity, reason, today(), eventId).id }
  }).error
}

export function demoVoidFeeding(biz: string, feedId: string, reason: string, key: string) {
  return run(biz, 'farm_void_feed', key, 'farm-feeding', 'farm.manage', ({ f, inv }) => {
    const r = f.feeds.find((x) => x.id === feedId && x.businessId === biz)
    if (!r) throw new Error('feeding record not found')
    if (r.status !== 'posted') throw new Error('record is already voided')
    needReason(reason, 'a reason')
    const mv = inv.movements.find((m) => m.id === r.movementId)!
    postMovement(inv, inv.products.find((p) => p.id === r.productId)!, mv.locationId, 'reversal', -mv.delta, mv.unitCost, 'Void feeding', newId('g'), mv.id)
    r.status = 'voided'
    return {}
  }).error
}

export function demoVoidHarvest(biz: string, harvestId: string, reason: string, key: string) {
  return run(biz, 'farm_void_harvest', key, 'farm-harvests', 'farm.manage', ({ f, inv }) => {
    const h = f.harvests.find((x) => x.id === harvestId && x.businessId === biz)
    if (!h) throw new Error('harvest not found')
    if (h.status !== 'posted') throw new Error('record is already voided')
    needReason(reason, 'a reason')
    const mv = inv.movements.find((m) => m.id === h.movementId)!
    postMovement(inv, inv.products.find((p) => p.id === h.productId)!, mv.locationId, 'reversal', -mv.delta, mv.unitCost, 'Void harvest', newId('g'), mv.id)
    if (h.removalEventId) {
      const orig = f.events.find((e) => e.id === h.removalEventId)!
      postEvent(f, biz, batchOf(f, biz, h.batchId), 'correction', -orig.quantity, reason, today(), orig.id)
    }
    h.status = 'voided'
    return {}
  }).error
}

export function demoCloseBatch(biz: string, batchId: string, reason: string, writeOff: boolean, key: string) {
  return run(biz, 'farm_close', key, 'farm-batches', 'farm.manage', ({ f }) => {
    const b = batchOf(f, biz, batchId)
    if (b.status !== 'active') throw new Error('batch is already closed')
    needReason(reason, 'a reason')
    const p = pop(f, batchId)
    if (p > 0) {
      if (!writeOff) throw new Error(`${trim(p)} animals remain; confirm the write-off to close the batch`)
      postEvent(f, biz, b, 'closing', -p, reason, today())
    }
    b.status = 'closed'; b.closeReason = reason
    return {}
  }).error
}

export function demoAddActivity(biz: string, a: { batchId: string | null; unitId: string | null; type: string; notes: string; on: string }): string | null {
  if (!demoAllowed(biz, 'farm-daily', 'farm.record')) return 'permission denied'
  if (!a.notes.trim()) return 'Write a short note.'
  if (!a.batchId && !a.unitId) return 'Choose a batch or a unit.'
  commit({ ...state, activities: [...state.activities, { id: newId('fa'), businessId: biz, batchId: a.batchId, unitId: a.unitId, type: a.type, notes: a.notes.trim(), on: a.on }] })
  return null
}
