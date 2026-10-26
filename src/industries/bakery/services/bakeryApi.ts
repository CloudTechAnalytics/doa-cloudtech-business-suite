import * as ops from '@/demo/demoBakeryOps'
import type { BakeryOverview, FinishedRow, IngredientRow, LotRow, Requirement, RecipeRow } from '@/demo/demoBakeryOps'
import * as core from '@/demo/demoBakery'
import type { BBatch, BUsage, BWaste, IngredientInput, ProductInput, RecipeLineInput, WasteReason } from '@/demo/demoBakery'
import { getDemoState } from '@/demo/demoStore'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** Bakery data access. Live mode reads row-level-secured views and calls database functions; demo mode runs the browser mirror.
 *  Mutations return an error message or null. */
export type { BakeryOverview, FinishedRow, IngredientRow, LotRow, Requirement, RecipeRow, IngredientInput, ProductInput, RecipeLineInput, WasteReason }
export { WASTE_REASONS, UNITS } from '@/demo/demoBakery'
export type BatchDto = BBatch
export type UsageDto = BUsage
export type WasteDto = BWaste

const n = (v: unknown) => Number(v ?? 0)
const msg = (e: { message: string } | null) => e?.message ?? null
const db = () => supabase!
const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : null)

export async function loadIngredients(b: string): Promise<IngredientRow[]> {
  if (isDemoMode) return ops.demoIngredients(b)
  const r = await db().from('bakery_ingredient_stock').select('*').eq('business_id', b).order('name')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ id: x.id!, name: x.name!, sku: x.sku, unit: x.unit_code!, reorder: x.reorder_level === null ? null : n(x.reorder_level), defaultCost: x.default_purchase_cost === null ? null : n(x.default_purchase_cost), active: x.status === 'active', onHand: n(x.on_hand), avgCost: x.avg_cost === null ? null : n(x.avg_cost), low: !!x.low_stock }))
}

export async function loadFinished(b: string): Promise<FinishedRow[]> {
  if (isDemoMode) return ops.demoFinishedGoods(b)
  const r = await db().from('bakery_finished_goods').select('*').eq('business_id', b).order('name')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ id: x.id!, name: x.name!, sku: x.sku, price: n(x.selling_price), unit: x.unit_code!, active: x.status === 'active', shelfLifeDays: x.shelf_life_days, minStock: x.min_stock === null ? null : n(x.min_stock), onHand: n(x.on_hand), avgCost: x.avg_cost === null ? null : n(x.avg_cost), low: !!x.low_stock, nextExpiry: dateOnly(x.next_expiry) }))
}

export async function loadLots(b: string): Promise<LotRow[]> {
  if (isDemoMode) { ops.demoFinishedGoods(b); return ops.demoLots(b) }
  const r = await db().from('bakery_lot_status').select('*').eq('business_id', b).order('expires_on', { nullsFirst: false })
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ id: x.id!, productId: x.product_id!, productName: x.product_name!, batchNumber: x.batch_number!, quantity: n(x.quantity), remaining: n(x.remaining), producedOn: dateOnly(x.produced_on)!, expiresOn: dateOnly(x.expires_on), daysLeft: x.days_left === null ? null : n(x.days_left), status: x.expiry_status as LotRow['status'] }))
}

