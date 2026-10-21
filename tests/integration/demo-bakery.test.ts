import { beforeAll, describe, expect, it } from 'vitest'
import * as core from '@/demo/demoBakery'
import * as ops from '@/demo/demoBakeryOps'
import { getInv } from '@/demo/demoInventory'
import { demoInvite, demoSignIn, demoSignOut } from '@/demo/demoStore'
import * as trade from '@/demo/demoTrade'

const B = 'b-bakery'
let n = 0
const key = () => `dbk-${n++}-abcdefgh`
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const today = iso(0)
const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
const prod = (name: string) => getInv().products.find((p) => p.businessId === B && p.name === name)!
const onHand = (name: string) => Object.entries(getInv().balances).filter(([k]) => k.startsWith(`${B}|${prod(name).id}|`)).reduce((a, [, v]) => a + v.qty, 0)
let loc: string, recipeId: string
const lots = () => (getInv().lots ?? []).filter((l) => l.businessId === B).map((l) => ({ batch: core.getBakery().batches.find((b) => b.id === l.batchId)!.number, remaining: l.remaining, expires: l.expiresOn, voided: l.voided }))
const plan = (planned: number, date = today) => ops.demoPlanProduction(B, { recipeId, planned, date, locationId: loc, assignedTo: null, notes: '' }, key())
const complete = (id: string, actual: number, failed = 0, usage: { ingredientId: string; actual: number }[] | null = null, k = key()) => ops.demoCompleteProduction(B, id, { actual, failed, usage }, k)
const sell = (qty: number) => trade.demoPostSale(B, loc, null, [{ productId: prod('Standard Bread').id, quantity: qty }], [{ method: 'cash', amount: qty * 1500 }], key())

beforeAll(() => {
  demoSignIn('owner@demo.test', 'demo1234')
  ops.demoIngredients(B)
  expect(demoInvite(B, 'cashier@demo.test', 'operations_staff')).toBeNull()
  loc = getInv().locations.find((l) => l.businessId === B && l.name === 'Main store')!.id
  recipeId = core.getBakery().recipes.find((r) => r.businessId === B)!.id
})

