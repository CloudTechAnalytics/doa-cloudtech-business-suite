import {
  demoAdjust, demoCan, demoCreateProduct, demoIssue, demoReceive, demoReverse, demoSetProductStatus, demoTransfer,
  ensureDemoInventory, useDemoInventory,
} from '@/demo/demoInventory'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import type { IndustryCode } from '@/shared/types/domain'

export interface Product { id: string; sku: string | null; barcode: string | null; name: string; unit: string; sellingPrice: number; defaultCost: number | null; reorderLevel: number | null; status: 'active' | 'archived' }
export interface Location { id: string; name: string }
export interface StockLine { productId: string; locationId: string; qty: number; avgCost: number | null }
export interface MovementRow { id: string; productId: string; locationId: string; type: string; delta: number; unitCost: number | null; reason: string | null; at: string; reversalOf: string | null; reversed: boolean }
export interface InventoryData { products: Product[]; locations: Location[]; balances: StockLine[]; movements: MovementRow[]; units: string[] }
export interface Line { productId: string; quantity: number; unitCost?: number | null }
export interface NewProduct { name: string; sku: string; barcode: string; unit: string; sellingPrice: number; defaultCost: number | null; reorderLevel: number | null }

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const err = (e: { message: string } | null) => e?.message ?? null
const items = (lines: Line[]) => lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, unit_cost: l.unitCost ?? null }))

export async function loadInventory(businessId: string): Promise<InventoryData> {
  const db = supabase!
  const [u, l, p, b, m] = await Promise.all([
    db.from('units_of_measure').select('id, code').eq('business_id', businessId),
    db.from('inventory_locations').select('id, name').eq('business_id', businessId).eq('status', 'active').order('name'),
    db.from('products').select('id, sku, barcode, name, base_unit_id, selling_price, default_purchase_cost, reorder_level, status').eq('business_id', businessId).order('name'),
    db.from('inventory_balances').select('product_id, location_id, quantity_on_hand, avg_unit_cost').eq('business_id', businessId),
    db.from('stock_movements').select('id, product_id, location_id, movement_type, quantity_delta, unit_cost, reason, occurred_at, reversal_of_movement_id').eq('business_id', businessId).order('occurred_at', { ascending: false }).limit(300),
  ])
  const failed = [u, l, p, b, m].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  const unitCode = new Map((u.data ?? []).map((x) => [x.id, x.code as string]))
  const reversed = new Set((m.data ?? []).map((x) => x.reversal_of_movement_id).filter(Boolean))
  return {
    units: [...unitCode.values()],
    locations: (l.data ?? []) as Location[],
    products: (p.data ?? []).map((x) => ({ id: x.id, sku: x.sku, barcode: x.barcode, name: x.name, unit: unitCode.get(x.base_unit_id) ?? '', sellingPrice: Number(x.selling_price), defaultCost: num(x.default_purchase_cost), reorderLevel: num(x.reorder_level), status: x.status })),
    balances: (b.data ?? []).map((x) => ({ productId: x.product_id, locationId: x.location_id, qty: Number(x.quantity_on_hand), avgCost: num(x.avg_unit_cost) })),
    movements: (m.data ?? []).map((x) => ({ id: x.id, productId: x.product_id, locationId: x.location_id, type: x.movement_type, delta: Number(x.quantity_delta), unitCost: num(x.unit_cost), reason: x.reason, at: x.occurred_at, reversalOf: x.reversal_of_movement_id, reversed: reversed.has(x.id) })),
  }
}

