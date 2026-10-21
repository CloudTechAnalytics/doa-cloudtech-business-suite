import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, cashier: string, officer: string, other: string
let bizA: string, bizB: string
let locA: string, locA2: string, locB: string
let rice: string, flour: string, bProduct: string
let kg: string, g: string, litre: string

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
let n = 0
const key = () => `key-${Date.now()}-${n++}-abcdefgh`
const items = (...l: object[]) => JSON.stringify(l)
const receive = (u: string, biz: string, loc: string, its: object[], k = key()) =>
  as(u, () => q<{ r: { group_id: string; movement_ids: string[] } }>('select public.inventory_receive_stock($1,$2,$3::jsonb,$4,$5) as r', [biz, loc, items(...its), 'ref', k])).then((r) => r[0].r)
const qty = async (biz: string, p: string, l: string) =>
  Number((await q<{ quantity_on_hand: string }>('select quantity_on_hand from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3', [biz, p, l]))[0]?.quantity_on_hand ?? 0)
const avg = async (biz: string, p: string, l: string) =>
  Number((await q<{ avg_unit_cost: string }>('select avg_unit_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3', [biz, p, l]))[0]?.avg_unit_cost)
const unit = async (biz: string, code: string) => (await q<{ id: string }>('select id from public.units_of_measure where business_id=$1 and code=$2', [biz, code]))[0].id
const newProduct = (u: string, biz: string, name: string, base: string, extra: Record<string, unknown> = {}) =>
  as(u, () => q<{ id: string }>(
    'insert into public.products (business_id, name, base_unit_id, selling_price, sku, barcode, reorder_level) values ($1,$2,$3,$4,$5,$6,$7) returning id',
    [biz, name, base, extra.price ?? 100, extra.sku ?? null, extra.barcode ?? null, extra.reorder ?? null])).then((r) => r[0].id)

