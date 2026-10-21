import { cloneInv, commitInv, getInv, newId, postMovement } from '@/demo/demoInventory'
import type { DProduct, Inv } from '@/demo/demoInventory'
import { demoAllowed } from '@/demo/demoTrade'

/**
 * Browser-only bakery records for demo mode. Mirrors supabase/migrations/20261021000013_bakery.sql: recipe versions are
 * immutable, a batch completes atomically (ingredients out, finished goods in at their unit cost, a lot with an expiry date),
 * a completed batch is corrected by a reversal, waste is a stock movement, and finished goods leave the oldest-expiring lot first.
 */
export interface BProfile { productId: string; businessId: string; shelfLifeDays: number | null; minStock: number | null }
export interface BRecipe { id: string; businessId: string; productId: string; name: string; status: 'active' | 'archived'; currentVersion: number }
export interface BVersion { id: string; recipeId: string; version: number; output: number; instructions: string | null }
export interface BLine { id: string; versionId: string; ingredientId: string; quantity: number; unit: string }
export type BatchStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'reversed'
export interface BBatch {
  id: string; businessId: string; number: string; recipeId: string; versionId: string; productId: string; locationId: string; date: string
  planned: number; actual: number | null; failed: number; status: BatchStatus; assignedTo: string | null; notes: string | null
  ingredientCost: number | null; unitCost: number | null; voidReason: string | null; createdAt: string
}
export interface BUsage { id: string; batchId: string; ingredientId: string; planned: number; actual: number | null; unitCost: number | null; lineCost: number | null; movementId: string | null }
export const WASTE_REASONS = ['expired', 'damaged', 'burnt', 'failed_batch', 'unsold', 'other'] as const
export type WasteReason = (typeof WASTE_REASONS)[number]
export interface BWaste { id: string; businessId: string; number: string; productId: string; locationId: string; quantity: number; reason: WasteReason; batchId: string | null; loss: number; notes: string | null; status: 'posted' | 'voided'; voidReason: string | null; movementId: string; createdAt: string }
export interface Bakery { profiles: BProfile[]; recipes: BRecipe[]; versions: BVersion[]; lines: BLine[]; batches: BBatch[]; usage: BUsage[]; waste: BWaste[]; seq: Record<string, number>; keys: Record<string, string>; seeded: string[] }

/** Unit definitions shared with the demo inventory (dimension and multiples of that dimension's smallest unit). */
export const UNITS: Record<string, { dimension: 'mass' | 'volume' | 'count'; factor: number }> = {
  each: { dimension: 'count', factor: 1 }, dozen: { dimension: 'count', factor: 12 }, kg: { dimension: 'mass', factor: 1000 }, g: { dimension: 'mass', factor: 1 },
  l: { dimension: 'volume', factor: 1000 }, ml: { dimension: 'volume', factor: 1 },
}

const KEY = 'doa.demo.bakery.v1'
const empty = (): Bakery => ({ profiles: [], recipes: [], versions: [], lines: [], batches: [], usage: [], waste: [], seq: {}, keys: {}, seeded: [] })
function load(): Bakery {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Bakery) } } catch { /* fresh */ }
  return empty()
}
let state = load()
export function commit(next: Bakery) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}
export const getBakery = () => state
export const resetDemoBakery = () => commit(empty())

export const r4 = (n: number) => Math.round(n * 10000) / 10000
export const r2 = (n: number) => Math.round(n * 100) / 100
export const today = () => new Date().toISOString().slice(0, 10)
export const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10)

// ----------------------------------------------------------------- plumbing
export type Out<R> = { error: string | null; result?: R }
export type Ctx = { b: Bakery; inv: Inv; biz: string }
export function run<R>(biz: string, op: string, key: string | null, modules: string[], perms: string[], fn: (c: Ctx) => R): Out<R> {
  if (!modules.some((m) => perms.some((p) => demoAllowed(biz, m, p)))) return { error: 'permission denied' }
  if (key !== null) {
    if (key.length < 8) return { error: 'an idempotency key of at least 8 characters is required' }
    const prev = state.keys[`${biz}|${key}`]
    if (prev) {
      const i = prev.indexOf('|')
      return prev.slice(0, i) === op ? { error: null, result: JSON.parse(prev.slice(i + 1)) as R } : { error: 'idempotency key already used for another operation' }
    }
  }
  const inv = cloneInv(getInv())
  const b: Bakery = JSON.parse(JSON.stringify(state)) as Bakery
  try {
    const result = fn({ b, inv, biz })
    if (key !== null) b.keys[`${biz}|${key}`] = `${op}|${JSON.stringify(result ?? null)}`
    commitInv(inv)
    commit(b)
    return { error: null, result }
  } catch (e) {
    return { error: (e as Error).message }
  }
}
export const nextNumber = (b: Bakery, biz: string, kind: string, prefix: string) => {
  const k = `${biz}|${kind}`
  b.seq[k] = (b.seq[k] ?? 0) + 1
  return `${prefix}-${String(b.seq[k]).padStart(6, '0')}`
}
export const prod = (inv: Inv, biz: string, id: string) => inv.products.find((p) => p.id === id && p.businessId === biz)
export const onHand = (inv: Inv, biz: string, productId: string, locationId?: string) =>
  Object.entries(inv.balances).filter(([k]) => k.startsWith(`${biz}|${productId}|`) && (!locationId || k.endsWith(`|${locationId}`))).reduce((a, [, v]) => a + v.qty, 0)
