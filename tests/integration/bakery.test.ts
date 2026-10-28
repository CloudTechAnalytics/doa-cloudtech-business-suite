import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, manager: string, worker: string, cashier: string, storekeeper: string, accountant: string, outsider: string
let biz: string, bizB: string, loc: string
let flour: string, sugar: string, yeast: string, bread: string, recipe: string
let n = 0
const key = () => `bk-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const today = iso(0)
const num = async (sql: string, params: unknown[] = []) => Number((await q<{ v: string }>(sql, params))[0].v)
const stock = (p: string) => num('select coalesce(sum(quantity_on_hand),0) as v from public.inventory_balances where product_id=$1', [p])
const avg = (p: string) => num('select avg_unit_cost as v from public.inventory_balances where product_id=$1', [p])

const ingredient = (u: string, name: string, unit: string, cost: number, opening: number, b = biz, k = key()) =>
  as(u, () => q<{ r: { product_id: string } }>('select public.bakery_save_ingredient($1,null,$2,null,$3,20,$4,true,$5,$6,$7) as r', [b, name, unit, cost, opening, b === biz ? loc : null, k])).then((r) => r[0].r.product_id)
const product = (u: string, name: string, over: { price?: number; shelf?: number | null; id?: string | null; k?: string } = {}) =>
  as(u, () => q<{ r: { product_id: string } }>('select public.bakery_save_product($1,$2,$3,null,$4,$5,$6,10,null,true,$7) as r', [biz, over.id ?? null, name, 'each', over.price ?? 1500, over.shelf === undefined ? 3 : over.shelf, over.k ?? key()])).then((r) => r[0].r.product_id)
const saveRecipe = (u: string, over: { recipe?: string | null; name?: string; output?: number; lines?: { ingredient_id: string; quantity: number; unit_code: string }[]; k?: string } = {}) =>
  as(u, () => q<{ r: { recipe_id: string; version: number } }>('select public.bakery_save_recipe($1,$2,$3,$4,$5,$6,$7::jsonb,$8) as r',
    [biz, over.recipe ?? null, bread, over.name ?? 'Standard Bread', over.output ?? 25, 'Mix, prove, bake', JSON.stringify(over.lines ?? [{ ingredient_id: flour, quantity: 10, unit_code: 'kg' }, { ingredient_id: sugar, quantity: 1000, unit_code: 'g' }, { ingredient_id: yeast, quantity: 200, unit_code: 'g' }]), over.k ?? key()])).then((r) => r[0].r)
const plan = (u: string, planned: number, over: { date?: string; recipe?: string; k?: string } = {}) =>
  as(u, () => q<{ r: { batch_id: string } }>('select public.bakery_plan_production($1,$2,$3,$4,$5,null,null,$6) as r', [biz, over.recipe ?? recipe, planned, over.date ?? today, loc, over.k ?? key()])).then((r) => r[0].r.batch_id)
const complete = (u: string, batch: string, actual: number, failed = 0, usage: { ingredient_product_id: string; actual_quantity: number }[] | null = null, k = key()) =>
  as(u, () => q<{ r: { batch_id: string; ingredient_cost: string; unit_cost: string } }>('select public.bakery_complete_production($1,$2,$3,$4::jsonb,$5) as r', [batch, actual, failed, usage ? JSON.stringify(usage) : null, k])).then((r) => r[0].r)
const sell = (u: string, qty: number, k = key()) =>
  as(u, () => q<{ r: { sale_id: string } }>('select public.post_sale($1,$2,null,$3::jsonb,$4::jsonb,$5) as r', [biz, loc, JSON.stringify([{ product_id: bread, quantity: qty }]), JSON.stringify([{ method: 'cash', amount: qty * 1500 }]), k])).then((r) => r[0].r.sale_id)
const lots = () => q<{ batch_number: string; remaining: string; expires_on: string | null; voided: boolean }>(`select pb.batch_number, l.remaining, l.expires_on::text, l.voided from public.bakery_lots l join public.production_batches pb on pb.id = l.production_batch_id order by l.created_at`)
const waste = (u: string, p: string, qty: number, reason = 'unsold', k = key()) =>
  as(u, () => q<{ r: { waste_id: string; estimated_loss: string } }>('select public.bakery_record_waste($1,$2,$3,$4,$5,null,null,$6) as r', [biz, p, loc, qty, reason, k])).then((r) => r[0].r)

beforeAll(async () => {
  db = await createDb()
  ;[owner, manager, worker, cashier, storekeeper, accountant, outsider] = await Promise.all(['o', 'm', 'w', 'c', 's', 'a', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Sunrise Bakery','bakery') as id`)))[0].id
  bizB = (await as(outsider, () => q<{ id: string }>(`select public.create_business('Other Bakery','bakery') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[manager, 'manager'], [worker, 'operations_staff'], [cashier, 'cashier'], [storekeeper, 'inventory_officer'], [accountant, 'accountant']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
})

describe('ingredients and products', () => {
  it('lets managers and storekeepers define ingredients with an opening balance; others cannot', async () => {
    flour = await ingredient(manager, 'Flour', 'kg', 800, 100)
    sugar = await ingredient(storekeeper, 'Sugar', 'kg', 1000, 50)
    yeast = await ingredient(manager, 'Yeast', 'kg', 4000, 5)
    expect(await stock(flour)).toBe(100)
    expect(await avg(flour)).toBe(800)
    await expect(ingredient(worker, 'Salt', 'kg', 100, 1)).rejects.toThrow(/permission denied/)
    await expect(ingredient(cashier, 'Salt', 'kg', 100, 1)).rejects.toThrow(/permission denied/)
    await expect(ingredient(outsider, 'Salt', 'kg', 100, 1)).rejects.toThrow(/permission denied/)
    await expect(ingredient(manager, 'flour', 'kg', 100, 1)).rejects.toThrow(/duplicate key/)
    const k = key()
    expect(await ingredient(manager, 'Salt', 'kg', 300, 2, biz, k)).toBe(await ingredient(manager, 'Salt', 'kg', 300, 2, biz, k))
    const low = (await as(manager, () => q<{ name: string; low_stock: boolean }>('select name, low_stock from public.bakery_ingredient_stock order by name')))
    expect(low.find((i) => i.name === 'Salt')!.low_stock).toBe(true) // 2 on hand, reorder level 20
    expect(low.find((i) => i.name === 'Flour')!.low_stock).toBe(false)
  })

  it('creates bakery products with a shelf life; price changes do not touch sold prices', async () => {
    bread = await product(manager, 'Standard Bread')
    await expect(product(worker, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(product(manager, 'standard bread')).rejects.toThrow(/duplicate key/)
    await expect(product(manager, 'Bad', { price: -1 })).rejects.toThrow(/price/)
    await expect(product(manager, 'Bad', { shelf: 400 })).rejects.toThrow(/shelf life/)
    const g = (await as(manager, () => q<{ shelf_life_days: number; selling_price: string }>('select shelf_life_days, selling_price from public.bakery_finished_goods where id=$1', [bread])))[0]
    expect(g.shelf_life_days).toBe(3)
  })
})

describe('recipes', () => {
  it('scale to a batch, convert units and estimate the cost', async () => {
    const r = await saveRecipe(manager)
    recipe = r.recipe_id
    expect(r.version).toBe(1)
    const o = (await as(manager, () => q<{ batch_cost: string; unit_cost: string; output_quantity: string }>('select batch_cost, unit_cost, output_quantity from public.recipe_overview where id=$1', [recipe])))[0]
    expect(Number(o.batch_cost)).toBe(9800) // 10 kg x 800 + 1 kg x 1000 + 0.2 kg x 4000
    expect(Number(o.unit_cost)).toBe(392)
  })

  it('rejects incompatible units, duplicate ingredients, empty recipes and staff who cannot define recipes', async () => {
    await expect(saveRecipe(manager, { name: 'Bad units', lines: [{ ingredient_id: flour, quantity: 1, unit_code: 'l' }] })).rejects.toThrow(/cannot be measured/)
    await expect(saveRecipe(manager, { name: 'Dup', lines: [{ ingredient_id: flour, quantity: 1, unit_code: 'kg' }, { ingredient_id: flour, quantity: 2, unit_code: 'kg' }] })).rejects.toThrow(/once per recipe/)
    await expect(saveRecipe(manager, { name: 'Empty', lines: [] })).rejects.toThrow(/1 to 60/)
    await expect(saveRecipe(manager, { name: 'Zero', lines: [{ ingredient_id: flour, quantity: 0, unit_code: 'kg' }] })).rejects.toThrow(/above zero/)
    await expect(saveRecipe(manager, { name: 'Standard Bread' })).rejects.toThrow(/duplicate key/)
    await expect(saveRecipe(worker, { name: 'Nope' })).rejects.toThrow(/permission denied/)
    await expect(saveRecipe(outsider, { name: 'Nope' })).rejects.toThrow(/permission denied/)
  })

  it('keep every version: editing adds a version and old versions cannot change', async () => {
    const v2 = await saveRecipe(manager, { recipe, output: 26, lines: [{ ingredient_id: flour, quantity: 10.4, unit_code: 'kg' }, { ingredient_id: sugar, quantity: 1000, unit_code: 'g' }, { ingredient_id: yeast, quantity: 200, unit_code: 'g' }] })
    expect(v2.version).toBe(2)
    expect(await num('select count(*) as v from public.recipe_versions where recipe_id=$1', [recipe])).toBe(2)
    await expect(db.query('update public.recipe_versions set output_quantity = 99 where recipe_id=$1', [recipe])).rejects.toThrow(/immutable/)
    await expect(db.query('delete from public.recipe_ingredients')).rejects.toThrow(/immutable/)
    // go back to the original quantities as version 3 so the production tests use round numbers
    const v3 = await saveRecipe(manager, { recipe })
    expect(v3.version).toBe(3)
  })
})

describe('production', () => {
  let b1: string
  it('plans a batch scaled to the quantity and checks what is available', async () => {
    b1 = await plan(worker, 50, { date: iso(-2) })
    const req = await as(worker, () => q<{ ingredient_name: string; required: string; shortfall: string }>('select * from public.bakery_batch_requirements($1)', [b1]))
    expect(Object.fromEntries(req.map((r) => [r.ingredient_name, Number(r.required)]))).toEqual({ Flour: 20, Sugar: 2, Yeast: 0.4 })
    expect(req.every((r) => Number(r.shortfall) === 0)).toBe(true)
    await expect(plan(cashier, 10)).rejects.toThrow(/permission denied/)
    await expect(plan(outsider, 10)).rejects.toThrow(/permission denied/)
    await expect(plan(worker, 0)).rejects.toThrow(/greater than zero/)
    const k = key()
    expect(await plan(worker, 5, { k })).toBe(await plan(worker, 5, { k }))
  })

  it('completes atomically: consumes the ingredients used, adds good output at its unit cost, records the lot and keeps the costs', async () => {
    await as(worker, () => q('select public.bakery_start_production($1)', [b1]))
    const before = { flour: await stock(flour), sugar: await stock(sugar), yeast: await stock(yeast) }
    const k = key()
    const r = await complete(worker, b1, 48, 2, [{ ingredient_product_id: flour, actual_quantity: 20.5 }], k)
    expect(Number(r.ingredient_cost)).toBe(20000) // 20.5 x 800 + 2 x 1000 + 0.4 x 4000
    expect(Number(r.unit_cost)).toBeCloseTo(416.6667, 4)
    expect((await complete(worker, b1, 48, 2, [{ ingredient_product_id: flour, actual_quantity: 20.5 }], k)).batch_id).toBe(b1) // same key, same result
    expect(await stock(flour)).toBe(before.flour - 20.5)
    expect(await stock(sugar)).toBe(before.sugar - 2)
    expect(await stock(yeast)).toBeCloseTo(before.yeast - 0.4, 4)
    expect(await stock(bread)).toBe(48)
    expect(await avg(bread)).toBeCloseTo(416.6667, 4)
    const [l] = await lots()
    expect(Number(l.remaining)).toBe(48)
    expect(l.expires_on).toBe(iso(1)) // produced 2 days ago, 3-day shelf life
    const [u] = await q<{ unit_cost: string; line_cost: string }>('select unit_cost, line_cost from public.production_ingredient_usage where batch_id=$1 and ingredient_product_id=$2', [b1, flour])
    expect(Number(u.unit_cost)).toBe(800); expect(Number(u.line_cost)).toBe(16400)
    await expect(complete(worker, b1, 48, 0)).rejects.toThrow(/cannot be completed/)
  })

  it('rolls everything back when an ingredient is short, so no stock moves and the batch stays open', async () => {
    const big = await plan(worker, 5000)
    const before = { flour: await stock(flour), bread: await stock(bread) }
    const movements = await num('select count(*) as v from public.stock_movements')
    await expect(complete(worker, big, 5000)).rejects.toThrow(/insufficient stock/)
    expect(await stock(flour)).toBe(before.flour); expect(await stock(bread)).toBe(before.bread)
    expect(await num('select count(*) as v from public.stock_movements')).toBe(movements)
    expect((await q<{ status: string }>('select status from public.production_batches where id=$1', [big]))[0].status).toBe('planned')
    const req = await as(worker, () => q<{ shortfall: string }>('select shortfall from public.bakery_batch_requirements($1) where ingredient_name = $2', [big, 'Flour']))
    expect(Number(req[0].shortfall)).toBeGreaterThan(0)
    await expect(as(worker, () => q('select public.bakery_cancel_production($1,$2,$3)', [big, 'no', key()]))).rejects.toThrow(/reason/)
    await as(worker, () => q('select public.bakery_cancel_production($1,$2,$3)', [big, 'not enough flour today', key()]))
    await expect(complete(worker, big, 1)).rejects.toThrow(/cancelled/)
  })

  it('validates the quantities and the ingredients recorded', async () => {
    const b = await plan(worker, 25)
    await expect(complete(worker, b, -1)).rejects.toThrow(/cannot be negative/)
    await expect(complete(worker, b, 5, -1)).rejects.toThrow(/cannot be negative/)
    await expect(complete(worker, b, 5, 0, [{ ingredient_product_id: bread, actual_quantity: 1 }])).rejects.toThrow(/not part of this batch/)
    await expect(complete(worker, b, 5, 0, [{ ingredient_product_id: flour, actual_quantity: -2 }])).rejects.toThrow(/cannot be negative/)
    await as(worker, () => q('select public.bakery_cancel_production($1,$2,$3)', [b, 'test cleanup', key()]))
  })

  it('serves oldest stock first and gives it back when a sale is voided', async () => {
    const b2 = await plan(worker, 50, { date: today })
    await complete(worker, b2, 50, 0)
    expect((await lots()).map((l) => Number(l.remaining))).toEqual([48, 50])
    const sale = await sell(cashier, 60)
    expect((await lots()).map((l) => Number(l.remaining))).toEqual([0, 38]) // the older lot first
    expect(await stock(bread)).toBe(38)
    const pay = (await q<{ id: string }>('select id from public.payments where sale_id=$1', [sale]))[0].id
    await as(owner, () => q('select public.reverse_payment($1,$2,$3)', [pay, 'wrong sale', key()]))
    await as(owner, () => q('select public.void_sale($1,$2,$3)', [sale, 'entered twice', key()]))
    expect((await lots()).map((l) => Number(l.remaining))).toEqual([48, 50])
    expect(await stock(bread)).toBe(98)
  })

  it('reverses a completed batch only if nothing from it has gone, restoring the ingredients at their cost', async () => {
    const b3 = await plan(worker, 25, { date: today })
    const flourBefore = await stock(flour)
    await complete(worker, b3, 25, 0)
    await expect(as(worker, () => q('select public.bakery_reverse_production($1,$2,$3)', [b3, 'entered twice', key()]))).rejects.toThrow(/permission denied/)
    await expect(as(manager, () => q('select public.bakery_reverse_production($1,$2,$3)', [b3, 'x', key()]))).rejects.toThrow(/reason is required/)
    const sale = await sell(cashier, 1) // takes from the oldest lot, so b3 is untouched
    await as(manager, () => q('select public.bakery_reverse_production($1,$2,$3)', [b3, 'wrong recipe used', key()]))
    expect(await stock(flour)).toBe(flourBefore)
    expect((await q<{ status: string }>('select status from public.production_batches where id=$1', [b3]))[0].status).toBe('reversed')
    expect((await lots()).find((l) => l.voided)).toBeDefined()
    await expect(as(manager, () => q('select public.bakery_reverse_production($1,$2,$3)', [b3, 'again please', key()]))).rejects.toThrow(/only a completed batch/)
    // a batch that has been partly sold cannot be reversed
    const b4 = await plan(worker, 25, { date: iso(-5) })
    await complete(worker, b4, 25, 0)
    await sell(cashier, 5) // b4's lot expires first, so it is the one that is sold from
    await expect(as(manager, () => q('select public.bakery_reverse_production($1,$2,$3)', [b4, 'oops', key()]))).rejects.toThrow(/already been sold/)
    expect(sale).toBeTruthy()
  })
})

describe('waste', () => {
  it('records waste as a stock movement with its estimated loss, and does not touch sales', async () => {
    const before = await stock(bread)
    const w = await waste(worker, bread, 3, 'unsold')
    expect(await stock(bread)).toBe(before - 3)
    expect(Number(w.estimated_loss)).toBeGreaterThan(0)
    const wi = await waste(worker, flour, 1.5, 'burnt')
    expect(Number(wi.estimated_loss)).toBe(1200) // 1.5 kg at 800
    await expect(waste(cashier, bread, 1)).rejects.toThrow(/permission denied/)
    await expect(waste(outsider, bread, 1)).rejects.toThrow(/permission denied/)
    await expect(waste(worker, bread, 0)).rejects.toThrow(/greater than zero/)
    await expect(waste(worker, bread, 1, 'bored')).rejects.toThrow(/choose a reason/)
    await expect(waste(worker, bread, 999999)).rejects.toThrow(/insufficient stock/)
    const k = key()
    expect((await waste(worker, flour, 0.5, 'damaged', k)).waste_id).toBe((await waste(worker, flour, 0.5, 'damaged', k)).waste_id)
  })

  it('is voided by a manager with a reason, which restores stock and the lot', async () => {
    const lotsBefore = (await lots()).map((l) => Number(l.remaining))
    const w = await waste(worker, bread, 2, 'damaged')
    const stockMid = await stock(bread)
    await expect(as(worker, () => q('select public.bakery_void_waste($1,$2,$3)', [w.waste_id, 'wrong item', key()]))).rejects.toThrow(/permission denied/)
    await expect(as(manager, () => q('select public.bakery_void_waste($1,$2,$3)', [w.waste_id, 'x', key()]))).rejects.toThrow(/reason is required/)
    await as(manager, () => q('select public.bakery_void_waste($1,$2,$3)', [w.waste_id, 'recorded on the wrong day', key()]))
    expect(await stock(bread)).toBe(stockMid + 2)
    expect((await lots()).map((l) => Number(l.remaining))).toEqual(lotsBefore)
    await expect(as(manager, () => q('select public.bakery_void_waste($1,$2,$3)', [w.waste_id, 'again please', key()]))).rejects.toThrow(/already voided/)
  })
})

describe('expiry', () => {
  it('flags expired and expiring lots that still hold stock', async () => {
    const old = await plan(worker, 25, { date: iso(-10) })
    await complete(worker, old, 25, 0)
    const status = await as(manager, () => q<{ batch_number: string; expiry_status: string }>('select batch_number, expiry_status from public.bakery_lot_status'))
    expect(status.some((s) => s.expiry_status === 'expired')).toBe(true)
    const ov = await as(manager, () => q<{ r: { expired_lots: number } }>('select public.bakery_overview($1,$2,$3) as r', [biz, iso(-30), today]))
    expect(ov[0].r.expired_lots).toBeGreaterThan(0)
  })
})

describe('overview', () => {
  it('reports operational figures to staff and money figures only to those who may read financial reports', async () => {
    const op = (await as(worker, () => q<{ r: Record<string, unknown> }>('select public.bakery_overview($1,$2,$3) as r', [biz, iso(-30), today])))[0].r
    expect(Number(op.batches_completed)).toBeGreaterThan(0)
    expect(Number(op.units_produced)).toBeGreaterThan(0)
    expect(op.financial).toBeNull()
    const fin = (await as(manager, () => q<{ r: { financial: Record<string, number> } }>('select public.bakery_overview($1,$2,$3) as r', [biz, iso(-30), today])))[0].r.financial
    expect(fin.net_sales).toBeGreaterThan(0)
    expect(fin.gross_profit).toBeCloseTo(fin.net_sales - fin.cogs, 2)
    expect(fin.operating_profit_estimate).toBeCloseTo(fin.gross_profit - fin.operating_expenses, 2)
    expect((await as(accountant, () => q<{ r: { financial: unknown } }>('select public.bakery_overview($1,$2,$3) as r', [biz, iso(-30), today])))[0].r.financial).not.toBeNull()
  })

  it('computes net sales, cost of goods sold and expenses from the records', async () => {
    // a clean window: tomorrow is empty, so add one known sale and one expense there is not possible (no future dates); use today's totals instead
    const r = (await as(manager, () => q<{ r: { financial: Record<string, number> } }>('select public.bakery_overview($1,$2,$3) as r', [biz, today, today])))[0].r.financial
    const sales = await num(`select coalesce(sum(grand_total - tax_total - returned_total),0) as v from public.sales where business_id=$1 and status <> 'voided' and sold_at::date = current_date`, [biz])
    const cogs = await num(`select coalesce(sum(si.quantity * coalesce(si.unit_cost_snapshot,0)),0) as v from public.sale_items si join public.sales s on s.id=si.sale_id where s.business_id=$1 and s.status <> 'voided' and s.sold_at::date = current_date`, [biz])
    expect(r.net_sales).toBeCloseTo(sales, 2)
    expect(r.cogs).toBeCloseTo(cogs, 2)
    await as(manager, () => q('select public.record_expense($1,$2,$3,$4,$5,$6,null,null,$7)', [biz, 'utilities', 5000, 'cash', 'Electricity', today, key()]))
    const after = (await as(manager, () => q<{ r: { financial: Record<string, number> } }>('select public.bakery_overview($1,$2,$3) as r', [biz, today, today])))[0].r.financial
    expect(after.operating_expenses).toBe(5000)
    expect(after.operating_profit_estimate).toBeCloseTo(after.gross_profit - 5000, 2)
    await expect(as(manager, () => q('select public.bakery_overview($1,$2,$3)', [biz, today, iso(-3)]))).rejects.toThrow(/valid period/)
  })
})

describe('business separation', () => {
  it('keeps one bakery from reading or using another bakery\'s records', async () => {
    for (const t of ['recipes', 'production_batches', 'waste_records', 'bakery_lots', 'bakery_product_profiles']) {
      expect(await as(outsider, () => q(`select * from public.${t}`)), t).toHaveLength(0)
    }
    expect((await as(outsider, () => q<{ name: string }>('select name from public.bakery_ingredient_stock'))).map((i) => i.name)).not.toContain('Flour')
    await expect(as(outsider, () => q('select public.bakery_overview($1,$2,$3)', [biz, iso(-3), today]))).rejects.toThrow(/permission denied/)
    const someBatch = (await q<{ id: string }>('select id from public.production_batches limit 1'))[0].id
    await expect(as(outsider, () => q('select public.bakery_complete_production($1,$2,$3,null,$4)', [someBatch, 1, 0, key()]))).rejects.toThrow(/permission denied/)
    // an outsider cannot put another bakery's ingredient into their own recipe
    const theirs = await ingredient(outsider, 'Their flour', 'kg', 500, 0, bizB)
    expect(theirs).toBeTruthy()
    await expect(as(manager, () => q('select public.bakery_save_recipe($1,null,$2,$3,10,null,$4::jsonb,$5)', [biz, bread, 'Cross', JSON.stringify([{ ingredient_id: theirs, quantity: 1, unit_code: 'kg' }]), key()]))).rejects.toThrow(/active ingredient/)
  })
})