export async function loadRecipes(b: string): Promise<RecipeRow[]> {
  if (isDemoMode) return ops.demoRecipes(b)
  const [rec, ing, lines, units] = await Promise.all([
    db().from('recipe_overview').select('*').eq('business_id', b).order('name'),
    db().from('bakery_ingredient_stock').select('id, name, unit_code, avg_cost, default_purchase_cost').eq('business_id', b),
    db().from('recipe_ingredients').select('recipe_version_id, ingredient_product_id, quantity, unit_id').eq('business_id', b),
    db().from('units_of_measure').select('id, code, conversion_factor').eq('business_id', b),
  ])
  if (rec.error) throw new Error(rec.error.message)
  const unit = new Map((units.data ?? []).map((u) => [u.id, u]))
  const unitByCode = new Map((units.data ?? []).map((u) => [u.code, u]))
  const ingredient = new Map((ing.data ?? []).map((i) => [i.id!, i]))
  return (rec.data ?? []).map((r) => ({
    id: r.id!, productId: r.product_id!, productName: r.product_name!, name: r.name!, status: r.status as 'active' | 'archived', version: n(r.current_version), output: n(r.output_quantity), instructions: r.instructions,
    batchCost: n(r.batch_cost), unitCost: n(r.unit_cost),
    lines: (lines.data ?? []).filter((l) => l.recipe_version_id === r.version_id).map((l) => {
      const i = ingredient.get(l.ingredient_product_id); const u = unit.get(l.unit_id); const base = i ? unitByCode.get(i.unit_code!) : undefined
      const baseQty = u && base ? (n(l.quantity) * n(u.conversion_factor)) / n(base.conversion_factor) : n(l.quantity)
      return { ingredientId: l.ingredient_product_id, name: i?.name ?? 'Ingredient', quantity: n(l.quantity), unit: u?.code ?? '', cost: Math.round(baseQty * n(i?.avg_cost ?? i?.default_purchase_cost) * 100) / 100 }
    }),
  }))
}

export async function loadBatches(b: string): Promise<{ batches: BatchDto[]; usage: UsageDto[] }> {
  if (isDemoMode) { ops.demoFinishedGoods(b); const s = core.getBakery(); return { batches: s.batches.filter((x) => x.businessId === b).slice().reverse(), usage: s.usage } }
  const [pb, pu] = await Promise.all([
    db().from('production_batches').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(300),
    db().from('production_ingredient_usage').select('*').eq('business_id', b),
  ])
  if (pb.error) throw new Error(pb.error.message)
  return {
    batches: (pb.data ?? []).map((x) => ({ id: x.id, businessId: b, number: x.batch_number, recipeId: x.recipe_id, versionId: x.recipe_version_id, productId: x.product_id, locationId: x.location_id, date: dateOnly(x.production_date)!, planned: n(x.planned_output), actual: x.actual_output === null ? null : n(x.actual_output), failed: n(x.failed_output), status: x.status as BatchDto['status'], assignedTo: x.assigned_to, notes: x.notes, ingredientCost: x.ingredient_cost === null ? null : n(x.ingredient_cost), unitCost: x.unit_cost === null ? null : n(x.unit_cost), voidReason: x.void_reason, createdAt: x.created_at })),
    usage: (pu.data ?? []).map((u) => ({ id: u.id, batchId: u.batch_id, ingredientId: u.ingredient_product_id, planned: n(u.planned_quantity), actual: u.actual_quantity === null ? null : n(u.actual_quantity), unitCost: u.unit_cost === null ? null : n(u.unit_cost), lineCost: u.line_cost === null ? null : n(u.line_cost), movementId: u.stock_movement_id })),
  }
}

export async function loadRequirements(b: string, batchId: string): Promise<Requirement[]> {
  if (isDemoMode) return ops.demoBatchRequirements(b, batchId)
  const r = await db().rpc('bakery_batch_requirements', { p_batch: batchId })
  if (r.error) throw new Error(r.error.message)
  return ((r.data ?? []) as { ingredient_product_id: string; ingredient_name: string; unit_code: string; required: number; on_hand: number; shortfall: number }[]).map((x) => ({ ingredientId: x.ingredient_product_id, name: x.ingredient_name, unit: x.unit_code, required: n(x.required), onHand: n(x.on_hand), shortfall: n(x.shortfall) }))
}