describe('demo bakery follows the database rules', () => {
  it('seeds clearly demo ingredients, products and a recipe, and costs the recipe from ingredient costs', () => {
    expect(ops.demoIngredients(B).map((i) => i.name)).toEqual(expect.arrayContaining(['Wheat Flour', 'Granulated Sugar', 'Instant Yeast']))
    expect(ops.demoFinishedGoods(B).map((p) => p.name)).toEqual(expect.arrayContaining(['Standard Bread', 'Meat Pie']))
    const r = ops.demoRecipes(B)[0]
    expect(r.batchCost).toBe(14790) // 10 kg x 1,250 + 1 kg x 1,350 + 0.2 kg x 4,700
    expect(r.unitCost).toBe(591.6)
  })

  it('lets owners define products, ingredients and recipes; production staff cannot', () => {
    const prodInput = { id: null, name: 'Sliced Bread', sku: '', unit: 'each', price: 1800, shelfLifeDays: 4, minStock: 5, description: '', active: true }
    expect(core.demoSaveBakeryProduct(B, prodInput, key()).error).toBeNull()
    expect(core.demoSaveBakeryProduct(B, prodInput, key()).error).toMatch(/duplicate key/)
    expect(core.demoSaveBakeryProduct(B, { ...prodInput, name: 'Bad', price: -1 }, key()).error).toMatch(/price/)
    expect(core.demoSaveBakeryProduct(B, { ...prodInput, name: 'Bad', shelfLifeDays: 400 }, key()).error).toMatch(/shelf life/)
    const k = key()
    const ing = { id: null, name: 'Salt', sku: '', unit: 'kg', reorder: 20, cost: 300, active: true, openingQty: 2, locationId: loc }
    expect(core.demoSaveIngredient(B, ing, k).error).toBeNull()
    expect(core.demoSaveIngredient(B, ing, k).result).toBeDefined() // same key: no second row
    expect(getInv().products.filter((p) => p.businessId === B && p.name === 'Salt')).toHaveLength(1)
    expect(ops.demoIngredients(B).find((i) => i.name === 'Salt')).toMatchObject({ onHand: 2, low: true })
    const flour = prod('Wheat Flour').id; const sugar = prod('Granulated Sugar').id
    const line = (id: string, quantity: number, unit: string) => ({ ingredientId: id, quantity, unit })
    const recipe = (over: Partial<Parameters<typeof core.demoSaveRecipe>[1]>) => core.demoSaveRecipe(B, { recipeId: null, productId: prod('Standard Bread').id, name: 'R', output: 10, instructions: '', lines: [line(flour, 1, 'kg')], ...over }, key())
    expect(recipe({ name: 'Bad units', lines: [line(flour, 1, 'l')] }).error).toMatch(/cannot be measured/)
    expect(recipe({ name: 'Dup', lines: [line(flour, 1, 'kg'), line(flour, 2, 'kg')] }).error).toMatch(/once per recipe/)
    expect(recipe({ name: 'Empty', lines: [] }).error).toMatch(/1 to 60/)
    expect(recipe({ name: 'Zero', lines: [line(flour, 0, 'kg')] }).error).toMatch(/above zero/)
    expect(recipe({ name: 'Standard Bread' }).error).toMatch(/duplicate key/)
    expect(recipe({ name: 'Grams', lines: [line(flour, 1000, 'g'), line(sugar, 500, 'g')] }).error).toBeNull() // g converts to kg
    const v2 = recipe({ recipeId, name: '', output: 26, lines: [line(flour, 10.4, 'kg'), line(sugar, 1, 'kg')] })
    expect(v2.result!.version).toBe(2)
    expect(core.getBakery().versions.filter((v) => v.recipeId === recipeId)).toHaveLength(2)
    expect(recipe({ recipeId, name: '', output: 25, lines: [line(flour, 10, 'kg'), line(sugar, 1, 'kg'), line(prod('Instant Yeast').id, 200, 'g')] }).result!.version).toBe(3)

    as('cashier@demo.test')
    expect(core.demoSaveBakeryProduct(B, { ...prodInput, name: 'Nope' }, key()).error).toMatch(/permission denied/)
    expect(core.demoSaveIngredient(B, { ...ing, name: 'Nope' }, key()).error).toMatch(/permission denied/)
    expect(recipe({ name: 'Nope' }).error).toMatch(/permission denied/)
    as('owner@demo.test')
  })

  it('plans a batch scaled to the quantity and completes it atomically at the cost actually used', () => {
    as('cashier@demo.test')
    const a = plan(50, iso(-2))
    expect(a.error).toBeNull()
    const id = a.result!.batchId
    const req = ops.demoBatchRequirements(B, id)
    expect(Object.fromEntries(req.map((r) => [r.name, r.required]))).toEqual({ 'Wheat Flour': 20, 'Granulated Sugar': 2, 'Instant Yeast': 0.4 })
    expect(req.every((r) => r.shortfall === 0)).toBe(true)
    expect(ops.demoStartProduction(B, id)).toBeNull()
    const flour = prod('Wheat Flour').id
    const before = { flour: onHand('Wheat Flour'), sugar: onHand('Granulated Sugar'), bread: onHand('Standard Bread') }
    const k = key()
    const done = complete(id, 48, 2, [{ ingredientId: flour, actual: 20.5 }], k)
    expect(done.error).toBeNull()
    expect(done.result).toMatchObject({ ingredientCost: 30205 }) // 20.5 x 1,250 + 2 x 1,350 + 0.4 x 4,700
    expect(done.result!.unitCost).toBeCloseTo(629.2708, 4)
    expect(complete(id, 48, 2, [{ ingredientId: flour, actual: 20.5 }], k).result).toEqual(done.result) // same key, same result
    expect(onHand('Wheat Flour')).toBe(before.flour - 20.5)
    expect(onHand('Granulated Sugar')).toBe(before.sugar - 2)
    expect(onHand('Standard Bread')).toBe(before.bread + 48)
    const lot = (getInv().lots ?? []).find((l) => l.batchId === id)!
    expect(lot).toMatchObject({ quantity: 48, remaining: 48, expiresOn: iso(1) }) // made 2 days ago, 3-day shelf life
    expect(complete(id, 48, 0).error).toMatch(/cannot be completed/)
    as('owner@demo.test')
  })

  it('rolls back when an ingredient is short, validates quantities, and cancels with a reason', () => {
    const big = plan(100000).result!.batchId
    const inv0 = getInv().movements.length
    expect(complete(big, 100000).error).toMatch(/insufficient stock/)
    expect(getInv().movements.length).toBe(inv0)
    expect(core.getBakery().batches.find((b) => b.id === big)!.status).toBe('planned')
    expect(ops.demoBatchRequirements(B, big).some((r) => r.shortfall > 0)).toBe(true)
    expect(ops.demoCancelProduction(B, big, 'no', key())).toMatch(/reason/)
    expect(ops.demoCancelProduction(B, big, 'not enough flour today', key())).toBeNull()
    expect(complete(big, 1).error).toMatch(/cannot be completed/)
    const b = plan(25).result!.batchId
    expect(complete(b, -1).error).toMatch(/cannot be negative/)
    expect(complete(b, 5, -1).error).toMatch(/cannot be negative/)
    expect(complete(b, 5, 0, [{ ingredientId: prod('Standard Bread').id, actual: 1 }]).error).toMatch(/not part of this batch/)
    expect(ops.demoCancelProduction(B, b, 'test cleanup', key())).toBeNull()
  })

  it('sells the oldest-expiring batch first and gives stock back when a sale is voided', () => {
    const b2 = plan(50).result!.batchId
    expect(complete(b2, 50).error).toBeNull()
    expect(lots().map((l) => l.remaining)).toEqual([48, 50])
    const s = sell(60)
    expect(s.error).toBeNull()
    expect(lots().map((l) => l.remaining)).toEqual([0, 38])
    const pay = trade.getTrade().payments.find((p) => p.saleId === s.result!.saleId)!
    expect(trade.demoReversePayment(B, pay.id, 'wrong sale', key())).toBeNull()
    expect(trade.demoVoidSale(B, s.result!.saleId, 'entered twice', key())).toBeNull()
    expect(lots().map((l) => l.remaining)).toEqual([48, 50])
  })

  it('reverses a completed batch only while nothing from it has gone', () => {
    const b3 = plan(25).result!.batchId
    const flourBefore = onHand('Wheat Flour')
    expect(complete(b3, 25).error).toBeNull()
    as('cashier@demo.test')
    expect(ops.demoReverseProduction(B, b3, 'entered twice', key())).toMatch(/permission denied/)
    as('owner@demo.test')
    expect(ops.demoReverseProduction(B, b3, 'x', key())).toMatch(/reason is required/)
    expect(sell(1).error).toBeNull() // comes from the oldest lot, so b3 is untouched
    expect(ops.demoReverseProduction(B, b3, 'wrong recipe used', key())).toBeNull()
    expect(onHand('Wheat Flour')).toBe(flourBefore)
    expect(core.getBakery().batches.find((b) => b.id === b3)!.status).toBe('reversed')
    expect(lots().some((l) => l.voided)).toBe(true)
    expect(ops.demoReverseProduction(B, b3, 'again please', key())).toMatch(/only a completed batch/)
    const b4 = plan(25, iso(-5)).result!.batchId
    expect(complete(b4, 25).error).toBeNull()
    expect(sell(5).error).toBeNull() // b4's lot expires first, so it is sold from
    expect(ops.demoReverseProduction(B, b4, 'oops', key())).toMatch(/already been sold/)
  })

  it('records waste as a stock movement with its estimated loss, and a manager can void it', () => {
    const bread = prod('Standard Bread').id; const flour = prod('Wheat Flour').id
    as('cashier@demo.test')
    const before = onHand('Standard Bread')
    const w = ops.demoRecordWaste(B, { productId: bread, locationId: loc, quantity: 3, reason: 'unsold', batchId: null, notes: '' }, key())
    expect(w.error).toBeNull()
    expect(onHand('Standard Bread')).toBe(before - 3)
    expect(w.result!.estimatedLoss).toBeGreaterThan(0)
    expect(ops.demoRecordWaste(B, { productId: flour, locationId: loc, quantity: 1.5, reason: 'burnt', batchId: null, notes: '' }, key()).result!.estimatedLoss).toBe(1875) // 1.5 kg at 1,250
    expect(ops.demoRecordWaste(B, { productId: bread, locationId: loc, quantity: 0, reason: 'unsold', batchId: null, notes: '' }, key()).error).toMatch(/greater than zero/)
    expect(ops.demoRecordWaste(B, { productId: bread, locationId: loc, quantity: 1, reason: 'bored' as never, batchId: null, notes: '' }, key()).error).toMatch(/choose a reason/)
    expect(ops.demoRecordWaste(B, { productId: bread, locationId: loc, quantity: 999999, reason: 'unsold', batchId: null, notes: '' }, key()).error).toMatch(/insufficient stock/)
    expect(ops.demoVoidWaste(B, w.result!.wasteId, 'wrong item', key())).toMatch(/permission denied/)
    const lotsMid = lots().map((l) => l.remaining)
    as('owner@demo.test')
    expect(ops.demoVoidWaste(B, w.result!.wasteId, 'x', key())).toMatch(/reason is required/)
    expect(ops.demoVoidWaste(B, w.result!.wasteId, 'recorded on the wrong day', key())).toBeNull()
    expect(onHand('Standard Bread')).toBe(before)
    expect(lots().map((l) => l.remaining).reduce((a, x) => a + x, 0)).toBe(lotsMid.reduce((a, x) => a + x, 0) + 3)
    expect(ops.demoVoidWaste(B, w.result!.wasteId, 'again please', key())).toMatch(/already voided/)
  })

  it('flags expired lots', () => {
    const old = plan(25, iso(-10)).result!.batchId
    expect(complete(old, 25).error).toBeNull()
    expect(ops.demoLots(B).some((l) => l.status === 'expired')).toBe(true)
    expect(ops.demoOverview(B, iso(-30), today).expiredLots).toBeGreaterThan(0)
  })

  it('shows money figures only to roles that may read financial reports, and computes them from the records', () => {
    as('cashier@demo.test')
    const staff = ops.demoOverview(B, iso(-30), today)
    expect(staff.financial).toBeNull()
    expect(staff.unitsProduced).toBeGreaterThan(0)
    as('owner@demo.test')
    const o = ops.demoOverview(B, today, today)
    const f = o.financial!
    const t = trade.getTrade()
    const sales = t.sales.filter((s) => s.businessId === B && s.status !== 'voided' && s.soldAt.slice(0, 10) === today)
    const net = Math.round(sales.reduce((a, s) => a + s.grandTotal * 100 - s.taxTotal * 100 - s.returnedTotal * 100, 0)) / 100
    expect(f.netSales).toBe(net)
    expect(f.grossProfit).toBeCloseTo(f.netSales - f.cogs, 2)
    expect(f.operatingProfitEstimate).toBeCloseTo(f.grossProfit - f.operatingExpenses, 2)
    expect(() => ops.demoOverview(B, today, iso(-3))).toThrow(/valid period/)
    expect(ops.demoOverview(B, today, today).productionVsSales).toHaveLength(1)
  })

  it('refuses people who are not in this business', () => {
    as('cashier@demo.test')
    expect(() => ops.demoOverview('b-farm', today, today)).toThrow(/permission denied/)
    expect(ops.demoRecordWaste('b-farm', { productId: 'x', locationId: 'y', quantity: 1, reason: 'unsold', batchId: null, notes: '' }, key()).error).toMatch(/permission denied/)
    as('owner@demo.test')
  })
})
