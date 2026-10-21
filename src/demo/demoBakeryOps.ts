import {
  UNITS, WASTE_REASONS, addDays, avgCost, commit, getBakery, ingredientCost, lineBaseQty, nextNumber, onHand, prod, r2, r4, run, today, versionCost,
} from '@/demo/demoBakery'
import type { BBatch, BRecipe, BVersion, BWaste, Bakery, WasteReason } from '@/demo/demoBakery'
import { getFinance } from '@/demo/demoFinance'
import { cloneInv, commitInv, ensureDemoInventory, getInv, newId, postMovement } from '@/demo/demoInventory'
import type { DLot } from '@/demo/demoInventory'
import { getDemoState } from '@/demo/demoStore'
import { demoAllowed, demoCanTrade, ensureDemoTrade, getTrade } from '@/demo/demoTrade'

/**
 * Production, waste, views, overview and sample data for the demo bakery. Mirrors supabase/migrations/20261021000013_bakery.sql:
 * a batch completes atomically (ingredients out, finished goods in at their unit cost, a lot with an expiry date), a completed
 * batch is corrected by a reversal, waste is a stock movement, and the overview follows the same profit definitions.
 */
const state = () => getBakery()

export function demoSetRecipeStatus(biz: string, recipeId: string, active: boolean): string | null {
  return run(biz, 'bakery_recipe_status', null, ['bakery-recipes'], ['bakery.manage'], ({ b }) => {
    const r = b.recipes.find((x) => x.id === recipeId && x.businessId === biz)
    if (!r) throw new Error('permission denied')
    r.status = active ? 'active' : 'archived'
    return null
  }).error
}

// ----------------------------------------------------------------- production
export function demoPlanProduction(biz: string, v: { recipeId: string; planned: number; date: string; locationId: string; assignedTo: string | null; notes: string }, key: string) {
  return run(biz, 'bakery_plan', key, ['bakery-production'], ['bakery.record'], ({ b, inv }) => {
    const r = b.recipes.find((x) => x.id === v.recipeId && x.businessId === biz)
    if (!r || r.status !== 'active') throw new Error('choose an active recipe')
    const ver = b.versions.find((x) => x.recipeId === r.id && x.version === r.currentVersion)!
    if (!(v.planned > 0)) throw new Error('the planned quantity must be greater than zero')
    if (!v.date) throw new Error('choose the production date')
    if (!inv.locations.some((l) => l.id === v.locationId && l.businessId === biz)) throw new Error('unknown or inactive location')
    const batch: BBatch = {
      id: newId('pb'), businessId: biz, number: nextNumber(b, biz, 'production', 'PB'), recipeId: r.id, versionId: ver.id, productId: r.productId, locationId: v.locationId, date: v.date,
      planned: v.planned, actual: null, failed: 0, status: 'planned', assignedTo: v.assignedTo, notes: v.notes.trim() || null, ingredientCost: null, unitCost: null, voidReason: null, createdAt: new Date().toISOString(),
    }
    b.batches.push(batch)
    for (const l of b.lines.filter((x) => x.versionId === ver.id)) {
      b.usage.push({ id: newId('pu'), batchId: batch.id, ingredientId: l.ingredientId, planned: r4((lineBaseQty(inv, biz, l) * v.planned) / ver.output), actual: null, unitCost: null, lineCost: null, movementId: null })
    }
    return { batchId: batch.id, number: batch.number }
  })
}

export interface Requirement { ingredientId: string; name: string; unit: string; required: number; onHand: number; shortfall: number }
/** What a batch needs against what is on hand at its location (mirrors bakery_batch_requirements()). */
export function demoBatchRequirements(biz: string, batchId: string): Requirement[] {
  const inv = getInv()
  const batch = state().batches.find((x) => x.id === batchId && x.businessId === biz)
  if (!batch) return []
  return state().usage.filter((u) => u.batchId === batchId).map((u) => {
    const p = prod(inv, biz, u.ingredientId)!
    const have = onHand(inv, biz, u.ingredientId, batch.locationId)
    return { ingredientId: u.ingredientId, name: p.name, unit: p.unit, required: u.planned, onHand: have, shortfall: Math.max(r4(u.planned - have), 0) }
  }).sort((a, c) => a.name.localeCompare(c.name))
}

