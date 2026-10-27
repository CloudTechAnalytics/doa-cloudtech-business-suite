import {
  demoAdjust, demoCan, demoCategories, demoCounts, demoCreateCategory, demoCreateProduct, demoImportProducts, demoIssue, demoLocations, demoPostCount, demoReceive, demoRecordCount, demoReverse, demoSaveLocation,
  demoSetLocationStatus, demoSetProductStatus, demoStartCount, demoTransfer, demoUpdateProduct,
  ensureDemoInventory, useDemoInventory,
} from '@/demo/demoInventory'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import type { IndustryCode } from '@/shared/types/domain'

export interface Product { id: string; sku: string | null; barcode: string | null; name: string; unit: string; sellingPrice: number; defaultCost: number | null; reorderLevel: number | null; status: 'active' | 'archived'; /** false for a service: sold like a product, but no stock is kept. */ tracksStock: boolean; categoryId: string | null }
export interface Category { id: string; name: string }
export interface Location { id: string; name: string }
export interface StockLine { productId: string; locationId: string; qty: number; avgCost: number | null }
export interface MovementRow { id: string; productId: string; locationId: string; type: string; delta: number; unitCost: number | null; reason: string | null; at: string; reversalOf: string | null; reversed: boolean }
export interface InventoryData { products: Product[]; locations: Location[]; balances: StockLine[]; movements: MovementRow[]; units: string[]; categories: Category[] }
export interface LocationRow { id: string; name: string; type: string; active: boolean; stocked: number }
export const LOCATION_TYPES = [['store', 'Store'], ['shelf', 'Shelf'], ['warehouse', 'Warehouse'], ['farm_store', 'Farm store'], ['kitchen', 'Kitchen']] as const

export async function listLocations(businessId: string, industry: IndustryCode): Promise<LocationRow[]> {
  if (isDemoMode) { ensureDemoInventory(businessId, industry); return demoLocations(businessId) }
  const db = supabase!
  const [l, b] = await Promise.all([
    db.from('inventory_locations').select('id, name, location_type, status').eq('business_id', businessId).order('name'),
    db.from('inventory_balances').select('location_id, quantity_on_hand').eq('business_id', businessId),
  ])
  if (l.error) throw new Error(l.error.message)
  return (l.data ?? []).map((x) => ({ id: x.id, name: x.name, type: x.location_type, active: x.status === 'active', stocked: (b.data ?? []).filter((y) => y.location_id === x.id && Number(y.quantity_on_hand) !== 0).length }))
}
export async function saveLocation(businessId: string, v: { id: string | null; name: string; type: string }) {
  if (isDemoMode) return demoSaveLocation(businessId, v)
  const name = v.name.trim()
  if (!name) return 'Enter the location name.'
  const db = supabase!
  const res = v.id === null ? await db.from('inventory_locations').insert({ business_id: businessId, name, location_type: v.type }) : await db.from('inventory_locations').update({ name, location_type: v.type }).eq('id', v.id).eq('business_id', businessId)
  if (res.error?.code === '23505') return 'duplicate key: a location with this name already exists'
  return err(res.error)
}
export async function setLocationStatus(businessId: string, id: string, status: 'active' | 'archived') {
  if (isDemoMode) return demoSetLocationStatus(businessId, id, status)
  return err((await supabase!.from('inventory_locations').update({ status }).eq('id', id).eq('business_id', businessId)).error)
}

export interface Line { productId: string; quantity: number; unitCost?: number | null }
export interface NewProduct { name: string; sku: string; barcode: string; unit: string; sellingPrice: number; defaultCost: number | null; reorderLevel: number | null; tracksStock?: boolean; categoryId?: string | null }
export interface ProductEdit { name: string; sku: string; barcode: string; sellingPrice: number; defaultCost: number | null; reorderLevel: number | null; categoryId: string | null }

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const err = (e: { message: string } | null) => e?.message ?? null
const items = (lines: Line[]) => lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, unit_cost: l.unitCost ?? null }))

export async function loadInventory(businessId: string): Promise<InventoryData> {
  const db = supabase!
  const [u, l, p, b, m, c] = await Promise.all([
    db.from('units_of_measure').select('id, code').eq('business_id', businessId),
    db.from('inventory_locations').select('id, name').eq('business_id', businessId).eq('status', 'active').order('name'),
    db.from('products').select('id, sku, barcode, name, base_unit_id, selling_price, default_purchase_cost, reorder_level, status, tracks_stock, category_id').eq('business_id', businessId).order('name'),
    db.from('inventory_balances').select('product_id, location_id, quantity_on_hand, avg_unit_cost').eq('business_id', businessId),
    db.from('stock_movements').select('id, product_id, location_id, movement_type, quantity_delta, unit_cost, reason, occurred_at, reversal_of_movement_id').eq('business_id', businessId).order('occurred_at', { ascending: false }).limit(300),
    db.from('product_categories').select('id, name').eq('business_id', businessId).order('name'),
  ])
  const failed = [u, l, p, b, m, c].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  const unitCode = new Map((u.data ?? []).map((x) => [x.id, x.code as string]))
  const reversed = new Set((m.data ?? []).map((x) => x.reversal_of_movement_id).filter(Boolean))
  return {
    units: [...unitCode.values()],
    categories: (c.data ?? []) as Category[],
    locations: (l.data ?? []) as Location[],
    products: (p.data ?? []).map((x) => ({ id: x.id, sku: x.sku, barcode: x.barcode, name: x.name, unit: unitCode.get(x.base_unit_id) ?? '', sellingPrice: Number(x.selling_price), defaultCost: num(x.default_purchase_cost), reorderLevel: num(x.reorder_level), status: x.status, tracksStock: x.tracks_stock !== false, categoryId: x.category_id ?? null })),
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
    categories: demoCategories(businessId).map((c) => ({ id: c.id, name: c.name })),
    products: products.map((p) => ({ id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, unit: p.unit, sellingPrice: p.sellingPrice, defaultCost: p.defaultCost, reorderLevel: p.reorderLevel, status: p.status, tracksStock: p.tracksStock !== false, categoryId: p.categoryId ?? null })),
    locations: inv.locations.filter((l) => l.businessId === businessId && (l.status ?? 'active') === 'active').map((l) => ({ id: l.id, name: l.name })),
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
    selling_price: p.sellingPrice, default_purchase_cost: p.defaultCost, reorder_level: p.reorderLevel, tracks_stock: p.tracksStock ?? true, category_id: p.categoryId ?? null,
  })).error)
}

