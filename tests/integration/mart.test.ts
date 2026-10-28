import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, manager: string, cashier: string, cashier2: string, storekeeper: string, accountant: string, outsider: string
let biz: string, bizB: string, loc: string, supplier: string, category: string
let noodles: string, milk: string, soap: string
let n = 0
const key = () => `mt-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const num = async (sql: string, params: unknown[] = []) => Number((await q<{ v: string }>(sql, params))[0].v)
const stock = (p: string) => num('select coalesce(sum(quantity_on_hand),0) as v from public.inventory_balances where product_id=$1', [p])
const avg = (p: string) => num('select avg_unit_cost as v from public.inventory_balances where product_id=$1', [p])

const save = (u: string, name: string, over: { id?: string | null; price?: number; cost?: number; barcode?: string | null; expiry?: boolean; packs?: { name: string; units: number }[]; cat?: string | null; unit?: string; reorder?: number | null; active?: boolean; k?: string; b?: string } = {}) =>
  as(u, () => q<{ r: { product_id: string } }>('select public.mart_save_product($1,$2,$3,null,$4,$5,null,$6,$7,$8,null,$9,null,$10,$11,$12::jsonb,$13) as r',
    [over.b ?? biz, over.id ?? null, name, over.barcode ?? null, over.cat === undefined ? category : over.cat, over.unit ?? 'each', over.cost ?? 1000, over.price ?? 1500, over.reorder === undefined ? 20 : over.reorder, over.expiry ?? false, over.active ?? true, JSON.stringify(over.packs ?? []), over.k ?? key()])).then((r) => r[0].r.product_id)
const receive = (u: string, items: object[], k = key()) => as(u, () => q('select public.mart_receive_stock($1,$2,$3::jsonb,$4,$5)', [biz, loc, JSON.stringify(items), 'Delivery', k]))
const sell = (u: string, items: object[], pay: { method: string; amount: number }[], k = key()) =>
  as(u, () => q<{ r: { sale_id: string } }>('select public.mart_post_sale($1,$2,null,$3::jsonb,$4::jsonb,$5) as r', [biz, loc, JSON.stringify(items), JSON.stringify(pay), k])).then((r) => r[0].r.sale_id)
const lots = (p: string) => q<{ id: string; remaining: string; expires_on: string | null; batch_number: string | null; voided: boolean }>('select id, remaining, expires_on::text, batch_number, voided from public.mart_lots where product_id=$1 order by created_at', [p])

beforeAll(async () => {
  db = await createDb()
  ;[owner, manager, cashier, cashier2, storekeeper, accountant, outsider] = await Promise.all(['o', 'm', 'c', 'c2', 's', 'a', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('CityMart','retail') as id`)))[0].id
  bizB = (await as(outsider, () => q<{ id: string }>(`select public.create_business('Other Mart','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[manager, 'manager'], [cashier, 'cashier'], [cashier2, 'cashier'], [storekeeper, 'inventory_officer'], [accountant, 'accountant']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  supplier = (await q<{ id: string }>(`insert into public.suppliers (business_id,name) values ($1,'Alpha') returning id`, [biz]))[0].id
  category = (await as(manager, () => q<{ id: string }>(`insert into public.product_categories (business_id,name) values ($1,'Groceries') returning id`, [biz])))[0].id
})

describe('products, categories and packs', () => {
  it('lets managers define products with packs; cashiers, storekeepers and outsiders cannot', async () => {
    noodles = await save(manager, 'Indomie Noodles 70g', { barcode: '6001', packs: [{ name: 'pack', units: 6 }, { name: 'carton', units: 72 }], price: 200, cost: 150 })
    await expect(save(cashier, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(save(storekeeper, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(save(outsider, 'Nope')).rejects.toThrow(/permission denied/)
    await expect(save(manager, 'indomie noodles 70g')).rejects.toThrow(/duplicate key/)
    await expect(save(manager, 'Other', { barcode: '6001' })).rejects.toThrow(/SKU or barcode/)
    const k = key()
    expect(await save(manager, 'Peak Milk Tin', { k, expiry: true })).toBe(await save(manager, 'Peak Milk Tin', { k, expiry: true }))
    milk = (await q<{ id: string }>(`select id from public.products where name='Peak Milk Tin'`))[0].id
    soap = await save(manager, 'Bar Soap', { price: 300, cost: 200 })
    // the cashier's till list has the product and its packs, and no costs; the stock tables themselves are not readable by a cashier
    const till = (await as(cashier, () => q<{ r: { products: { id: string; default_cost: unknown }[]; packs: { product_id: string; name: string }[] } }>('select public.till_catalog($1) as r', [biz])))[0].r
    expect(till.products.find((x) => x.id === noodles)!.default_cost).toBeNull()
    expect(till.packs.filter((x) => x.product_id === noodles).map((x) => x.name).sort()).toEqual(['carton', 'pack'])
    expect(await as(cashier, () => q('select 1 from public.mart_products where id=$1', [noodles]))).toHaveLength(0)
    const costed = (await as(manager, () => q<{ r: { products: { id: string; default_cost: unknown }[] } }>('select public.till_catalog($1) as r', [biz])))[0].r
    expect(costed.products.find((x) => x.id === noodles)!.default_cost).not.toBeNull()
  })

  it('validates prices, costs, packs and categories', async () => {
    await expect(save(manager, 'Bad', { price: -1 })).rejects.toThrow(/selling price/)
    await expect(save(manager, 'Bad', { cost: -1 })).rejects.toThrow(/cost price/)
    await expect(save(manager, 'Bad', { packs: [{ name: 'box', units: 0 }] })).rejects.toThrow(/more than zero/)
    await expect(save(manager, 'Bad', { packs: [{ name: 'box', units: 6 }, { name: 'BOX', units: 12 }] })).rejects.toThrow(/once/)
    await expect(save(manager, 'Bad', { cat: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow(/unknown category/)
    await expect(save(manager, 'Bad', { unit: 'parsec' })).rejects.toThrow(/unknown unit/)
  })

  it('keeps the price a sale was made at when the price later changes', async () => {
    await receive(storekeeper, [{ product_id: soap, quantity: 10, unit_cost: 200 }])
    const sale = await sell(cashier, [{ product_id: soap, quantity: 1 }], [{ method: 'cash', amount: 300 }])
    await save(manager, 'Bar Soap', { id: soap, price: 350, cost: 220 })
    expect(await num('select unit_price as v from public.sale_items where sale_id=$1', [sale])).toBe(300)
    expect(await num('select selling_price as v from public.products where id=$1', [soap])).toBe(350)
  })
})

describe('receiving and buying in packs', () => {
  it('converts cartons to base units and works out the unit cost', async () => {
    await receive(storekeeper, [{ product_id: noodles, quantity: 5, pack: 'carton', unit_cost: 10800 }]) // 5 x 72 = 360 pieces at 150 each
    expect(await stock(noodles)).toBe(360)
    expect(await avg(noodles)).toBe(150)
    await expect(receive(storekeeper, [{ product_id: noodles, quantity: 1, pack: 'pallet', unit_cost: 1 }])).rejects.toThrow(/no pack called/)
    await expect(receive(cashier, [{ product_id: noodles, quantity: 1 }])).rejects.toThrow(/permission denied/)
    const k = key()
    await receive(storekeeper, [{ product_id: soap, quantity: 1, unit_cost: 220 }], k)
    const before = await stock(soap)
    await receive(storekeeper, [{ product_id: soap, quantity: 1, unit_cost: 220 }], k)
    expect(await stock(soap)).toBe(before)
  })

  it('requires an expiry date for products that track it, and records batch and expiry on the lot', async () => {
    await expect(receive(storekeeper, [{ product_id: milk, quantity: 24, unit_cost: 100 }])).rejects.toThrow(/expiry date/)
    await receive(storekeeper, [{ product_id: milk, quantity: 24, unit_cost: 100, batch: 'B-1', expiry: iso(30) }])
    const [l] = await lots(milk)
    expect(l).toMatchObject({ batch_number: 'B-1', expires_on: iso(30) })
    expect(Number(l.remaining)).toBe(24)
  })

  it('creates a normal purchase order in packs and receives only what arrived', async () => {
    const po = (await as(manager, () => q<{ r: { purchase_id: string; total_amount: string } }>('select public.mart_create_purchase($1,$2,$3::jsonb,null,$4) as r', [biz, supplier, JSON.stringify([{ product_id: noodles, quantity: 10, pack: 'carton', unit_cost: 10800 }]), key()])))[0].r
    expect(Number(po.total_amount)).toBe(108000) // 720 pieces at 150
    expect(await stock(noodles)).toBe(360) // ordering never adds stock
    const item = (await q<{ id: string; quantity_ordered: string }>('select id, quantity_ordered from public.purchase_items where purchase_id=$1', [po.purchase_id]))[0]
    expect(Number(item.quantity_ordered)).toBe(720)
    await as(storekeeper, () => q('select public.receive_purchase($1,$2,$3::jsonb,null,$4)', [po.purchase_id, loc, JSON.stringify([{ purchase_item_id: item.id, quantity: 144 }]), key()]))
    expect(await stock(noodles)).toBe(504) // 2 cartons arrived
  })

  it('keeps purchase receipts of expiry-tracked products as lots to be completed', async () => {
    const po = (await as(manager, () => q<{ r: { purchase_id: string } }>('select public.mart_create_purchase($1,$2,$3::jsonb,null,$4) as r', [biz, supplier, JSON.stringify([{ product_id: milk, quantity: 2, pack: null, unit_cost: 100 }]), key()])))[0].r
    const item = (await q<{ id: string }>('select id from public.purchase_items where purchase_id=$1', [po.purchase_id]))[0]
    await as(storekeeper, () => q('select public.receive_purchase($1,$2,$3::jsonb,null,$4)', [po.purchase_id, loc, JSON.stringify([{ purchase_item_id: item.id, quantity: 2 }]), key()]))
    const pending = (await lots(milk)).find((l) => l.expires_on === null)!
    expect(pending).toBeDefined()
    await as(storekeeper, () => q('select public.mart_set_lot($1,$2,$3)', [pending.id, 'B-2', iso(60)]))
    expect((await lots(milk)).find((l) => l.id === pending.id)).toMatchObject({ batch_number: 'B-2', expires_on: iso(60) })
    await expect(as(cashier, () => q('select public.mart_set_lot($1,$2,$3)', [pending.id, 'X', iso(1)]))).rejects.toThrow(/permission denied/)
  })
})

describe('selling', () => {
  it('sells a carton as its units and a single unit from the same stock', async () => {
    const before = await stock(noodles)
    const sale = await sell(cashier, [{ product_id: noodles, quantity: 1, pack: 'carton' }, { product_id: noodles, quantity: 5 }], [{ method: 'cash', amount: 15400 }])
    expect(await stock(noodles)).toBe(before - 77) // 72 + 5
    expect(await num('select sum(quantity) as v from public.sale_items where sale_id=$1', [sale])).toBe(77)
    expect(await num('select grand_total as v from public.sales where id=$1', [sale])).toBe(15400) // 77 x 200
    expect(await num('select max(unit_cost_snapshot) as v from public.sale_items where sale_id=$1', [sale])).toBe(150)
  })

  it('rejects a pack that does not exist, overselling and a mismatched price', async () => {
    await expect(sell(cashier, [{ product_id: noodles, quantity: 1, pack: 'pallet' }], [])).rejects.toThrow(/no pack called/)
    await expect(sell(cashier, [{ product_id: noodles, quantity: 99999 }], [])).rejects.toThrow(/insufficient stock/)
    await expect(sell(cashier, [{ product_id: noodles, quantity: 1, unit_price: 1 }], [])).rejects.toThrow(/price/)
  })

  it('serves the earliest-expiring lot first and returns stock to it on a void', async () => {
    const sale = await sell(cashier, [{ product_id: milk, quantity: 20 }], [{ method: 'cash', amount: 30000 }])
    const after = await lots(milk)
    expect(after.map((l) => Number(l.remaining))).toEqual([4, 2]) // B-1 (expires in 30 days) before B-2 (60)
    const pay = (await q<{ id: string }>('select id from public.payments where sale_id=$1', [sale]))[0].id
    await as(owner, () => q('select public.reverse_payment($1,$2,$3)', [pay, 'wrong sale', key()]))
    await as(owner, () => q('select public.void_sale($1,$2,$3)', [sale, 'entered twice', key()]))
    expect((await lots(milk)).map((l) => Number(l.remaining))).toEqual([24, 2])
  })
})

describe('stock counts', () => {
  it('lets the storekeeper count, needs a manager to approve, and posts the variances to the ledger', async () => {
    const c = (await as(storekeeper, () => q<{ r: { count_id: string } }>('select public.mart_start_count($1,$2,$3,$4) as r', [biz, loc, category, key()])))[0].r.count_id
    const expected = await stock(soap)
    await as(storekeeper, () => q('select public.stock_count_record($1,$2,$3)', [c, soap, expected - 2]))
    await expect(as(storekeeper, () => q('select public.stock_count_post($1,$2)', [c, key()]))).rejects.toThrow(/manager must approve/)
    await expect(as(cashier, () => q('select public.stock_count_post($1,$2)', [c, key()]))).rejects.toThrow(/permission denied/)
    await as(manager, () => q('select public.stock_count_post($1,$2)', [c, key()]))
    expect(await stock(soap)).toBe(expected - 2)
    expect(await num(`select count(*) as v from public.stock_movements where movement_type='count_adjustment' and product_id=$1`, [soap])).toBe(1)
    await expect(as(manager, () => q('select public.stock_count_post($1,$2)', [c, key()]))).rejects.toThrow(/already posted/)
  })

  it('refuses an empty selection and an unknown category', async () => {
    const empty = (await as(manager, () => q<{ id: string }>(`insert into public.product_categories (business_id,name) values ($1,'Empty') returning id`, [biz])))[0].id
    await expect(as(storekeeper, () => q('select public.mart_start_count($1,$2,$3,$4)', [biz, loc, empty, key()]))).rejects.toThrow(/no products/)
    await expect(as(storekeeper, () => q('select public.mart_start_count($1,$2,$3,$4)', [biz, loc, '00000000-0000-0000-0000-000000000000', key()]))).rejects.toThrow(/unknown category/)
  })
})

describe('damaged and expired stock', () => {
  it('records a loss at cost, takes it from the earliest lot, and lets only a manager void it', async () => {
    const before = await stock(milk)
    const r = (await as(storekeeper, () => q<{ r: { loss_id: string; estimated_loss: string } }>('select public.mart_record_loss($1,$2,$3,$4,$5,null,$6) as r', [biz, milk, loc, 3, 'expired', key()])))[0].r
    expect(await stock(milk)).toBe(before - 3)
    expect(Number(r.estimated_loss)).toBe(300) // 3 x 100
    expect((await lots(milk)).map((l) => Number(l.remaining))).toEqual([21, 2])
    await expect(as(storekeeper, () => q('select public.mart_void_loss($1,$2,$3)', [r.loss_id, 'wrong item', key()]))).rejects.toThrow(/permission denied/)
    await expect(as(manager, () => q('select public.mart_void_loss($1,$2,$3)', [r.loss_id, 'x', key()]))).rejects.toThrow(/reason is required/)
    await as(manager, () => q('select public.mart_void_loss($1,$2,$3)', [r.loss_id, 'counted twice', key()]))
    expect(await stock(milk)).toBe(before)
    expect((await lots(milk)).map((l) => Number(l.remaining))).toEqual([24, 2])
    await expect(as(storekeeper, () => q('select public.mart_record_loss($1,$2,$3,$4,$5,null,$6)', [biz, milk, loc, 1, 'bored', key()]))).rejects.toThrow(/choose a reason/)
    await expect(as(cashier, () => q('select public.mart_record_loss($1,$2,$3,$4,$5,null,$6)', [biz, milk, loc, 1, 'damaged', key()]))).rejects.toThrow(/permission denied/)
  })
})

describe('supplier returns', () => {
  it('sends goods back, lowers stock and cuts what is still owed on the order', async () => {
    const po = (await as(manager, () => q<{ r: { purchase_id: string } }>('select public.mart_create_purchase($1,$2,$3::jsonb,null,$4) as r', [biz, supplier, JSON.stringify([{ product_id: soap, quantity: 10, unit_cost: 200 }]), key()])))[0].r.purchase_id
    const item = (await q<{ id: string }>('select id from public.purchase_items where purchase_id=$1', [po]))[0]
    await as(storekeeper, () => q('select public.receive_purchase($1,$2,$3::jsonb,null,$4)', [po, loc, JSON.stringify([{ purchase_item_id: item.id, quantity: 10 }]), key()]))
    const owed = () => num('select balance_due as v from public.payables where purchase_id=$1', [po])
    expect(await owed()).toBe(2000)
    const before = await stock(soap)
    const r = (await as(manager, () => q<{ r: { total_credit: string } }>('select public.mart_supplier_return($1,$2,$3,$4,$5::jsonb,$6,$7) as r', [biz, supplier, po, loc, JSON.stringify([{ product_id: soap, quantity: 4, unit_cost: 200 }]), 'damaged on arrival', key()])))[0].r
    expect(Number(r.total_credit)).toBe(800)
    expect(await stock(soap)).toBe(before - 4)
    expect(await owed()).toBe(1200)
    await expect(as(manager, () => q('select public.mart_supplier_return($1,$2,$3,$4,$5::jsonb,$6,$7)', [biz, supplier, po, loc, JSON.stringify([{ product_id: soap, quantity: 7, unit_cost: 200 }]), 'too many', key()]))).rejects.toThrow(/only return what was received/)
    await expect(as(cashier, () => q('select public.mart_supplier_return($1,$2,$3,$4,$5::jsonb,$6,$7)', [biz, supplier, po, loc, JSON.stringify([{ product_id: soap, quantity: 1, unit_cost: 200 }]), 'no', key()]))).rejects.toThrow(/permission denied/)
    await expect(as(manager, () => q('select public.mart_supplier_return($1,$2,$3,$4,$5::jsonb,$6,$7)', [biz, supplier, null, loc, JSON.stringify([{ product_id: soap, quantity: 1, unit_cost: 200 }]), 'x', key()]))).rejects.toThrow(/reason is required/)
  })
})

describe('cashier shifts', () => {
  let shift: string
  const open = (u: string, cash: number, k = key()) => as(u, () => q<{ r: { shift_id: string } }>('select public.mart_open_shift($1,$2,$3) as r', [biz, cash, k])).then((r) => r[0].r.shift_id)
  const summary = (id: string) => as(manager, () => q<{ expected_cash: string; cash_sales: string; other_methods: string; moved_out: string; variance: string | null; status: string }>('select expected_cash, cash_sales, other_methods, moved_out, variance, status from public.shift_summary where id=$1', [id])).then((r) => r[0])

  it('opens one shift per cashier and adds up cash from the cashier\'s own cash payments only', async () => {
    shift = await open(cashier, 5000)
    await expect(open(cashier, 100)).rejects.toThrow(/already have an open shift/)
    await expect(open(storekeeper, 100)).rejects.toThrow(/permission denied/)
    await sell(cashier, [{ product_id: soap, quantity: 1 }], [{ method: 'cash', amount: 350 }])
    await sell(cashier, [{ product_id: soap, quantity: 1 }], [{ method: 'bank_transfer', amount: 350 }])
    await sell(cashier2, [{ product_id: soap, quantity: 1 }], [{ method: 'cash', amount: 350 }]) // another cashier's cash does not count
    await as(cashier, () => q('select public.mart_cash_movement($1,$2,$3,$4,$5)', [shift, 'out', 100, 'bought cleaning materials', key()]))
    await as(cashier, () => q('select public.mart_cash_movement($1,$2,$3,$4,$5)', [shift, 'in', 50, 'float top-up', key()]))
    await expect(as(cashier, () => q('select public.mart_cash_movement($1,$2,$3,$4,$5)', [shift, 'out', 0, 'bad', key()]))).rejects.toThrow(/positive/)
    await expect(as(cashier, () => q('select public.mart_cash_movement($1,$2,$3,$4,$5)', [shift, 'out', 10, 'x', key()]))).rejects.toThrow(/reason is required/)
    await expect(as(cashier2, () => q('select public.mart_cash_movement($1,$2,$3,$4,$5)', [shift, 'out', 10, 'not mine', key()]))).rejects.toThrow(/permission denied/)
    const s = await summary(shift)
    expect(Number(s.cash_sales)).toBe(350); expect(Number(s.other_methods)).toBe(350)
    expect(Number(s.expected_cash)).toBe(5300) // 5,000 + 350 - 100 + 50
  })

  it('closes with the counted cash, freezes expected cash and the variance, and needs a manager to review', async () => {
    const k = key()
    const r = (await as(cashier, () => q<{ r: { expected_cash: string; variance: string } }>('select public.mart_close_shift($1,$2,$3,$4) as r', [shift, 5250, 'short', k])))[0].r
    expect(Number(r.expected_cash)).toBe(5300); expect(Number(r.variance)).toBe(-50)
    expect((await as(cashier, () => q<{ r: { variance: string } }>('select public.mart_close_shift($1,$2,$3,$4) as r', [shift, 5250, 'short', k])))[0].r.variance).toBeDefined() // same key
    await expect(as(cashier, () => q('select public.mart_close_shift($1,$2,$3,$4)', [shift, 5250, null, key()]))).rejects.toThrow(/already closed/)
    await expect(as(cashier, () => q('select public.mart_cash_movement($1,$2,$3,$4,$5)', [shift, 'in', 10, 'late', key()]))).rejects.toThrow(/closed/)
    await sell(cashier, [{ product_id: soap, quantity: 1 }], [{ method: 'cash', amount: 350 }]) // after closing: not part of the closed shift
    expect(Number((await summary(shift)).expected_cash)).toBe(5300)
    await expect(as(cashier, () => q('select public.mart_review_shift($1,$2)', [shift, 'ok']))).rejects.toThrow(/permission denied/)
    await expect(as(manager, () => q('select public.mart_review_shift($1,$2)', [shift, null]))).rejects.toThrow(/explain the cash variance/)
    await as(manager, () => q('select public.mart_review_shift($1,$2)', [shift, 'NGN 50 short, discussed with the cashier']))
    expect((await summary(shift)).status).toBe('reviewed')
  })

  it('shows a cashier only their own shifts', async () => {
    expect((await as(cashier2, () => q('select * from public.cashier_shifts'))).length).toBe(0)
    expect((await as(cashier, () => q('select * from public.cashier_shifts'))).length).toBe(1)
    expect((await as(manager, () => q('select * from public.cashier_shifts'))).length).toBe(1)
    expect(await as(outsider, () => q('select * from public.cashier_shifts'))).toHaveLength(0)
  })
})

describe('overview', () => {
  const overview = (u: string, from = iso(-30), to = iso(0), b = biz) => as(u, () => q<{ r: Record<string, unknown> & { financial: Record<string, number> | null } }>('select public.mart_overview($1,$2,$3) as r', [b, from, to])).then((r) => r[0].r)

  it('reports operational figures to staff and money figures to those who may read financial reports', async () => {
    const staff = await overview(storekeeper)
    expect(Number(staff.transactions)).toBeGreaterThan(0)
    expect(staff.financial).toBeNull()
    const fin = (await overview(accountant)).financial!
    expect(fin.net_sales).toBeGreaterThan(0)
    expect(fin.gross_profit).toBeCloseTo(fin.net_sales - fin.cogs, 2)
    expect(fin.operating_profit_estimate).toBeCloseTo(fin.gross_profit - fin.operating_expenses - fin.stock_write_offs + fin.count_difference, 2)
    expect(fin.shift_variance).toBe(-50)
  })

  it('values stock from the ledger and matches the net-sales definition', async () => {
    const fin = (await overview(manager)).financial!
    const value = await num(`select coalesce(sum(b.quantity_on_hand * coalesce(b.avg_unit_cost,0)),0) as v from public.inventory_balances b join public.products p on p.id = b.product_id where b.business_id=$1 and p.status='active'`, [biz])
    expect(fin.inventory_value).toBeCloseTo(value, 2)
    const sales = await num(`select coalesce(sum(grand_total - tax_total - returned_total),0) as v from public.sales where business_id=$1 and status <> 'voided'`, [biz])
    expect(fin.net_sales).toBeCloseTo(sales, 2)
    await as(manager, () => q('select public.record_expense($1,$2,$3,$4,$5,$6,null,null,$7)', [biz, 'utilities', 5000, 'cash', 'Electricity', iso(0), key()]))
    expect((await overview(manager)).financial!.operating_expenses).toBe(5000)
  })

  it('counts low stock, out of stock and slow movers', async () => {
    const ov = await overview(manager)
    expect(Number(ov.low_stock) + Number(ov.out_of_stock)).toBeGreaterThanOrEqual(0)
    await save(manager, 'Never Sold', { reorder: null, cost: 50, price: 80 })
    await receive(storekeeper, [{ product_id: (await q<{ id: string }>(`select id from public.products where name='Never Sold'`))[0].id, quantity: 5, unit_cost: 50 }])
    expect(((await overview(manager)).slow_movers as { product: string }[]).map((s) => s.product)).toContain('Never Sold')
    await expect(overview(manager, iso(0), iso(-3))).rejects.toThrow(/valid period/)
  })
})

describe('business separation', () => {
  it('keeps another mart from reading or using these records', async () => {
    for (const t of ['mart_product_profiles', 'product_packs', 'mart_lots', 'stock_loss_records', 'supplier_returns', 'cashier_shifts', 'cash_movements']) {
      expect(await as(outsider, () => q(`select * from public.${t}`)), t).toHaveLength(0)
    }
    expect((await as(outsider, () => q<{ name: string }>('select name from public.mart_products'))).map((p) => p.name)).not.toContain('Bar Soap')
    await expect(as(outsider, () => q('select public.mart_overview($1,$2,$3)', [biz, iso(-3), iso(0)]))).rejects.toThrow(/permission denied/)
    await expect(as(outsider, () => q('select public.mart_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, JSON.stringify([{ product_id: soap, quantity: 1 }]), key()]))).rejects.toThrow(/permission denied/)
    const theirs = await save(outsider, 'Their Item', { b: bizB, cat: null })
    expect(theirs).toBeTruthy()
    await expect(as(manager, () => q('select public.mart_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, JSON.stringify([{ product_id: theirs, quantity: 1 }]), key()]))).rejects.toThrow(/invalid product/)
  })

  it('switches the mart modules on for a new retail business', async () => {
    const mods = await q<{ code: string }>(`select m.code from public.business_modules bm join public.modules m on m.id = bm.module_id where bm.business_id = $1 and m.code like 'retail-%' order by m.code`, [biz])
    expect(mods.map((m) => m.code)).toEqual(['retail-categories', 'retail-counts', 'retail-losses', 'retail-products', 'retail-reports', 'retail-returns', 'retail-shifts'])
  })
})