export function demoStartProduction(biz: string, batchId: string): string | null {
  return run(biz, 'bakery_start', null, ['bakery-production'], ['bakery.record'], ({ b }) => {
    const x = b.batches.find((y) => y.id === batchId && y.businessId === biz)
    if (!x) throw new Error('batch not found')
    if (x.status !== 'planned') throw new Error('only a planned batch can be started')
    x.status = 'in_progress'
    return null
  }).error
}

export function demoCompleteProduction(biz: string, batchId: string, v: { actual: number; failed: number; usage: { ingredientId: string; actual: number }[] | null }, key: string) {
  return run(biz, 'bakery_complete', key, ['bakery-production'], ['bakery.record'], ({ b, inv }) => {
    const x = b.batches.find((y) => y.id === batchId && y.businessId === biz)
    if (!x) throw new Error('batch not found')
    if (x.status !== 'planned' && x.status !== 'in_progress') throw new Error(`this batch is ${x.status}, so it cannot be completed`)
    if (!(v.actual >= 0)) throw new Error('the quantity produced cannot be negative')
    if (!(v.failed >= 0)) throw new Error('failed units cannot be negative')
    const usage = b.usage.filter((u) => u.batchId === batchId).sort((p, q) => p.ingredientId.localeCompare(q.ingredientId))
    if (v.usage && v.usage.some((u) => !usage.some((y) => y.ingredientId === u.ingredientId))) throw new Error('an ingredient was recorded that is not part of this batch')
    const group = newId('g')
    let total = 0
    for (const u of usage) {
      let qty = u.planned
      const o = v.usage?.find((y) => y.ingredientId === u.ingredientId)
      if (o) { qty = r4(o.actual); if (!(qty >= 0)) throw new Error('ingredient quantities cannot be negative') }
      if (qty > 0) {
        const m = postMovement(inv, prod(inv, biz, u.ingredientId)!, x.locationId, 'production_consumption', -qty, null, `Production ${x.number}`, group)
        u.actual = qty; u.unitCost = m.unitCost; u.lineCost = r2(qty * m.unitCost); u.movementId = m.id
        total += u.lineCost
      } else { u.actual = 0; u.unitCost = 0; u.lineCost = 0 }
    }
    const unit = v.actual > 0 ? r4(total / v.actual) : null
    if (v.actual > 0) {
      postMovement(inv, prod(inv, biz, x.productId)!, x.locationId, 'production_output', v.actual, unit, `Production ${x.number}`, group)
      const shelf = b.profiles.find((pr) => pr.productId === x.productId)?.shelfLifeDays ?? null
      const lot: DLot = { id: newId('lt'), businessId: biz, productId: x.productId, batchId: x.id, quantity: v.actual, remaining: v.actual, producedOn: x.date, expiresOn: shelf !== null ? addDays(x.date, shelf) : null, voided: false }
      ;(inv.lots ??= []).push(lot)
    }
    Object.assign(x, { status: 'completed', actual: v.actual, failed: v.failed, ingredientCost: total, unitCost: unit })
    return { batchId, ingredientCost: total, unitCost: unit }
  })
}

export function demoCancelProduction(biz: string, batchId: string, reason: string, key: string) {
  return run(biz, 'bakery_cancel', key, ['bakery-production'], ['bakery.record'], ({ b }) => {
    const x = b.batches.find((y) => y.id === batchId && y.businessId === biz)
    if (!x) throw new Error('batch not found')
    if (x.status !== 'planned' && x.status !== 'in_progress') throw new Error('only a batch that has not been completed can be cancelled; reverse a completed one instead')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    x.status = 'cancelled'; x.voidReason = reason.trim()
    return { batchId }
  }).error
}