beforeAll(async () => {
  db = await createDb()
  owner = await createUser(db, 'owner@example.com')
  cashier = await createUser(db, 'cashier@example.com')
  officer = await createUser(db, 'officer@example.com')
  other = await createUser(db, 'other@example.com')
  bizA = (await as(owner, () => q<{ id: string }>(`select public.create_business('Shop A','retail') as id`)))[0].id
  bizB = (await as(other, () => q<{ id: string }>(`select public.create_business('Shop B','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  await as(owner, () => q(`select public.invite_member($1,'cashier@example.com','cashier')`, [bizA]))
  await as(owner, () => q(`select public.invite_member($1,'officer@example.com','inventory_officer')`, [bizA]))
  await as(cashier, () => q('select public.accept_my_invitations()'))
  await as(officer, () => q('select public.accept_my_invitations()'))
  ;[kg, g, litre] = [await unit(bizA, 'kg'), await unit(bizA, 'g'), await unit(bizA, 'l')]
  locA = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [bizA]))[0].id
  locB = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [bizB]))[0].id
  locA2 = (await as(owner, () => q<{ id: string }>(`insert into public.inventory_locations (business_id,name) values ($1,'Shelf 1') returning id`, [bizA])))[0].id
  rice = await newProduct(owner, bizA, 'Rice 50kg', kg, { sku: 'RICE-50', barcode: '1234567890123', reorder: 5 })
  flour = await newProduct(owner, bizA, 'Flour', kg, { sku: 'FLR' })
  bProduct = await newProduct(other, bizB, 'B product', await unit(bizB, 'kg'))
})

describe('catalogue', () => {
  it('seeds default units and a main location per business', async () => {
    expect((await q('select 1 from public.units_of_measure where business_id=$1', [bizA])).length).toBe(6)
    expect(locA).toBeTruthy()
  })

  it('enforces unique SKU (case-insensitive) and barcode within a business, but not across businesses', async () => {
    await expect(newProduct(owner, bizA, 'Dup', kg, { sku: 'rice-50' })).rejects.toThrow(/duplicate key/)
    await expect(newProduct(owner, bizA, 'Dup', kg, { barcode: '1234567890123' })).rejects.toThrow(/duplicate key/)
    await newProduct(other, bizB, 'Same SKU elsewhere', await unit(bizB, 'kg'), { sku: 'RICE-50' })
  })

  it('rejects a product that references another business unit', async () => {
    await expect(newProduct(owner, bizA, 'Bad unit', await unit(bizB, 'kg'))).rejects.toThrow(/foreign key/)
  })

  it('applies role permissions: cashier reads but cannot write the catalogue', async () => {
    expect(await as(cashier, () => q('select id from public.products where business_id=$1', [bizA]))).not.toHaveLength(0)
    await expect(newProduct(cashier, bizA, 'Nope', kg)).rejects.toThrow(/row-level security/)
  })

  it('archives instead of deleting, and cannot move products between businesses', async () => {
    await expect(as(owner, () => db.query('delete from public.products where id=$1', [flour]))).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => db.query('update public.products set business_id=$2 where id=$1', [flour, bizB]))).rejects.toThrow(/permission denied/)
  })
})

describe('receipts, costing and balances', () => {
  it('receiving increases stock and sets the cost', async () => {
    await receive(owner, bizA, locA, [{ product_id: rice, quantity: 10, unit_cost: 100 }])
    expect(await qty(bizA, rice, locA)).toBe(10)
    expect(await avg(bizA, rice, locA)).toBe(100)
  })

  it('uses weighted-average costing', async () => {
    await receive(owner, bizA, locA, [{ product_id: rice, quantity: 10, unit_cost: 200 }])
    expect(await qty(bizA, rice, locA)).toBe(20)
    expect(await avg(bizA, rice, locA)).toBe(150)
  })

  it('snapshots the average cost on outgoing movements without changing it', async () => {
    await as(officer, () => q(`select public.inventory_issue_stock($1,$2,$3::jsonb,'damaged goods',$4)`, [bizA, locA, items({ product_id: rice, quantity: 4 }), key()]))
    const [m] = await q<{ unit_cost: string }>(`select unit_cost from public.stock_movements where product_id=$1 and movement_type='issue'`, [rice])
    expect(Number(m.unit_cost)).toBe(150)
    expect(await qty(bizA, rice, locA)).toBe(16)
    expect(await avg(bizA, rice, locA)).toBe(150)
  })

  it('records a sale deduction through the posting primitive (used by Prompt 5)', async () => {
    await db.exec(`select public._post_movement('${bizA}','${rice}','${locA}','sale',-3,null,'sale',null,gen_random_uuid(),null)`)
    expect(await qty(bizA, rice, locA)).toBe(13)
  })

  it('rejects invalid quantities, products and locations', async () => {
    await expect(receive(owner, bizA, locA, [{ product_id: rice, quantity: 0 }])).rejects.toThrow(/greater than zero/)
    await expect(receive(owner, bizA, locA, [{ product_id: rice, quantity: -5 }])).rejects.toThrow(/greater than zero/)
    await expect(receive(owner, bizA, locA, [{ product_id: rice, quantity: 1, unit_cost: -1 }])).rejects.toThrow(/negative/)
    await expect(receive(owner, bizA, locA, [])).rejects.toThrow(/1 to 200/)
    await expect(receive(owner, bizA, locA, [{ product_id: bProduct, quantity: 1 }])).rejects.toThrow(/invalid product/)
    await expect(receive(owner, bizA, locB, [{ product_id: rice, quantity: 1 }])).rejects.toThrow(/location/)
  })
})

describe('overselling, concurrency primitives and idempotency', () => {
  it('refuses to oversell and leaves nothing partially posted', async () => {
    const before = await qty(bizA, rice, locA)
    await expect(as(owner, () => q(`select public.inventory_issue_stock($1,$2,$3::jsonb,'big issue',$4)`,
      [bizA, locA, items({ product_id: flour, quantity: 1 }, { product_id: rice, quantity: before + 1 }), key()]))).rejects.toThrow(/insufficient stock/)
    expect(await qty(bizA, rice, locA)).toBe(before)
    expect(await q('select 1 from public.stock_movements where product_id=$1', [flour])).toHaveLength(0)
  })

  it('allows negative stock only when the business setting permits it', async () => {
    await as(owner, () => db.query(`update public.businesses set settings = settings || '{"allow_negative_stock": true}' where id=$1`, [bizA]))
    await as(owner, () => q(`select public.inventory_issue_stock($1,$2,$3::jsonb,'backfill later',$4)`, [bizA, locA, items({ product_id: flour, quantity: 2 }), key()]))
    expect(await qty(bizA, flour, locA)).toBe(-2)
    await as(owner, () => db.query(`update public.businesses set settings = settings - 'allow_negative_stock' where id=$1`, [bizA]))
    await receive(owner, bizA, locA, [{ product_id: flour, quantity: 2, unit_cost: 50 }])
    expect(await qty(bizA, flour, locA)).toBe(0)
  })

  it('a retried request returns the original result and posts nothing twice', async () => {
    const k = key()
    const first = await receive(owner, bizA, locA, [{ product_id: flour, quantity: 5, unit_cost: 60 }], k)
    const second = await receive(owner, bizA, locA, [{ product_id: flour, quantity: 5, unit_cost: 60 }], k)
    expect(second).toEqual(first)
    expect(await qty(bizA, flour, locA)).toBe(5)
    expect(await q('select 1 from public.stock_movements where group_id=$1', [first.group_id])).toHaveLength(1)
  })

  it('rejects a key reused for a different operation, and missing keys', async () => {
    const k = key()
    await receive(owner, bizA, locA, [{ product_id: flour, quantity: 1 }], k)
    await expect(as(owner, () => q(`select public.inventory_issue_stock($1,$2,$3::jsonb,'reuse key',$4)`, [bizA, locA, items({ product_id: flour, quantity: 1 }), k]))).rejects.toThrow(/another operation/)
    await expect(as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,null)', [bizA, locA, items({ product_id: flour, quantity: 1 })]))).rejects.toThrow(/idempotency key/)
  })

  it('serialises postings through a row lock on the balance (single-connection check of the lock path)', async () => {
    const [def] = await q<{ d: string }>(`select pg_get_functiondef('public.apply_stock_movement'::regproc) as d`)
    expect(def.d).toMatch(/for update/)
  })
})

describe('transfers', () => {
  it('moves stock atomically and carries the cost', async () => {
    const [before, beforeDest] = [await qty(bizA, rice, locA), await qty(bizA, rice, locA2)]
    await as(officer, () => q('select public.inventory_transfer_stock($1,$2,$3,$4::jsonb,$5)', [bizA, locA, locA2, items({ product_id: rice, quantity: 5 }), key()]))
    expect(await qty(bizA, rice, locA)).toBe(before - 5)
    expect(await qty(bizA, rice, locA2)).toBe(beforeDest + 5)
    expect(await avg(bizA, rice, locA2)).toBe(150)
  })

  it('rolls back both legs when the source lacks stock', async () => {
    const total = async () => (await qty(bizA, rice, locA)) + (await qty(bizA, rice, locA2))
    const before = await total()
    await expect(as(officer, () => q('select public.inventory_transfer_stock($1,$2,$3,$4::jsonb,$5)', [bizA, locA, locA2, items({ product_id: rice, quantity: 9999 }), key()]))).rejects.toThrow(/insufficient/)
    expect(await total()).toBe(before)
  })

  it('rejects same-location and cross-business transfers', async () => {
    await expect(as(officer, () => q('select public.inventory_transfer_stock($1,$2,$3,$4::jsonb,$5)', [bizA, locA, locA, items({ product_id: rice, quantity: 1 }), key()]))).rejects.toThrow(/differ/)
    await expect(as(officer, () => q('select public.inventory_transfer_stock($1,$2,$3,$4::jsonb,$5)', [bizA, locA, locB, items({ product_id: rice, quantity: 1 }), key()]))).rejects.toThrow(/location/)
  })
})

describe('returns, reversals and adjustments', () => {
  it('requires reasons and rejects zero adjustments', async () => {
    await expect(as(owner, () => q('select public.inventory_adjust_stock($1,$2,$3,-1,$4,$5)', [bizA, locA, rice, '', key()]))).rejects.toThrow(/reason/)
    await expect(as(owner, () => q('select public.inventory_adjust_stock($1,$2,$3,0,$4,$5)', [bizA, locA, rice, 'nothing', key()]))).rejects.toThrow(/zero/)
  })

  it('posts an adjustment with its reason', async () => {
    const before = await qty(bizA, rice, locA)
    await as(owner, () => q('select public.inventory_adjust_stock($1,$2,$3,-2,$4,$5)', [bizA, locA, rice, 'spillage', key()]))
    expect(await qty(bizA, rice, locA)).toBe(before - 2)
  })

  it('processes customer returns and supplier returns', async () => {
    const before = await qty(bizA, rice, locA)
    await as(owner, () => q(`select public.inventory_return_stock($1,$2,$3,1,'in','customer return',150,$4)`, [bizA, locA, rice, key()]))
    await as(owner, () => q(`select public.inventory_return_stock($1,$2,$3,2,'out','damaged on arrival',null,$4)`, [bizA, locA, rice, key()]))
    expect(await qty(bizA, rice, locA)).toBe(before - 1)
  })

  it('reverses a movement exactly once and never a reversal', async () => {
    const r = await receive(owner, bizA, locA, [{ product_id: flour, quantity: 3, unit_cost: 70 }])
    const before = await qty(bizA, flour, locA)
    await as(owner, () => q('select public.inventory_reverse_movement($1,$2,$3)', [r.movement_ids[0], 'entered in error', key()]))
    expect(await qty(bizA, flour, locA)).toBe(before - 3)
    await expect(as(owner, () => q('select public.inventory_reverse_movement($1,$2,$3)', [r.movement_ids[0], 'again', key()]))).rejects.toThrow(/already reversed/)
    const [rev] = await q<{ id: string }>(`select id from public.stock_movements where reversal_of_movement_id=$1`, [r.movement_ids[0]])
    await expect(as(owner, () => q('select public.inventory_reverse_movement($1,$2,$3)', [rev.id, 'undo undo', key()]))).rejects.toThrow(/cannot be reversed/)
  })

  it('refuses to reverse a transfer leg', async () => {
    const [leg] = await q<{ id: string }>(`select id from public.stock_movements where movement_type='transfer_out' limit 1`)
    await expect(as(owner, () => q('select public.inventory_reverse_movement($1,$2,$3)', [leg.id, 'oops', key()]))).rejects.toThrow(/transfers cannot/)
  })
})

describe('unit conversion', () => {
  it('converts within a dimension and normalises to the base unit', async () => {
    const before = await qty(bizA, flour, locA)
    await receive(owner, bizA, locA, [{ product_id: flour, quantity: 500, unit_id: g, unit_cost: 0.1 }])
    expect(await qty(bizA, flour, locA)).toBeCloseTo(before + 0.5, 4)
    const r = await as(owner, () => q<{ v: string }>('select public.convert_quantity($1, 2, $2, $3) as v', [bizA, kg, g]))
    expect(Number(r[0].v)).toBe(2000)
  })

  it('rejects incompatible dimensions', async () => {
    await expect(receive(owner, bizA, locA, [{ product_id: flour, quantity: 1, unit_id: litre }])).rejects.toThrow(/incompatible units/)
    await expect(as(owner, () => q('select public.convert_quantity($1,1,$2,$3)', [bizA, kg, litre]))).rejects.toThrow(/incompatible units/)
  })

  it('locks the base unit once stock has moved', async () => {
    await expect(db.query('update public.products set base_unit_id=$2 where id=$1', [rice, g])).rejects.toThrow(/base unit/)
  })
})

describe('stock counts', () => {
  it('snapshots expected quantities and posts variances so the balance equals the count', async () => {
    const expected = await qty(bizA, rice, locA)
    const c = (await as(officer, () => q<{ r: { count_id: string } }>('select public.stock_count_start($1,$2,$3) as r', [bizA, locA, key()])))[0].r.count_id
    await as(officer, () => q('select public.stock_count_record($1,$2,$3)', [c, rice, expected - 4]))
    await expect(as(officer, () => q('select public.stock_count_post($1,$2)', [c, key()]))).rejects.toThrow(/manager must approve/)
    await as(owner, () => q('select public.stock_count_post($1,$2)', [c, key()]))
    expect(await qty(bizA, rice, locA)).toBe(expected - 4)
    const [item] = await q<{ expected_quantity: string }>('select expected_quantity from public.stock_count_items where stock_count_id=$1 and product_id=$2', [c, rice])
    expect(Number(item.expected_quantity)).toBe(expected)
    await expect(as(owner, () => q('select public.stock_count_post($1,$2)', [c, key()]))).rejects.toThrow(/already posted/)
  })
})

describe('ledger integrity and reconciliation', () => {
  it('balances reconcile with the ledger', async () => {
    expect(await as(owner, () => q('select * from public.inventory_reconcile($1)', [bizA]))).toHaveLength(0)
  })

  it('detects drift if a balance is tampered with outside the API', async () => {
    await db.query(`update public.inventory_balances set quantity_on_hand = quantity_on_hand + 1 where product_id=$1 and location_id=$2`, [rice, locA])
    const r = await as(owner, () => q<{ difference: string }>('select * from public.inventory_reconcile($1)', [bizA]))
    expect(r).toHaveLength(1)
    expect(Number(r[0].difference)).toBe(1)
    await db.query(`update public.inventory_balances set quantity_on_hand = quantity_on_hand - 1 where product_id=$1 and location_id=$2`, [rice, locA])
  })

  it('posted movements cannot be edited or deleted, even by the table owner', async () => {
    await expect(db.query('update public.stock_movements set quantity_delta = 999')).rejects.toThrow(/immutable/)
    await expect(db.query('delete from public.stock_movements')).rejects.toThrow(/immutable/)
  })
})

describe('tenant isolation and entitlements', () => {
  it('has no direct write path to the ledger or balances for authenticated users', async () => {
    await expect(as(owner, () => db.query(`insert into public.stock_movements (business_id,product_id,location_id,movement_type,quantity_delta,source_type) values ($1,$2,$3,'receipt',5,'x')`, [bizA, rice, locA]))).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => db.query('update public.inventory_balances set quantity_on_hand = 1000'))).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => db.query('select * from public.idempotency_records'))).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => q('select public._post_movement($1,$2,$3,$4,1,null,$5,null,gen_random_uuid(),null)', [bizA, rice, locA, 'receipt', 'x']))).rejects.toThrow(/permission denied/)
  })

  it("business B's user cannot see or touch business A's inventory", async () => {
    for (const t of ['products', 'stock_movements', 'inventory_balances', 'inventory_locations', 'units_of_measure', 'stock_counts']) {
      expect(await as(other, () => q(`select * from public.${t} where business_id=$1`, [bizA])), t).toHaveLength(0)
    }
    await expect(receive(other, bizA, locA, [{ product_id: rice, quantity: 1 }])).rejects.toThrow(/permission denied/)
    await expect(as(other, () => q('select public.inventory_reverse_movement((select id from public.stock_movements limit 1),$1,$2)', ['sneaky', key()]))).rejects.toThrow()
  })

  it('cashiers cannot post stock operations', async () => {
    await expect(receive(cashier, bizA, locA, [{ product_id: rice, quantity: 1 }])).rejects.toThrow(/permission denied/)
  })

  it('blocks stock operations when the plan lapses but keeps history readable', async () => {
    await db.query(`update public.subscriptions set status='expired', current_period_end=now()-interval '1 day' where business_id=$1`, [bizA])
    await expect(receive(owner, bizA, locA, [{ product_id: rice, quantity: 1 }])).rejects.toThrow(/permission denied/)
    expect(await as(owner, () => q('select * from public.stock_movements where business_id=$1', [bizA]))).not.toHaveLength(0)
    await db.query(`update public.subscriptions set status='active', current_period_end=now()+interval '30 days' where business_id=$1`, [bizA])
  })

  it('blocks stock operations when the inventory module is turned off, keeping history readable', async () => {
    await as(owner, () => q(`select public.disable_module($1,'inventory')`, [bizA]))
    await expect(receive(owner, bizA, locA, [{ product_id: rice, quantity: 1 }])).rejects.toThrow(/permission denied/)
    expect(await as(owner, () => q('select * from public.inventory_balances where business_id=$1', [bizA]))).not.toHaveLength(0)
    await as(owner, () => q(`select public.enable_module($1,'inventory')`, [bizA]))
  })
})