export const avgCost = (inv: Inv, biz: string, productId: string) => {
  const rows = Object.entries(inv.balances).filter(([k]) => k.startsWith(`${biz}|${productId}|`)).map(([, v]) => v).filter((v) => v.qty > 0)
  const qty = rows.reduce((a, v) => a + v.qty, 0)
  return qty > 0 ? rows.reduce((a, v) => a + v.qty * (v.avg ?? 0), 0) / qty : null
}
/** Mirrors bakery_ingredient_cost(): weighted average across stock, else the usual purchase cost. */
export const ingredientCost = (inv: Inv, biz: string, productId: string) => avgCost(inv, biz, productId) ?? prod(inv, biz, productId)?.defaultCost ?? 0
/** Mirrors bakery_line_base_qty(): a recipe line in the ingredient's own unit. */
export function lineBaseQty(inv: Inv, biz: string, line: BLine): number {
  const p = prod(inv, biz, line.ingredientId)!
  return r4((line.quantity * UNITS[line.unit].factor) / UNITS[p.unit].factor)
}
export const versionCost = (b: Bakery, inv: Inv, biz: string, versionId: string) =>
  r2(b.lines.filter((l) => l.versionId === versionId).reduce((a, l) => a + lineBaseQty(inv, biz, l) * ingredientCost(inv, biz, l.ingredientId), 0))

// ------------------------------------------------------- products, ingredients
export interface ProductInput { id: string | null; name: string; sku: string; unit: string; price: number; shelfLifeDays: number | null; minStock: number | null; description: string; active: boolean }

export function demoSaveBakeryProduct(biz: string, v: ProductInput, key: string) {
  return run(biz, 'bakery_product', v.id === null ? key : null, ['bakery-finished-goods'], ['bakery.manage'], ({ b, inv }) => {
    if (v.name.trim().length < 2) throw new Error('enter the product name (at least 2 characters)')
    if (!(v.price >= 0) || r2(v.price) !== v.price) throw new Error('price must be zero or more with at most 2 decimals')
    if (v.shelfLifeDays !== null && !(v.shelfLifeDays >= 1 && v.shelfLifeDays <= 365)) throw new Error('shelf life must be between 1 and 365 days')
    if (v.minStock !== null && v.minStock < 0) throw new Error('minimum stock cannot be negative')
    if (inv.products.some((p) => p.businessId === biz && p.id !== v.id && p.name.trim().toLowerCase() === v.name.trim().toLowerCase())) throw new Error('duplicate key: a product with this name already exists')
    if (v.id === null) {
      if (!UNITS[v.unit]) throw new Error('unknown unit')
      const id = newId('p')
      inv.products.push({ id, businessId: biz, sku: v.sku.trim() || null, barcode: null, name: v.name.trim(), unit: v.unit, sellingPrice: v.price, defaultCost: null, reorderLevel: null, status: 'active', kind: 'finished_good' })
      b.profiles.push({ productId: id, businessId: biz, shelfLifeDays: v.shelfLifeDays, minStock: v.minStock })
      ;(inv.lotProducts ??= []).push(id)
      return { productId: id }
    }
    const p = prod(inv, biz, v.id)
    const profile = b.profiles.find((x) => x.productId === v.id && x.businessId === biz)
    if (!p || !profile) throw new Error('product not found')
    // a price change only affects future sales: sold lines keep the price they were sold at
    Object.assign(p, { name: v.name.trim(), sku: v.sku.trim() || null, sellingPrice: v.price, status: v.active ? 'active' : 'archived' })
    Object.assign(profile, { shelfLifeDays: v.shelfLifeDays, minStock: v.minStock })
    return { productId: v.id }
  })
}

export interface IngredientInput { id: string | null; name: string; sku: string; unit: string; reorder: number | null; cost: number | null; active: boolean; openingQty: number | null; locationId: string }