/** Undoes a completed batch with a reason; refused once any of it has been sold or written off. */
export function demoReverseProduction(biz: string, batchId: string, reason: string, key: string) {
  return run(biz, 'bakery_reverse', key, ['bakery-production'], ['bakery.manage'], ({ b, inv }) => {
    const x = b.batches.find((y) => y.id === batchId && y.businessId === biz)
    if (!x) throw new Error('batch not found')
    if (x.status !== 'completed') throw new Error('only a completed batch can be reversed')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    const lot = (inv.lots ?? []).find((l) => l.batchId === batchId)
    if (lot && lot.remaining < lot.quantity) throw new Error('part of this batch has already been sold or written off, so it cannot be reversed')
    const group = newId('g')
    for (const u of b.usage.filter((y) => y.batchId === batchId && y.movementId)) {
      const mv = inv.movements.find((m) => m.id === u.movementId)!
      postMovement(inv, prod(inv, biz, u.ingredientId)!, mv.locationId, 'reversal', -mv.delta, mv.unitCost, `Reversed ${x.number}: ${reason.trim()}`, group, mv.id)
    }
    const out = inv.movements.find((m) => m.productId === x.productId && m.type === 'production_output' && m.reason === `Production ${x.number}`)
    if (out) {
      postMovement(inv, prod(inv, biz, x.productId)!, out.locationId, 'reversal', -out.delta, out.unitCost, `Reversed ${x.number}: ${reason.trim()}`, group, out.id)
      if (lot) { lot.remaining = 0; lot.voided = true }
    }
    x.status = 'reversed'; x.voidReason = reason.trim()
    return { batchId }
  }).error
}

// --------------------------------------------------------------------- waste
export function demoRecordWaste(biz: string, v: { productId: string; locationId: string; quantity: number; reason: WasteReason; batchId: string | null; notes: string }, key: string) {
  return run(biz, 'bakery_waste', key, ['bakery-waste'], ['bakery.record'], ({ b, inv }) => {
    if (!(v.quantity > 0)) throw new Error('quantity must be greater than zero')
    if (!WASTE_REASONS.includes(v.reason)) throw new Error('choose a reason')
    const p = prod(inv, biz, v.productId)
    if (!p || (p.kind !== 'ingredient' && p.kind !== 'finished_good')) throw new Error('choose an ingredient or a finished product')
    if (v.batchId && !b.batches.some((x) => x.id === v.batchId && x.businessId === biz)) throw new Error('unknown production batch')
    if (!inv.locations.some((l) => l.id === v.locationId && l.businessId === biz)) throw new Error('unknown or inactive location')
    const id = newId('ws')
    const m = postMovement(inv, p, v.locationId, 'adjustment', -v.quantity, null, `Waste (${v.reason.replace('_', ' ')})`, newId('g'))
    const w: BWaste = { id, businessId: biz, number: nextNumber(b, biz, 'waste', 'WST'), productId: v.productId, locationId: v.locationId, quantity: v.quantity, reason: v.reason, batchId: v.batchId, loss: r2(v.quantity * m.unitCost), notes: v.notes.trim() || null, status: 'posted', voidReason: null, movementId: m.id, createdAt: new Date().toISOString() }
    b.waste.push(w)
    return { wasteId: id, number: w.number, estimatedLoss: w.loss }
  })
}

export function demoVoidWaste(biz: string, wasteId: string, reason: string, key: string) {
  return run(biz, 'bakery_void_waste', key, ['bakery-waste'], ['bakery.manage'], ({ b, inv }) => {
    const w = b.waste.find((x) => x.id === wasteId && x.businessId === biz)
    if (!w) throw new Error('record not found')
    if (w.status !== 'posted') throw new Error('record is already voided')
    if (reason.trim().length < 3) throw new Error('a reason is required')
    const mv = inv.movements.find((m) => m.id === w.movementId)!
    postMovement(inv, prod(inv, biz, w.productId)!, mv.locationId, 'reversal', -mv.delta, mv.unitCost, `Void waste ${w.number}`, newId('g'), mv.id)
    w.status = 'voided'; w.voidReason = reason.trim()
    return { wasteId }
  }).error
}

// --------------------------------------------------------------------- views
export interface IngredientRow { id: string; name: string; sku: string | null; unit: string; reorder: number | null; defaultCost: number | null; active: boolean; onHand: number; avgCost: number | null; low: boolean }
export function demoIngredients(biz: string): IngredientRow[] {
  ensureDemoBakery(biz)
  const inv = getInv()
  return inv.products.filter((p) => p.businessId === biz && p.kind === 'ingredient').map((p) => {
    const have = onHand(inv, biz, p.id); const a = avgCost(inv, biz, p.id)
    return { id: p.id, name: p.name, sku: p.sku, unit: p.unit, reorder: p.reorderLevel, defaultCost: p.defaultCost, active: p.status === 'active', onHand: r4(have), avgCost: a === null ? null : r4(a), low: (p.reorderLevel ?? 0) > 0 && have <= (p.reorderLevel ?? 0) }
  }).sort((a, c) => a.name.localeCompare(c.name))
}