export async function loadWaste(b: string): Promise<WasteDto[]> {
  if (isDemoMode) { ops.demoFinishedGoods(b); return core.getBakery().waste.filter((w) => w.businessId === b).slice().reverse() }
  const r = await db().from('waste_records').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(300)
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((w) => ({ id: w.id, businessId: b, number: w.waste_number, productId: w.product_id, locationId: w.location_id, quantity: n(w.quantity), reason: w.reason as WasteReason, batchId: w.production_batch_id, loss: n(w.estimated_loss), notes: w.notes, status: w.status as 'posted' | 'voided', voidReason: w.void_reason, movementId: w.stock_movement_id ?? '', createdAt: w.created_at }))
}

export async function loadOverview(b: string, from: string, to: string): Promise<BakeryOverview> {
  if (isDemoMode) return ops.demoOverview(b, from, to)
  const { data, error } = await db().rpc('bakery_overview', { p_business: b, p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  const x = data as Record<string, unknown> & { financial: Record<string, unknown> | null }
  const f = x.financial
  return {
    batchesCompleted: n(x.batches_completed), unitsProduced: n(x.units_produced), failedUnits: n(x.failed_units), unitsSold: n(x.units_sold), salesCount: n(x.sales_count), wasteRecords: n(x.waste_records),
    lowStockIngredients: n(x.low_stock_ingredients), expiringLots: n(x.expiring_lots), expiredLots: n(x.expired_lots), openBatches: n(x.open_batches),
    daily: ((x.daily ?? []) as { day: string; net_sales: number; sales: number }[]).map((d) => ({ day: d.day, netSales: n(d.net_sales), sales: n(d.sales) })),
    bestSellers: ((x.best_sellers ?? []) as { product: string; units: number; revenue: number }[]).map((d) => ({ product: d.product, units: n(d.units), revenue: n(d.revenue) })),
    productionVsSales: ((x.production_vs_sales ?? []) as { day: string; produced: number; sold: number }[]).map((d) => ({ day: d.day, produced: n(d.produced), sold: n(d.sold) })),
    financial: f ? {
      netSales: n(f.net_sales), discounts: n(f.discounts), refunds: n(f.refunds), cogs: n(f.cogs), grossProfit: n(f.gross_profit), grossMarginPercent: f.gross_margin_percent === null ? null : n(f.gross_margin_percent),
      operatingExpenses: n(f.operating_expenses), operatingProfitEstimate: n(f.operating_profit_estimate), ingredientCostProduced: n(f.ingredient_cost_produced), wasteLoss: n(f.waste_loss), outstandingBalances: n(f.outstanding_balances),
      paymentMethods: ((f.payment_methods ?? []) as { method: string; amount: number }[]).map((p) => ({ method: p.method, amount: n(p.amount) })),
    } : null,
  }
}

/** Active members, for assigning a production batch. Field staff see only themselves (the database decides). */
export async function listAssignees(b: string): Promise<{ id: string; name: string }[]> {
  if (isDemoMode) return getDemoState().members.filter((m) => m.businessId === b && m.status === 'active' && m.userId).map((m) => ({ id: m.userId!, name: m.name }))
  const r = await db().from('business_members').select('user_id, profiles!business_members_user_id_fkey(display_name)').eq('business_id', b).eq('status', 'active')
  if (r.error) return []
  return (r.data ?? []).map((m) => ({ id: m.user_id, name: ((m.profiles as { display_name?: string } | null)?.display_name) ?? 'Member' }))
}

// ------------------------------------------------------------------ mutations
export async function saveProduct(b: string, v: ProductInput, key: string) {
  if (isDemoMode) return core.demoSaveBakeryProduct(b, v, key).error
  return msg((await db().rpc('bakery_save_product', { p_business: b, p_id: v.id, p_name: v.name, p_sku: v.sku || null, p_unit_code: v.unit, p_price: v.price, p_shelf_life: v.shelfLifeDays, p_min_stock: v.minStock, p_description: v.description || null, p_active: v.active, p_key: key })).error)
}

export async function saveIngredient(b: string, v: IngredientInput, key: string) {
  if (isDemoMode) return core.demoSaveIngredient(b, v, key).error
  return msg((await db().rpc('bakery_save_ingredient', { p_business: b, p_id: v.id, p_name: v.name, p_sku: v.sku || null, p_unit_code: v.unit, p_reorder: v.reorder, p_cost: v.cost, p_active: v.active, p_opening_qty: v.openingQty, p_location: v.openingQty ? v.locationId : null, p_key: key })).error)
}

export async function saveRecipe(b: string, v: { recipeId: string | null; productId: string; name: string; output: number; instructions: string; lines: RecipeLineInput[] }, key: string) {
  if (isDemoMode) return core.demoSaveRecipe(b, v, key).error
  return msg((await db().rpc('bakery_save_recipe', { p_business: b, p_recipe: v.recipeId, p_product: v.productId, p_name: v.name, p_output: v.output, p_instructions: v.instructions || null, p_lines: v.lines.map((l) => ({ ingredient_id: l.ingredientId, quantity: l.quantity, unit_code: l.unit })), p_key: key })).error)
}

export async function setRecipeStatus(b: string, recipeId: string, active: boolean) {
  if (isDemoMode) return ops.demoSetRecipeStatus(b, recipeId, active)
  return msg((await db().rpc('bakery_set_recipe_status', { p_recipe: recipeId, p_active: active })).error)
}

export async function planProduction(b: string, v: { recipeId: string; planned: number; date: string; locationId: string; assignedTo: string | null; notes: string }, key: string) {
  if (isDemoMode) return ops.demoPlanProduction(b, v, key).error
  return msg((await db().rpc('bakery_plan_production', { p_business: b, p_recipe: v.recipeId, p_planned: v.planned, p_date: v.date, p_location: v.locationId, p_assignee: v.assignedTo, p_notes: v.notes || null, p_key: key })).error)
}

export async function startProduction(b: string, batchId: string) {
  if (isDemoMode) return ops.demoStartProduction(b, batchId)
  return msg((await db().rpc('bakery_start_production', { p_batch: batchId })).error)
}

export async function completeProduction(b: string, batchId: string, v: { actual: number; failed: number; usage: { ingredientId: string; actual: number }[] }, key: string) {
  if (isDemoMode) return ops.demoCompleteProduction(b, batchId, v, key).error
  return msg((await db().rpc('bakery_complete_production', { p_batch: batchId, p_actual_output: v.actual, p_failed_output: v.failed, p_usage: v.usage.map((u) => ({ ingredient_product_id: u.ingredientId, actual_quantity: u.actual })), p_key: key })).error)
}

export async function cancelProduction(b: string, batchId: string, reason: string, key: string) {
  if (isDemoMode) return ops.demoCancelProduction(b, batchId, reason, key)
  return msg((await db().rpc('bakery_cancel_production', { p_batch: batchId, p_reason: reason, p_key: key })).error)
}

export async function reverseProduction(b: string, batchId: string, reason: string, key: string) {
  if (isDemoMode) return ops.demoReverseProduction(b, batchId, reason, key)
  return msg((await db().rpc('bakery_reverse_production', { p_batch: batchId, p_reason: reason, p_key: key })).error)
}

export async function recordWaste(b: string, v: { productId: string; locationId: string; quantity: number; reason: WasteReason; batchId: string | null; notes: string }, key: string) {
  if (isDemoMode) return ops.demoRecordWaste(b, v, key).error
  return msg((await db().rpc('bakery_record_waste', { p_business: b, p_product: v.productId, p_location: v.locationId, p_qty: v.quantity, p_reason: v.reason, p_batch: v.batchId, p_notes: v.notes || null, p_key: key })).error)
}

export async function voidWaste(b: string, id: string, reason: string, key: string) {
  if (isDemoMode) return ops.demoVoidWaste(b, id, reason, key)
  return msg((await db().rpc('bakery_void_waste', { p_record: id, p_reason: reason, p_key: key })).error)
}