export function demoSaveIngredient(biz: string, v: IngredientInput, key: string) {
  return run(biz, 'bakery_ingredient', v.id === null ? key : null, ['bakery-ingredients'], ['bakery.manage', 'inventory.adjust'], ({ inv }) => {
    if (v.name.trim().length < 2) throw new Error('enter the ingredient name (at least 2 characters)')
    if (v.reorder !== null && v.reorder < 0) throw new Error('reorder level cannot be negative')
    if (v.cost !== null && v.cost < 0) throw new Error('cost cannot be negative')
    if (inv.products.some((p) => p.businessId === biz && p.id !== v.id && p.name.trim().toLowerCase() === v.name.trim().toLowerCase())) throw new Error('duplicate key: a product with this name already exists')
    if (v.id === null) {
      if (!UNITS[v.unit]) throw new Error('unknown unit')
      const p: DProduct = { id: newId('p'), businessId: biz, sku: v.sku.trim() || null, barcode: null, name: v.name.trim(), unit: v.unit, sellingPrice: 0, defaultCost: v.cost, reorderLevel: v.reorder, status: 'active', kind: 'ingredient' }
      inv.products.push(p)
      if (v.openingQty !== null && v.openingQty > 0) {
        if (!inv.locations.some((l) => l.id === v.locationId && l.businessId === biz)) throw new Error('unknown or inactive location')
        postMovement(inv, p, v.locationId, 'receipt', v.openingQty, v.cost, 'Opening balance', newId('g'))
      }
      return { productId: p.id }
    }
    const p = inv.products.find((x) => x.id === v.id && x.businessId === biz && x.kind === 'ingredient')
    if (!p) throw new Error('ingredient not found')
    Object.assign(p, { name: v.name.trim(), sku: v.sku.trim() || null, defaultCost: v.cost, reorderLevel: v.reorder, status: v.active ? 'active' : 'archived' })
    return { productId: p.id }
  })
}

// -------------------------------------------------------------------- recipes
export interface RecipeLineInput { ingredientId: string; quantity: number; unit: string }

export function demoSaveRecipe(biz: string, v: { recipeId: string | null; productId: string; name: string; output: number; instructions: string; lines: RecipeLineInput[] }, key: string) {
  return run(biz, 'bakery_recipe', key, ['bakery-recipes'], ['bakery.manage'], ({ b, inv }) => {
    if (!(v.output > 0)) throw new Error('the batch output must be greater than zero')
    if (!v.lines.length || v.lines.length > 60) throw new Error('a recipe needs 1 to 60 ingredients')
    let recipe: BRecipe
    let version: number
    if (v.recipeId === null) {
      if (!v.name.trim()) throw new Error('enter the recipe name')
      if (!b.profiles.some((p) => p.productId === v.productId && p.businessId === biz)) throw new Error('choose a bakery product for this recipe')
      if (b.recipes.some((r) => r.businessId === biz && r.name.trim().toLowerCase() === v.name.trim().toLowerCase())) throw new Error('duplicate key: a recipe with this name already exists')
      recipe = { id: newId('rc'), businessId: biz, productId: v.productId, name: v.name.trim(), status: 'active', currentVersion: 1 }
      b.recipes.push(recipe); version = 1
    } else {
      const found = b.recipes.find((r) => r.id === v.recipeId && r.businessId === biz)
      if (!found) throw new Error('recipe not found')
      recipe = found; version = found.currentVersion + 1
    }
    const ver: BVersion = { id: newId('rv'), recipeId: recipe.id, version, output: v.output, instructions: v.instructions.trim() || null }
    const seen = new Set<string>()
    for (const l of v.lines) {
      const p = inv.products.find((x) => x.id === l.ingredientId && x.businessId === biz && x.kind === 'ingredient' && x.status === 'active')
      if (!p) throw new Error('choose an active ingredient on every line')
      if (seen.has(p.id)) throw new Error('each ingredient can appear once per recipe')
      seen.add(p.id)
      if (!(l.quantity > 0)) throw new Error('every ingredient needs a quantity above zero')
      const uf = UNITS[l.unit]
      if (!uf) throw new Error(`unknown unit "${l.unit}"`)
      if (uf.dimension !== UNITS[p.unit].dimension) throw new Error(`${p.name} is kept in ${p.unit} (${UNITS[p.unit].dimension}) and cannot be measured in ${l.unit} (${uf.dimension})`)
      b.lines.push({ id: newId('rl'), versionId: ver.id, ingredientId: p.id, quantity: r4(l.quantity), unit: l.unit })
    }
    b.versions.push(ver)
    recipe.currentVersion = version
    return { recipeId: recipe.id, version }
  })
}