export interface FinishedRow { id: string; name: string; sku: string | null; price: number; unit: string; active: boolean; shelfLifeDays: number | null; minStock: number | null; onHand: number; avgCost: number | null; low: boolean; nextExpiry: string | null }
export function demoFinishedGoods(biz: string): FinishedRow[] {
  ensureDemoBakery(biz)
  const inv = getInv()
  return state().profiles.filter((f) => f.businessId === biz).flatMap((f) => {
    const p = prod(inv, biz, f.productId)
    if (!p) return []
    const have = onHand(inv, biz, p.id); const a = avgCost(inv, biz, p.id)
    const exp = (inv.lots ?? []).filter((l) => l.productId === p.id && l.remaining > 0 && !l.voided && l.expiresOn).map((l) => l.expiresOn as string).sort()[0] ?? null
    return [{ id: p.id, name: p.name, sku: p.sku, price: p.sellingPrice, unit: p.unit, active: p.status === 'active', shelfLifeDays: f.shelfLifeDays, minStock: f.minStock, onHand: r4(have), avgCost: a === null ? null : r4(a), low: (f.minStock ?? 0) > 0 && have <= (f.minStock ?? 0), nextExpiry: exp }]
  }).sort((a, c) => a.name.localeCompare(c.name))
}

export interface LotRow { id: string; productId: string; productName: string; batchNumber: string; quantity: number; remaining: number; producedOn: string; expiresOn: string | null; daysLeft: number | null; status: 'ok' | 'expiring' | 'expired' }
export function demoLots(biz: string): LotRow[] {
  const inv = getInv()
  return (inv.lots ?? []).filter((l) => l.businessId === biz && l.remaining > 0 && !l.voided).map((l) => {
    const days = l.expiresOn ? Math.floor((Date.parse(l.expiresOn) - Date.parse(today())) / 86400000) : null
    return { id: l.id, productId: l.productId, productName: prod(inv, biz, l.productId)?.name ?? '', batchNumber: state().batches.find((b) => b.id === l.batchId)?.number ?? '', quantity: l.quantity, remaining: l.remaining, producedOn: l.producedOn, expiresOn: l.expiresOn, daysLeft: days, status: days === null ? 'ok' as const : days < 0 ? 'expired' as const : days <= 2 ? 'expiring' as const : 'ok' as const }
  }).sort((a, c) => (a.expiresOn ?? '9999').localeCompare(c.expiresOn ?? '9999'))
}

export interface RecipeRow { id: string; productId: string; productName: string; name: string; status: 'active' | 'archived'; version: number; output: number; instructions: string | null; batchCost: number; unitCost: number; lines: { ingredientId: string; name: string; quantity: number; unit: string; cost: number }[] }
export function demoRecipes(biz: string): RecipeRow[] {
  ensureDemoBakery(biz)
  const inv = getInv(); const b = state()
  return b.recipes.filter((r) => r.businessId === biz).map((r) => {
    const v = b.versions.find((x) => x.recipeId === r.id && x.version === r.currentVersion)!
    const batchCost = versionCost(b, inv, biz, v.id)
    const lines = b.lines.filter((l) => l.versionId === v.id).map((l) => ({ ingredientId: l.ingredientId, name: prod(inv, biz, l.ingredientId)?.name ?? '', quantity: l.quantity, unit: l.unit, cost: r2(lineBaseQty(inv, biz, l) * ingredientCost(inv, biz, l.ingredientId)) }))
    return { id: r.id, productId: r.productId, productName: prod(inv, biz, r.productId)?.name ?? '', name: r.name, status: r.status, version: r.currentVersion, output: v.output, instructions: v.instructions, batchCost, unitCost: r4(batchCost / v.output), lines }
  }).sort((a, c) => a.name.localeCompare(c.name))
}

