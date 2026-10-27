import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, outsider: string
let biz: string, loc: string, loc2: string
let n = 0
const key = () => `inv-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
type Result = { created: number; stocked: number; duplicates: number[]; invalid: { row: number; reason: string }[] }
const imp = (list: Record<string, string>[], where: string | null = loc, k = key(), u = owner) =>
  as(u, () => q<{ r: Result }>('select public.inventory_import_products($1,$2,$3::jsonb,$4) as r', [biz, where, JSON.stringify(list), k])).then((r) => r[0].r)
const onHand = async (sku: string, where = loc) => Number((await q<{ quantity_on_hand: string }>('select b.quantity_on_hand from public.inventory_balances b join public.products p on p.id=b.product_id where p.sku=$1 and b.location_id=$2', [sku, where]))[0]?.quantity_on_hand ?? 0)

beforeAll(async () => {
  db = await createDb()
  ;[owner, outsider] = await Promise.all(['o', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Corner Shop','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  loc2 = (await as(owner, () => q<{ id: string }>(`insert into public.inventory_locations (business_id,name,location_type) values ($1,'Back room','store') returning id`, [biz])))[0].id
})

describe('importing a product list', () => {
  it('creates products, categories and opening stock in one step, through the ledger', async () => {
    const r = await imp([
      { name: 'Bottled water', sku: 'WAT', unit: 'each', category: 'Drinks', price: '200', cost: '120', reorder: '10', quantity: '48' },
      { name: 'Orange juice', sku: 'OJ', category: 'drinks', price: '500', cost: '300', quantity: '12' },
      { name: 'Delivery', sku: 'DEL', type: 'Service', category: 'Services', price: '1500' },
    ])
    expect(r).toMatchObject({ created: 3, stocked: 2, duplicates: [], invalid: [] })
    expect(await onHand('WAT')).toBe(48); expect(await onHand('OJ')).toBe(12)
    expect((await q<{ n: string }>(`select count(*)::text n from public.product_categories where business_id=$1`, [biz]))[0].n).toBe('2') // "Drinks" and "drinks" are one category
    const w = (await q<{ unit_cost: string; movement_type: string; reason: string }>(`select m.unit_cost, m.movement_type, m.reason from public.stock_movements m join public.products p on p.id=m.product_id where p.sku='WAT'`))[0]
    expect(w).toEqual({ unit_cost: '120.0000', movement_type: 'receipt', reason: 'Opening stock (import)' })
  })

  it('marks a service as keeping no stock and gives it no movement', async () => {
    const d = (await q<{ tracks_stock: boolean }>(`select tracks_stock from public.products where sku='DEL'`))[0]
    expect(d.tracks_stock).toBe(false)
    expect((await q<{ n: string }>(`select count(*)::text n from public.stock_movements m join public.products p on p.id=m.product_id where p.sku='DEL'`))[0].n).toBe('0')
  })

  it('skips what already exists (by SKU, barcode, or name when neither is given) and what repeats inside the file', async () => {
    const r = await imp([
      { name: 'Bottled water again', sku: 'wat' }, // existing SKU, any case
      { name: 'New thing', sku: 'NEW1', barcode: '600111' },
      { name: 'Other thing', barcode: '600111' }, // same barcode as the row just before it
      { name: 'orange JUICE' }, // neither SKU nor barcode, so the name decides, whatever the case
      { name: 'Plain' },
      { name: 'plain' }, // repeats inside the file
    ])
    expect(r.created).toBe(2) // New thing and Plain
    expect(r.duplicates).toEqual([1, 3, 4, 6])
  })

  it('refuses unreadable rows one by one and imports the rest', async () => {
    const r = await imp([
      { name: '', sku: 'E1' }, { name: 'Bad price', sku: 'E2', price: 'abc' }, { name: 'Negative', sku: 'E3', cost: '-5' },
      { name: 'Odd unit', sku: 'E4', unit: 'bucket' }, { name: 'Service with stock', sku: 'E5', type: 'service', quantity: '4' }, { name: 'Fine', sku: 'E6', price: '10' },
    ])
    expect(r.created).toBe(1)
    expect(r.invalid.map((x) => x.row)).toEqual([1, 2, 3, 4, 5])
    expect(r.invalid[0].reason).toMatch(/no name/); expect(r.invalid[1].reason).toMatch(/not a number/); expect(r.invalid[2].reason).toMatch(/negative/); expect(r.invalid[3].reason).toMatch(/unknown unit/); expect(r.invalid[4].reason).toMatch(/service/)
  })

  it('asks where opening stock goes when a row has a quantity and no location is given', async () => {
    const r = await imp([{ name: 'No place', sku: 'NP', quantity: '5' }], null)
    expect(r.created).toBe(0); expect(r.invalid[0].reason).toMatch(/where/)
    const ok = await imp([{ name: 'Priced only', sku: 'PO', price: '5' }], null)
    expect(ok.created).toBe(1)
  })

  it('does nothing the second time the same request arrives', async () => {
    const k = key()
    const first = await imp([{ name: 'Once only', sku: 'ONCE', quantity: '3' }], loc2, k)
    const again = await imp([{ name: 'Once only', sku: 'ONCE', quantity: '3' }], loc2, k)
    expect(again).toEqual(first); expect(first.created).toBe(1)
    expect(await onHand('ONCE', loc2)).toBe(3)
  })

  it('takes at most 500 rows and needs at least one', async () => {
    await expect(imp(Array.from({ length: 501 }, (_, i) => ({ name: `P${i}`, sku: `BIG${i}` })))).rejects.toThrow(/500/)
    await expect(imp([])).rejects.toThrow(/no rows/)
  })

  it('is closed to people outside the business, and to a location that is not the business\'s', async () => {
    await expect(imp([{ name: 'Sneaky', sku: 'SN' }], loc, key(), outsider)).rejects.toThrow()
    const other = (await as(outsider, () => q<{ id: string }>(`select public.create_business('Other','retail') as id`)))[0].id
    const foreign = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [other]))[0].id
    await expect(imp([{ name: 'Cross', sku: 'CR', quantity: '1' }], foreign)).rejects.toThrow()
    expect((await q<{ n: string }>(`select count(*)::text n from public.products where sku in ('SN','CR')`))[0].n).toBe('0')
  })
})

describe('selling a service', () => {
  it('needs no stock, moves none, and shows on the sale', async () => {
    const svc = (await q<{ id: string }>(`select id from public.products where sku='DEL'`))[0].id
    const before = Number((await q<{ n: string }>('select count(*)::text n from public.stock_movements where business_id=$1', [biz]))[0].n)
    const r = await as(owner, () => q<{ r: { sale_id: string } }>('select public.post_sale($1,$2,null,$3::jsonb,$4::jsonb,$5) as r', [biz, loc, JSON.stringify([{ product_id: svc, quantity: 2 }]), JSON.stringify([{ method: 'cash', amount: 3000 }]), key()]))
    const sale = (await q<{ grand_total: string; payment_status: string }>('select grand_total, payment_status from public.sales where id=$1', [r[0].r.sale_id]))[0]
    expect(sale).toEqual({ grand_total: '3000.00', payment_status: 'paid' })
    expect(Number((await q<{ n: string }>('select count(*)::text n from public.stock_movements where business_id=$1', [biz]))[0].n)).toBe(before)
  })

  it('cannot be received, adjusted or counted, because there is no stock to hold', async () => {
    const svc = (await q<{ id: string }>(`select id from public.products where sku='DEL'`))[0].id
    await expect(as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, JSON.stringify([{ product_id: svc, quantity: 1 }]), key()]))).rejects.toThrow()
    const c = (await as(owner, () => q<{ r: { count_id: string } }>('select public.stock_count_start($1,$2,$3) as r', [biz, loc, key()])))[0].r.count_id
    expect((await q<{ n: string }>('select count(*)::text n from public.stock_count_items where stock_count_id=$1 and product_id=$2', [c, svc]))[0].n).toBe('0')
  })
})

describe('counting stock', () => {
  it('lists what the books say, takes what was found, and posts only the differences against the stock at the time', async () => {
    const wat = (await q<{ id: string }>(`select id from public.products where sku='WAT'`))[0].id
    const oj = (await q<{ id: string }>(`select id from public.products where sku='OJ'`))[0].id
    const c = (await as(owner, () => q<{ r: { count_id: string } }>('select public.stock_count_start($1,$2,$3) as r', [biz, loc, key()])))[0].r.count_id
    const exp = (await q<{ product_id: string; expected_quantity: string }>('select product_id, expected_quantity from public.stock_count_items where stock_count_id=$1', [c]))
    expect(Number(exp.find((x) => x.product_id === wat)!.expected_quantity)).toBe(48)
    await as(owner, () => q('select public.stock_count_record($1,$2,$3)', [c, wat, 45])) // 3 missing
    await as(owner, () => q('select public.stock_count_record($1,$2,$3)', [c, oj, 12])) // matches
    await as(owner, () => q('select public.inventory_issue_stock($1,$2,$3::jsonb,$4,$5)', [biz, loc, JSON.stringify([{ product_id: wat, quantity: 2 }]), 'sold during the count', key()])) // stock moves while counting
    const k = key()
    const posted = (await as(owner, () => q<{ r: { movement_ids: string[] } }>('select public.stock_count_post($1,$2) as r', [c, k])))[0].r
    expect(posted.movement_ids).toHaveLength(1) // only Bottled water differed
    expect(await onHand('WAT')).toBe(45) // equals what was counted, not 43
    expect((await as(owner, () => q<{ r: { movement_ids: string[] } }>('select public.stock_count_post($1,$2) as r', [c, k])))[0].r).toEqual(posted) // same key, same answer
    await expect(as(owner, () => q('select public.stock_count_post($1,$2)', [c, key()]))).rejects.toThrow(/already posted/)
    await expect(as(owner, () => q('select public.stock_count_record($1,$2,$3)', [c, wat, 1]))).rejects.toThrow()
  })
})