/** Edits a product's details. Whether it keeps stock is fixed when it is created. */
export async function updateProduct(businessId: string, productId: string, v: ProductEdit): Promise<string | null> {
  if (isDemoMode) return demoUpdateProduct(businessId, productId, v)
  if (!v.name.trim()) return 'Enter the product name.'
  const res = await supabase!.from('products').update({
    name: v.name.trim(), sku: v.sku.trim() || null, barcode: v.barcode.trim() || null, selling_price: v.sellingPrice, default_purchase_cost: v.defaultCost, reorder_level: v.reorderLevel, category_id: v.categoryId,
  }).eq('id', productId).eq('business_id', businessId)
  if (res.error?.code === '23505') return 'duplicate key: this SKU or barcode is already used by another product'
  return err(res.error)
}

/** Adds a category and returns it (an existing one with the same name is returned instead of an error). */
export async function createCategory(businessId: string, name: string): Promise<{ error: string | null; category?: Category }> {
  const n = name.trim()
  if (!n) return { error: 'Enter the category name.' }
  if (isDemoMode) { const r = demoCreateCategory(businessId, n); return r.id ? { error: null, category: { id: r.id, name: n } } : { error: r.error } }
  const { data, error } = await supabase!.from('product_categories').insert({ business_id: businessId, name: n }).select('id, name').single()
  if (error?.code === '23505') {
    const have = await supabase!.from('product_categories').select('id, name').eq('business_id', businessId).ilike('name', n).maybeSingle()
    return have.data ? { error: null, category: have.data as Category } : { error: error.message }
  }
  return error ? { error: error.message } : { error: null, category: data as Category }
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

// ------------------------------------------------------------------------------------ stock counts
export interface CountItem { productId: string; expected: number; counted: number | null }
export interface CountRow { id: string; locationId: string; status: 'open' | 'posted'; createdAt: string; postedAt: string | null; items: CountItem[] }

export async function listCounts(businessId: string): Promise<CountRow[]> {
  if (isDemoMode) return demoCounts(businessId).map((c) => ({ id: c.id, locationId: c.locationId, status: c.status, createdAt: c.createdAt, postedAt: c.postedAt, items: c.items.map((i) => ({ ...i })) }))
  const [c, i] = await Promise.all([
    supabase!.from('stock_counts').select('id, location_id, status, created_at, posted_at').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50),
    supabase!.from('stock_count_items').select('stock_count_id, product_id, expected_quantity, counted_quantity').eq('business_id', businessId),
  ])
  const failed = [c, i].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  return (c.data ?? []).map((x) => ({
    id: x.id, locationId: x.location_id, status: x.status, createdAt: x.created_at, postedAt: x.posted_at,
    items: (i.data ?? []).filter((y) => y.stock_count_id === x.id).map((y) => ({ productId: y.product_id, expected: Number(y.expected_quantity), counted: num(y.counted_quantity) })),
  }))
}
export async function startCount(b: string, location: string, key: string): Promise<{ error: string | null; countId?: string }> {
  if (isDemoMode) { const r = demoStartCount(b, location, key); return { error: r.error, countId: r.result?.countId } }
  const { data, error } = await supabase!.rpc('stock_count_start', { p_business: b, p_location: location, p_key: key })
  return { error: err(error), countId: (data as { count_id?: string } | null)?.count_id }
}
export async function recordCount(b: string, countId: string, productId: string, counted: number | null) {
  if (isDemoMode) return demoRecordCount(b, countId, productId, counted)
  return rpc('stock_count_record', { p_count: countId, p_product: productId, p_counted: counted })
}
export async function postCount(b: string, countId: string, key: string): Promise<{ error: string | null; adjusted?: number }> {
  if (isDemoMode) { const r = demoPostCount(b, countId, key); return { error: r.error, adjusted: r.result?.adjusted } }
  const { data, error } = await supabase!.rpc('stock_count_post', { p_count: countId, p_key: key })
  return { error: err(error), adjusted: ((data as { movement_ids?: string[] } | null)?.movement_ids ?? []).length }
}

// ------------------------------------------------------------------------------------ import
export interface ProductImportRow { name: string; sku?: string; barcode?: string; unit?: string; type?: string; category?: string; price?: string; cost?: string; reorder?: string; quantity?: string }
export interface ProductImportResult { created: number; stocked: number; duplicates: number[]; invalid: { row: number; reason: string }[] }
/** Brings a product list in (up to 500 rows), with opening stock into one location. All or nothing; the same key never imports twice. */
export async function importProducts(b: string, location: string | null, rows: ProductImportRow[], key: string): Promise<{ error: string | null; result?: ProductImportResult }> {
  if (isDemoMode) return demoImportProducts(b, location, rows, key)
  const { data, error } = await supabase!.rpc('inventory_import_products', { p_business: b, p_location: location, p_rows: rows, p_key: key })
  return error ? { error: error.message } : { error: null, result: data as ProductImportResult }
}