// ------------------------------------------------------------------ overview
export interface BakeryOverview {
  batchesCompleted: number; unitsProduced: number; failedUnits: number; unitsSold: number; salesCount: number; wasteRecords: number; lowStockIngredients: number
  expiringLots: number; expiredLots: number; openBatches: number
  daily: { day: string; netSales: number; sales: number }[]; bestSellers: { product: string; units: number; revenue: number }[]; productionVsSales: { day: string; produced: number; sold: number }[]
  financial: null | {
    netSales: number; discounts: number; refunds: number; cogs: number; grossProfit: number; grossMarginPercent: number | null; operatingExpenses: number; operatingProfitEstimate: number
    ingredientCostProduced: number; wasteLoss: number; outstandingBalances: number; paymentMethods: { method: string; amount: number }[]
  }
}

/** Same rules as bakery_overview(): net sales exclude tax and refunds; cost of goods sold uses the cost units left stock at; ingredient purchases are stock, not expenses. */
export function demoOverview(biz: string, from: string, to: string): BakeryOverview {
  if (!demoAllowed(biz, 'dashboard', 'dashboard.read')) throw new Error('permission denied')
  if (!from || !to || to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new Error('choose a valid period of up to a year')
  ensureDemoBakery(biz)
  const t = getTrade(); const inv = getInv(); const b = state()
  const c = (n: number) => Math.round(n * 100)
  const inRange = (iso: string) => iso.slice(0, 10) >= from && iso.slice(0, 10) <= to
  const sales = t.sales.filter((s) => s.businessId === biz && s.status !== 'voided' && inRange(s.soldAt))
  const net = (s: (typeof sales)[number]) => c(s.grandTotal) - c(s.taxTotal) - c(s.returnedTotal)
  const items = t.saleItems.filter((i) => sales.some((s) => s.id === i.saleId))
  const restocked = (itemId: string) => t.returnItems.filter((r) => r.saleItemId === itemId && r.disposition === 'restock').reduce((a, r) => a + r.quantity, 0)
  const cogs = items.reduce((a, i) => a + Math.round((i.quantity - restocked(i.id)) * (i.unitCost ?? 0) * 100), 0)
  const batches = b.batches.filter((x) => x.businessId === biz && x.status === 'completed' && x.date >= from && x.date <= to)
  const waste = b.waste.filter((w) => w.businessId === biz && w.status === 'posted' && inRange(w.createdAt))
  const exps = getFinance().expenses.filter((e) => e.businessId === biz && e.status === 'posted' && e.date >= from && e.date <= to)
  const lots = demoLots(biz)
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)
  const dayNet = new Map<string, { net: number; n: number }>()
  for (const s of sales) { const k = s.soldAt.slice(0, 10); const cur = dayNet.get(k) ?? { net: 0, n: 0 }; dayNet.set(k, { net: cur.net + net(s), n: cur.n + 1 }) }
  const best = new Map<string, { units: number; revenue: number }>()
  for (const i of items) { const name = prod(inv, biz, i.productId)?.name ?? i.description; const cur = best.get(name) ?? { units: 0, revenue: 0 }; best.set(name, { units: cur.units + i.quantity, revenue: cur.revenue + c(i.total) - c(i.tax) }) }
  const soldOn = (day: string) => t.saleItems.filter((i) => { const s = t.sales.find((x) => x.id === i.saleId); return s && s.businessId === biz && s.status !== 'voided' && s.soldAt.slice(0, 10) === day }).reduce((a, i) => a + i.quantity, 0)
  const methods = new Map<string, number>()
  for (const p of t.payments.filter((x) => x.businessId === biz && x.status === 'successful' && x.type === 'sale_receipt' && inRange(x.at))) methods.set(p.method, (methods.get(p.method) ?? 0) + c(p.amount))
  const salesNet = sales.reduce((a, s) => a + net(s), 0)
  const expenses = exps.reduce((a, e) => a + c(e.amount), 0)
  const out: BakeryOverview = {
    batchesCompleted: batches.length, unitsProduced: batches.reduce((a, x) => a + (x.actual ?? 0), 0), failedUnits: batches.reduce((a, x) => a + x.failed, 0), unitsSold: items.reduce((a, i) => a + i.quantity, 0),
    salesCount: sales.length, wasteRecords: waste.length, lowStockIngredients: demoIngredients(biz).filter((i) => i.active && i.low).length,
    expiringLots: lots.filter((l) => l.status === 'expiring').length, expiredLots: lots.filter((l) => l.status === 'expired').length, openBatches: b.batches.filter((x) => x.businessId === biz && (x.status === 'planned' || x.status === 'in_progress')).length,
    daily: [...dayNet].sort(([x], [y]) => x.localeCompare(y)).map(([day, v]) => ({ day, netSales: v.net / 100, sales: v.n })),
    bestSellers: [...best].sort((x, y) => y[1].units - x[1].units).slice(0, 8).map(([product, v]) => ({ product, units: v.units, revenue: v.revenue / 100 })),
    productionVsSales: days.map((day) => ({ day, produced: b.batches.filter((x) => x.businessId === biz && x.status === 'completed' && x.date === day).reduce((a, x) => a + (x.actual ?? 0), 0), sold: soldOn(day) })),
    financial: null,
  }
  if (demoCanTrade(biz, 'reports.finance.read')) {
    const owed = t.sales.filter((s) => s.businessId === biz && s.status !== 'voided' && s.balanceDue > 0).reduce((a, s) => a + c(s.balanceDue), 0)
    out.financial = {
      netSales: salesNet / 100, discounts: sales.reduce((a, s) => a + c(s.discountTotal), 0) / 100, refunds: sales.reduce((a, s) => a + c(s.returnedTotal), 0) / 100, cogs: cogs / 100, grossProfit: (salesNet - cogs) / 100,
      grossMarginPercent: salesNet > 0 ? Math.round(((salesNet - cogs) * 1000) / salesNet) / 10 : null, operatingExpenses: expenses / 100, operatingProfitEstimate: (salesNet - cogs - expenses) / 100,
      ingredientCostProduced: batches.reduce((a, x) => a + c(x.ingredientCost ?? 0), 0) / 100, wasteLoss: waste.reduce((a, w) => a + c(w.loss), 0) / 100, outstandingBalances: owed / 100,
      paymentMethods: [...methods].map(([method, amount]) => ({ method, amount: amount / 100 })),
    }
  }
  return out
}

