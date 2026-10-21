import * as demo from '@/demo/demoFarm'
import { getInv } from '@/demo/demoInventory'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import type { FarmData, FarmProduct, NewBatch, NewFarmProduct, Production, ProductArea, ProductSource } from '../types'

/** Farm data access. Live mode reads row-level-secured tables and calls database functions; demo mode runs a browser mirror. */
const db = () => supabase!
const n = (v: unknown) => Number(v ?? 0)
const msg = (e: { message: string } | null) => e?.message ?? null

export async function loadFarm(b: string): Promise<FarmData> {
  if (isDemoMode) {
    demo.ensureDemoFarm(b)
    const f = demo.getFarm()
    const mine = <T extends { businessId: string }>(xs: T[]) => xs.filter((x) => x.businessId === b)
    const events = mine(f.events)
    const reversed = new Set(events.map((e) => e.reversesId).filter(Boolean))
    return {
      units: mine(f.units).map((u) => ({ id: u.id, name: u.name, unitType: u.unitType, productionType: u.productionType, capacity: u.capacity, status: u.status })),
      batches: mine(f.batches).map((x) => {
        const ev = events.filter((e) => e.batchId === x.id)
        const byId = new Map(ev.map((e) => [e.id, e]))
        return {
          id: x.id, code: x.code, unitId: x.unitId, productionType: x.productionType, species: x.species, variety: x.variety, basis: x.basis, opening: x.opening,
          startDate: x.startDate, plannedEnd: x.plannedEnd, status: x.status,
          population: ev.reduce((a, e) => a + e.quantity, 0),
          mortality: ev.filter((e) => e.type === 'mortality' || (e.reversesId && byId.get(e.reversesId)?.type === 'mortality')).reduce((a, e) => a - e.quantity, 0),
          entering: ev.filter((e) => e.type === 'opening' || e.type === 'transfer_in').reduce((a, e) => a + e.quantity, 0),
          feed: mine(f.feeds).filter((r) => r.batchId === x.id && r.status === 'posted').reduce((a, r) => a + r.quantity, 0),
          harvest: mine(f.harvests).filter((r) => r.batchId === x.id && r.status === 'posted').reduce((a, r) => a + r.quantity, 0),
        }
      }),
      events: events.map((e) => ({ id: e.id, batchId: e.batchId, type: e.type, quantity: e.quantity, reason: e.reason, on: e.on, reversesId: e.reversesId, reversed: reversed.has(e.id) })).reverse(),
      feeds: mine(f.feeds).map((r) => ({ id: r.id, batchId: r.batchId, productId: r.productId, quantity: r.quantity, on: r.on, notes: r.notes, status: r.status })).reverse(),
      harvests: mine(f.harvests).map((r) => ({ id: r.id, batchId: r.batchId, productId: r.productId, quantity: r.quantity, date: r.date, animalsRemoved: r.animalsRemoved, status: r.status })).reverse(),
      activities: mine(f.activities).map((a) => ({ id: a.id, batchId: a.batchId, unitId: a.unitId, type: a.type, notes: a.notes, on: a.on })).reverse(),
    }
  }
  const [u, s, e, fd, h, a] = await Promise.all([
    db().from('farm_units').select('*').eq('business_id', b).order('name'),
    db().from('farm_batch_summaries').select('*').eq('business_id', b).order('start_date', { ascending: false }),
    db().from('farm_batch_events').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(300),
    db().from('farm_feed_records').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(200),
    db().from('farm_harvests').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(200),
    db().from('farm_activity_logs').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(200),
  ])
  const failed = [u, s, e, fd, h, a].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  const reversed = new Set((e.data ?? []).map((x) => x.reverses_event_id).filter(Boolean))
  return {
    units: (u.data ?? []).map((x) => ({ id: x.id, name: x.name, unitType: x.unit_type, productionType: x.production_type, capacity: x.capacity === null ? null : n(x.capacity), status: x.status })),
    batches: (s.data ?? []).map((x) => ({
      id: x.id, code: x.batch_code, unitId: x.farm_unit_id, productionType: x.production_type, species: x.species_or_crop, variety: x.breed_or_variety, basis: x.count_basis, opening: n(x.opening_quantity),
      startDate: x.start_date, plannedEnd: x.planned_end_date, status: x.status, population: n(x.current_population), mortality: n(x.mortality_total), entering: n(x.entering_total), feed: n(x.feed_total), harvest: n(x.harvest_total),
    })),
    events: (e.data ?? []).map((x) => ({ id: x.id, batchId: x.farm_batch_id, type: x.event_type, quantity: n(x.quantity), reason: x.reason, on: x.occurred_on, reversesId: x.reverses_event_id, reversed: reversed.has(x.id) })),
    feeds: (fd.data ?? []).map((x) => ({ id: x.id, batchId: x.farm_batch_id, productId: x.product_id, quantity: n(x.quantity), on: x.fed_on, notes: x.notes, status: x.status })),
    harvests: (h.data ?? []).map((x) => ({ id: x.id, batchId: x.farm_batch_id, productId: x.product_id, quantity: n(x.quantity), date: x.harvest_date, animalsRemoved: x.animals_removed === null ? null : n(x.animals_removed), status: x.status })),
    activities: (a.data ?? []).map((x) => ({ id: x.id, batchId: x.farm_batch_id, unitId: x.farm_unit_id, type: x.activity_type, notes: x.notes, on: x.activity_on })),
  }
}

export async function createUnit(b: string, u: { name: string; unitType: string; productionType: Production; capacity: number | null }) {
  if (isDemoMode) return demo.demoCreateUnit(b, u)
  return msg((await db().from('farm_units').insert({ business_id: b, name: u.name.trim(), unit_type: u.unitType, production_type: u.productionType, capacity: u.capacity })).error)
}