/** Demo data selector (reactive). */
export function useDemoData(businessId: string, industry: IndustryCode, enabled: boolean): InventoryData | null {
  const inv = useDemoInventory()
  if (!enabled) return null
  if (!inv.seeded.includes(businessId)) queueMicrotask(() => ensureDemoInventory(businessId, industry))
  const products = inv.products.filter((p) => p.businessId === businessId)
  const reversed = new Set(inv.movements.map((m) => m.reversalOf).filter(Boolean))
  return {
    units: ['each', 'dozen', 'kg', 'g', 'l', 'ml'],
    products: products.map((p) => ({ id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, unit: p.unit, sellingPrice: p.sellingPrice, defaultCost: p.defaultCost, reorderLevel: p.reorderLevel, status: p.status })),
    locations: inv.locations.filter((l) => l.businessId === businessId).map((l) => ({ id: l.id, name: l.name })),
    balances: Object.entries(inv.balances)
      .filter(([k]) => k.startsWith(`${businessId}|`))
      .map(([k, v]) => { const [, productId, locationId] = k.split('|'); return { productId, locationId, qty: v.qty, avgCost: v.avg } }),
    movements: inv.movements.filter((m) => m.businessId === businessId).reverse().slice(0, 300)
      .map((m) => ({ id: m.id, productId: m.productId, locationId: m.locationId, type: m.type, delta: m.delta, unitCost: m.unitCost, reason: m.reason, at: m.at, reversalOf: m.reversalOf, reversed: reversed.has(m.id) })),
  }
}

export async function myPermissions(businessId: string): Promise<string[]> {
  if (isDemoMode) return ['inventory.read', 'inventory.adjust'].filter((p) => demoCan(businessId, p))
  const { data } = await supabase!.rpc('my_permissions', { p_business: businessId })
  return (data as string[] | null) ?? []
}

export async function createProduct(businessId: string, p: NewProduct): Promise<string | null> {
  if (isDemoMode) return demoCreateProduct(businessId, p)
  const { data: unit } = await supabase!.from('units_of_measure').select('id').eq('business_id', businessId).eq('code', p.unit).single()
  if (!unit) return 'unknown unit'
  return err((await supabase!.from('products').insert({
    business_id: businessId, name: p.name.trim(), sku: p.sku.trim() || null, barcode: p.barcode.trim() || null, base_unit_id: unit.id,
    selling_price: p.sellingPrice, default_purchase_cost: p.defaultCost, reorder_level: p.reorderLevel,
  })).error)
}

export async function setProductStatus(businessId: string, productId: string, status: 'active' | 'archived') {
  if (isDemoMode) return demoSetProductStatus(businessId, productId, status)
  return err((await supabase!.from('products').update({ status }).eq('id', productId).eq('business_id', businessId)).error)
}

const rpc = async (fn: string, args: Record<string, unknown>) => err((await supabase!.rpc(fn, args)).error)

export async function receive(b: string, loc: string, lines: Line[], reference: string, key: string) {
  if (isDemoMode) return demoReceive(b, loc, lines, reference, key)
  return rpc('inventory_receive_stock', { p_business: b, p_location: loc, p_items: items(lines), p_reference: reference || null, p_key: key })
}
export async function adjust(b: string, loc: string, product: string, delta: number, reason: string, key: string) {
  if (isDemoMode) return demoAdjust(b, loc, product, delta, reason, key)
  return rpc('inventory_adjust_stock', { p_business: b, p_location: loc, p_product: product, p_quantity_delta: delta, p_reason: reason, p_key: key })
}
export async function issue(b: string, loc: string, lines: Line[], reason: string, key: string) {
  if (isDemoMode) return demoIssue(b, loc, lines, reason, key)
  return rpc('inventory_issue_stock', { p_business: b, p_location: loc, p_items: items(lines), p_reason: reason, p_key: key })
}
export async function transfer(b: string, from: string, to: string, lines: Line[], key: string) {
  if (isDemoMode) return demoTransfer(b, from, to, lines, key)
  return rpc('inventory_transfer_stock', { p_business: b, p_from: from, p_to: to, p_items: items(lines), p_key: key })
}
export async function reverse(b: string, movementId: string, reason: string, key: string) {
  if (isDemoMode) return demoReverse(b, movementId, reason, key)
  return rpc('inventory_reverse_movement', { p_movement: movementId, p_reason: reason, p_key: key })
}