// ---------------------------------------------------------------------- sample data
/** Seeds a demo bakery once: ingredients (through the ledger), two products, and a first recipe. Clearly demo data. */
export function ensureDemoBakery(biz: string) {
  if (state().seeded.includes(biz)) return
  const business = getDemoState().businesses.find((x) => x.id === biz)
  if (business?.industry !== 'bakery') return
  ensureDemoInventory(biz, 'bakery')
  ensureDemoTrade(biz)
  const inv = cloneInv(getInv())
  const b: Bakery = JSON.parse(JSON.stringify(state())) as Bakery
  b.seeded.push(biz)
  for (const p of inv.products.filter((x) => x.businessId === biz && !x.kind)) p.kind = 'ingredient'
  const ingredient = (name: string) => inv.products.find((p) => p.businessId === biz && p.name === name)!
  const flour = ingredient('Wheat Flour'); const sugar = ingredient('Granulated Sugar'); const yeast = ingredient('Instant Yeast')
  const finished = (name: string, price: number, sku: string, shelf: number, min: number) => {
    const id = newId('p')
    inv.products.push({ id, businessId: biz, sku, barcode: null, name, unit: 'each', sellingPrice: price, defaultCost: null, reorderLevel: null, status: 'active', kind: 'finished_good' })
    b.profiles.push({ productId: id, businessId: biz, shelfLifeDays: shelf, minStock: min })
    ;(inv.lotProducts ??= []).push(id)
    return id
  }
  const bread = finished('Standard Bread', 1500, 'BRD-STD', 3, 10)
  finished('Meat Pie', 700, 'PIE-MEAT', 2, 20)
  const recipe: BRecipe = { id: newId('rc'), businessId: biz, productId: bread, name: 'Standard Bread', status: 'active', currentVersion: 1 }
  const version: BVersion = { id: newId('rv'), recipeId: recipe.id, version: 1, output: 25, instructions: 'Mix, prove for an hour, shape and bake.' }
  b.recipes.push(recipe); b.versions.push(version)
  for (const [p, quantity, unit] of [[flour, 10, 'kg'], [sugar, 1, 'kg'], [yeast, 200, 'g']] as const) b.lines.push({ id: newId('rl'), versionId: version.id, ingredientId: p.id, quantity, unit })
  commitInv(inv)
  commit(b)
}

export { UNITS }