export async function startBatch(b: string, x: NewBatch, key: string) {
  if (isDemoMode) return demo.demoStartBatch(b, x, key).error
  return msg((await db().rpc('farm_start_batch', { p_business: b, p_unit: x.unitId, p_code: x.code, p_species: x.species, p_variety: x.variety || null, p_production_type: x.productionType, p_opening: x.opening, p_start: x.startDate, p_planned_end: x.plannedEnd, p_basis: x.basis, p_key: key })).error)
}

export async function recordMortality(b: string, batch: string, qty: number, cause: string, on: string, key: string) {
  if (isDemoMode) return demo.demoRecordMortality(b, batch, qty, cause, on, key)
  return msg((await db().rpc('farm_record_mortality', { p_batch: batch, p_qty: qty, p_cause: cause, p_on: on, p_key: key })).error)
}

export async function adjustPopulation(b: string, batch: string, type: 'cull' | 'removal' | 'adjustment', qty: number, reason: string, on: string, key: string) {
  if (isDemoMode) return demo.demoAdjustPopulation(b, batch, type, qty, reason, on, key)
  return msg((await db().rpc('farm_adjust_population', { p_batch: batch, p_type: type, p_qty: qty, p_reason: reason, p_on: on, p_key: key })).error)
}

export async function recordFeeding(b: string, batch: string, product: string, location: string, qty: number, on: string, notes: string, key: string) {
  if (isDemoMode) return demo.demoRecordFeeding(b, batch, product, location, qty, on, notes, key)
  return msg((await db().rpc('farm_record_feeding', { p_batch: batch, p_product: product, p_location: location, p_qty: qty, p_on: on, p_notes: notes || null, p_key: key })).error)
}

export async function recordHarvest(b: string, batch: string, product: string, location: string, qty: number, on: string, animalsRemoved: number | null, key: string) {
  if (isDemoMode) return demo.demoRecordHarvest(b, batch, product, location, qty, on, animalsRemoved, key)
  return msg((await db().rpc('farm_record_harvest', { p_batch: batch, p_product: product, p_location: location, p_qty: qty, p_on: on, p_animals_removed: animalsRemoved, p_key: key })).error)
}

export async function reverseEvent(b: string, event: string, reason: string, key: string) {
  if (isDemoMode) return demo.demoReverseEvent(b, event, reason, key)
  return msg((await db().rpc('farm_reverse_event', { p_event: event, p_reason: reason, p_key: key })).error)
}

export async function voidFeeding(b: string, id: string, reason: string, key: string) {
  if (isDemoMode) return demo.demoVoidFeeding(b, id, reason, key)
  return msg((await db().rpc('farm_void_feeding', { p_feed: id, p_reason: reason, p_key: key })).error)
}

export async function voidHarvest(b: string, id: string, reason: string, key: string) {
  if (isDemoMode) return demo.demoVoidHarvest(b, id, reason, key)
  return msg((await db().rpc('farm_void_harvest', { p_harvest: id, p_reason: reason, p_key: key })).error)
}

export async function closeBatch(b: string, batch: string, reason: string, writeOff: boolean, key: string) {
  if (isDemoMode) return demo.demoCloseBatch(b, batch, reason, writeOff, key)
  return msg((await db().rpc('farm_close_batch', { p_batch: batch, p_reason: reason, p_write_off: writeOff, p_key: key })).error)
}

export async function addActivity(b: string, a: { batchId: string | null; unitId: string | null; type: string; notes: string; on: string }) {
  if (isDemoMode) return demo.demoAddActivity(b, a)
  return msg((await db().from('farm_activity_logs').insert({ business_id: b, farm_batch_id: a.batchId, farm_unit_id: a.unitId, activity_type: a.type, notes: a.notes.trim(), activity_on: a.on })).error)
}

export async function loadFarmProducts(b: string): Promise<FarmProduct[]> {
  if (isDemoMode) {
    demo.ensureDemoFarm(b)
    const inv = getInv()
    return demo.getFarm().profiles.filter((p) => p.businessId === b).flatMap((p) => {
      const x = inv.products.find((q) => q.id === p.productId && q.businessId === b)
      return x ? [{ id: x.id, name: x.name, sku: x.sku, description: '', price: x.sellingPrice, active: x.status === 'active', unit: x.unit, area: p.area, source: p.source, species: p.species, available: demo.demoProductAvailable(b, x.id, p) }] : []
    }).sort((a, c) => a.name.localeCompare(c.name))
  }
  const { data, error } = await db().from('farm_products').select('*').eq('business_id', b).order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((x) => ({
    id: x.id!, name: x.name!, sku: x.sku, description: x.description ?? '', price: n(x.selling_price), active: x.status === 'active', unit: x.unit_code!,
    area: x.production_type as ProductArea, source: x.source_kind as ProductSource, species: x.match_species, available: x.available_quantity === null ? null : n(x.available_quantity),
  }))
}

export async function createFarmProduct(b: string, p: NewFarmProduct, key: string) {
  if (isDemoMode) return demo.demoCreateFarmProduct(b, p, key)
  return msg((await db().rpc('farm_create_product', {
    p_business: b, p_name: p.name, p_sku: p.sku || null, p_production_type: p.area, p_source_kind: p.source, p_species: p.species || null,
    p_unit_code: p.unit, p_price: p.price, p_description: p.description || null, p_key: key,
  })).error)
}

export async function updateFarmProduct(b: string, id: string, v: { name: string; price: number; description: string; active: boolean }) {
  if (isDemoMode) return demo.demoUpdateFarmProduct(b, id, v)
  return msg((await db().rpc('farm_update_product', { p_product: id, p_name: v.name, p_price: v.price, p_description: v.description || null, p_active: v.active })).error)
}
