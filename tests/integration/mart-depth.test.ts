import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, manager: string, cashier: string, outsider: string
let biz: string, loc: string
let n = 0
const key = () => `md-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = JSON.stringify
const num = async (sql: string, params: unknown[] = []) => Number((await q<{ v: string }>(sql, params))[0].v)
const stock = (p: string) => num('select coalesce(sum(quantity_on_hand),0) as v from public.inventory_balances where product_id=$1', [p])
const save = (u: string, name: string) => as(u, () => q<{ r: { product_id: string } }>('select public.mart_save_product($1,$2,$3,null,$4,$5,null,$6,$7,$8,null,$9,null,$10,$11,$12::jsonb,$13) as r', [biz, null, name, null, null, 'each', 100, 150, 5, false, true, '[]', key()])).then((r) => r[0].r.product_id)
const receive = (u: string, p: string, qty: number) => as(u, () => q<{ r: { movement_ids: string[] } }>('select public.mart_receive_stock($1,$2,$3::jsonb,$4,$5) as r', [biz, loc, J([{ product_id: p, quantity: qty, unit_cost: 100 }]), 'Delivery', key()])).then((r) => r[0].r.movement_ids[0])
const sell = (p: string, qty: number) => as(owner, () => q('select public.mart_post_sale($1,$2,null,$3::jsonb,$4::jsonb,$5)', [biz, loc, J([{ product_id: p, quantity: qty }]), J([{ method: 'cash', amount: qty * 150 }]), key()]))
const reverse = (u: string, mv: string, reason = 'Entered by mistake') => as(u, () => q('select public.inventory_reverse_movement($1,$2,$3)', [mv, reason, key()]))
const movementOf = async (p: string, type: string) => (await q<{ id: string }>('select id from public.stock_movements where product_id=$1 and movement_type=$2 order by occurred_at desc, id limit 1', [p, type]))[0].id
const del = (u: string, kind: string, id: string) => as(u, () => q('select public.delete_record($1,$2)', [kind, id]))

beforeAll(async () => {
  db = await createDb()
  ;[owner, manager, cashier, outsider] = await Promise.all(['o', 'm', 'c', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Mart','retail') as id`)))[0].id
  for (const [u, role] of [[manager, 'manager'], [cashier, 'cashier']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role])); await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
})

describe('the free plan', () => {
  it('includes the supplier list, so a new mart can add suppliers and send goods back, and still not purchase orders', async () => {
    const usable = (await as(owner, () => q<{ module_code: string; usable: boolean }>('select * from public.my_modules($1)', [biz]))).filter((m) => m.usable).map((m) => m.module_code)
    expect(usable).toContain('suppliers'); expect(usable).toContain('retail-returns'); expect(usable).not.toContain('purchases')
  })
})

describe('undoing a stock receipt made by mistake', () => {
  it('takes the stock back out, needs a reason, and only once', async () => {
    const p = await save(manager, 'Biscuits'); const mv = await receive(manager, p, 20)
    expect(await stock(p)).toBe(20)
    await expect(reverse(manager, mv, 'x')).rejects.toThrow(/reason is required/)
    await reverse(manager, mv); expect(await stock(p)).toBe(0)
    await expect(reverse(manager, mv)).rejects.toThrow(/already reversed/)
  })
  it('is refused for a cashier and an outsider', async () => {
    const p = await save(manager, 'Sweets'); const mv = await receive(manager, p, 5)
    await expect(reverse(cashier, mv)).rejects.toThrow(/permission denied/); await expect(reverse(outsider, mv)).rejects.toThrow(/permission denied/)
    expect(await stock(p)).toBe(5)
  })
  it('refuses to undo a movement that belongs to a sale or a loss: that is undone where it was made', async () => {
    const p = await save(manager, 'Juice'); await receive(manager, p, 20); await sell(p, 2)
    await expect(reverse(manager, await movementOf(p, 'sale'))).rejects.toThrow(/belongs to a sale, loss, count, return or purchase/)
    await as(manager, () => q('select public.mart_record_loss($1,$2,$3,1,$4,$5,$6)', [biz, p, loc, 'damaged', 'dropped', key()]))
    await expect(reverse(manager, await movementOf(p, 'adjustment'))).rejects.toThrow(/belongs to a sale, loss/)
    expect(await stock(p)).toBe(17)
  })
  it('refuses when the stock has already been sold, rather than leaving less than nothing on the shelf', async () => {
    const p = await save(manager, 'Bread'); const mv = await receive(manager, p, 3); await sell(p, 3)
    await expect(reverse(manager, mv)).rejects.toThrow()
    expect(await stock(p)).toBe(0)
  })
})

describe('deleting a product', () => {
  it('works only for a product nothing has ever happened to', async () => {
    const fresh = await save(manager, 'Never used'); await del(manager, 'product', fresh)
    expect(await q('select 1 from public.products where id=$1', [fresh])).toHaveLength(0)
  })
  it('is refused once the product has been received or sold, and the message says to archive it', async () => {
    const stocked = await save(manager, 'Stocked'); await receive(manager, stocked, 1)
    await expect(del(manager, 'product', stocked)).rejects.toThrow(/cannot be deleted because it is used by other records.*Archive it instead/)
    const sold = await save(manager, 'Sold'); await receive(manager, sold, 5); await sell(sold, 1)
    await expect(del(manager, 'product', sold)).rejects.toThrow(/cannot be deleted/)
    expect(await q('select 1 from public.products where id in ($1,$2)', [stocked, sold])).toHaveLength(2)
  })
  it('is refused to a cashier and an outsider, and a category with products in it cannot be deleted either', async () => {
    const p = await save(manager, 'Guarded')
    await expect(del(cashier, 'product', p)).rejects.toThrow(/permission denied/); await expect(del(outsider, 'product', p)).rejects.toThrow(/permission denied/)
    const cat = (await as(manager, () => q<{ id: string }>(`insert into public.product_categories (business_id,name) values ($1,'Drinks') returning id`, [biz])))[0].id
    await as(manager, () => q('update public.products set category_id=$2 where id=$1', [p, cat]))
    await expect(del(manager, 'category', cat)).rejects.toThrow(/cannot be deleted/)
  })
})

describe('archiving a product that cannot be deleted', () => {
  const saveAs = (u: string, o: { id?: string | null; name: string; barcode?: string | null; active?: boolean }) =>
    as(u, () => q<{ r: { product_id: string } }>('select public.mart_save_product($1,$2,$3,null,$4,$5,null,$6,$7,$8,null,$9,null,$10,$11,$12::jsonb,$13) as r', [biz, o.id ?? null, o.name, o.barcode ?? null, null, 'each', 100, 150, 5, false, o.active ?? true, '[]', key()])).then((r) => r[0].r.product_id)
  it('frees the name and the barcode, so the product can be entered again properly', async () => {
    const wrong = await saveAs(manager, { name: 'Margarine', barcode: '5551110001' }); await receive(manager, wrong, 4); await sell(wrong, 1)
    await expect(saveAs(manager, { name: 'Margarine', barcode: '5551110099' })).rejects.toThrow(/name already exists/)
    await expect(saveAs(manager, { name: 'Margarine 2', barcode: '5551110001' })).rejects.toThrow(/SKU or barcode/)
    await saveAs(manager, { id: wrong, name: 'Margarine', barcode: '5551110001', active: false })
    const right = await saveAs(manager, { name: 'Margarine', barcode: '5551110001' })
    expect(right).not.toBe(wrong)
    expect(await q(`select 1 from public.products where business_id=$1 and lower(name)='margarine' and status='active'`, [biz])).toHaveLength(1)
  })
  it('refuses to bring an archived product back while an active one has its name or barcode', async () => {
    await expect(saveAs(manager, { id: (await q<{ id: string }>(`select id from public.products where business_id=$1 and lower(name)='margarine' and status='archived'`, [biz]))[0].id, name: 'Margarine', barcode: '5551110001', active: true })).rejects.toThrow(/name already exists/)
  })
  it('keeps the archived product out of sales and its history in the books', async () => {
    const id = (await q<{ id: string }>(`select id from public.products where business_id=$1 and lower(name)='margarine' and status='archived'`, [biz]))[0].id
    await expect(sell(id, 1)).rejects.toThrow()
    expect(await num('select count(*) as v from public.stock_movements where product_id=$1', [id])).toBeGreaterThan(0)
  })
})

describe('profit counts the stock that was lost', () => {
  const overview = async () => (await as(owner, () => q<{ o: { financial: Record<string, number> } }>('select public.mart_overview($1,current_date,current_date) as o', [biz])))[0].o.financial
  it('takes written-off stock and count shortages off the profit, and leaves out what was voided', async () => {
    const p = await save(manager, 'Profit probe'); await receive(manager, p, 50); await sell(p, 10)
    const before = await overview()
    expect(Number(before.operating_profit_estimate)).toBeCloseTo(Number(before.gross_profit) - Number(before.operating_expenses) - Number(before.stock_write_offs) + Number(before.count_difference), 2)
    await as(manager, () => q('select public.mart_record_loss($1,$2,$3,5,$4,$5,$6)', [biz, p, loc, 'damaged', 'water damage', key()]))
    const mid = await overview()
    expect(Number(mid.stock_write_offs) - Number(before.stock_write_offs)).toBeCloseTo(500, 2)
    expect(Number(mid.operating_profit_estimate)).toBeCloseTo(Number(before.operating_profit_estimate) - 500, 2)
    const c = (await as(manager, () => q<{ r: { count_id: string } }>('select public.mart_start_count($1,$2,null,$3) as r', [biz, loc, key()])))[0].r
    expect(c).toBeTruthy()
    const loss = (await q<{ id: string }>('select id from public.stock_loss_records where product_id=$1', [p]))[0].id
    await as(manager, () => q('select public.mart_void_loss($1,$2,$3)', [loss, 'recorded twice', key()]))
    const after = await overview()
    expect(Number(after.stock_write_offs)).toBeCloseTo(Number(before.stock_write_offs), 2)
    expect(Number(after.operating_profit_estimate)).toBeCloseTo(Number(before.operating_profit_estimate), 2)
  })
})

describe('a pack with a price of its own', () => {
  const withPacks = (u: string, name: string, price: number, packs: object[], id: string | null = null) =>
    as(u, () => q<{ r: { product_id: string } }>('select public.mart_save_product($1,$2,$3,null,$4,$5,null,$6,$7,$8,null,$9,null,$10,$11,$12::jsonb,$13) as r', [biz, id, name, null, null, 'each', 100, price, 5, false, true, J(packs), key()])).then((r) => r[0].r.product_id)
  const sellPack = (u: string, p: string, pack: string, unitPrice: number | null, paid: number, extra: object = {}) =>
    as(u, () => q<{ r: { sale_id: string } }>('select public.mart_post_sale($1,$2,null,$3::jsonb,$4::jsonb,$5) as r', [biz, loc, J([{ product_id: p, quantity: 1, pack, unit_price: unitPrice, ...extra }]), J([{ method: 'cash', amount: paid }]), key()])).then((r) => r[0].r.sale_id)
  const total = async (sale: string) => num('select grand_total as v from public.sales where id=$1', [sale])
  it('sells at the pack price, takes the units off the stock, and records the saving as a discount the cashier did not need permission for', async () => {
    const p = await withPacks(manager, 'Soda', 200, [{ name: 'carton', units: 12, price: 2000 }, { name: 'dozen', units: 12 }]); await receive(manager, p, 100)
    const sale = await sellPack(cashier, p, 'carton', 2000, 2000)
    expect(await total(sale)).toBe(2000); expect(await stock(p)).toBe(88)
    expect(await num('select discount_amount as v from public.sale_items where sale_id=$1', [sale])).toBe(400)
    expect(await total(await sellPack(cashier, p, 'dozen', 2400, 2400))).toBe(2400)
  })
  it('does not let the till set the pack price, and still needs the permission for a discount typed by hand', async () => {
    const p = await withPacks(manager, 'Water', 100, [{ name: 'carton', units: 10, price: 900 }]); await receive(manager, p, 50)
    await expect(sellPack(cashier, p, 'carton', 800, 800)).rejects.toThrow(/price of the carton has changed to 900/)
    await expect(sellPack(cashier, p, 'carton', 900, 850, { discount_amount: 50 })).rejects.toThrow(/not allowed to give discounts/)
    expect(await total(await sellPack(manager, p, 'carton', 900, 850, { discount_amount: 50 }))).toBe(850)
  })
  it('refuses a pack price above its units sold one by one, and a pack price goes back to the default when it is cleared', async () => {
    await expect(withPacks(manager, 'Juice box', 100, [{ name: 'case', units: 6, price: 700 }])).rejects.toThrow(/cannot be more than its units sold one by one/)
    const p = await withPacks(manager, 'Tea', 100, [{ name: 'box', units: 6, price: 500 }]); await receive(manager, p, 30)
    expect(await total(await sellPack(cashier, p, 'box', 500, 500))).toBe(500)
    await withPacks(manager, 'Tea', 100, [{ name: 'box', units: 6 }], p)
    expect(await total(await sellPack(cashier, p, 'box', 600, 600))).toBe(600)
  })
  it('keeps the tax on what was charged, not on the full price', async () => {
    const p = await withPacks(manager, 'Biscuit tin', 100, [{ name: 'carton', units: 10, price: 800 }]); await receive(manager, p, 100)
    await as(owner, () => q('select public.set_business_tax($1,$2)', [biz, 10]))
    try { expect(await total(await sellPack(cashier, p, 'carton', 800, 880))).toBe(880) } finally { await as(owner, () => q('select public.set_business_tax($1,$2)', [biz, 0])) }
  })
})

describe('what the shop pays is private to people who run the stock', () => {
  type Till = { products: { id: string; name: string; selling_price: number; default_cost: unknown }[]; balances: { product_id: string; qty: number; avg_cost: unknown }[]; packs: unknown[] }
  const till = async (u: string) => (await as(u, () => q<{ r: Till }>('select public.till_catalog($1) as r', [biz])))[0].r
  it('gives a cashier the till list with prices and quantities, and no costs anywhere in it', async () => {
    const p = await save(manager, 'Costly'); await receive(manager, p, 7)
    const c = await till(cashier)
    const mine = c.products.find((x) => x.id === p)!
    expect(mine.name).toBe('Costly'); expect(Number(mine.selling_price)).toBe(150); expect(mine.default_cost).toBeNull()
    expect(Number(c.balances.find((b) => b.product_id === p)!.qty)).toBe(7); expect(c.balances.every((b) => b.avg_cost === null)).toBe(true)
    expect(JSON.stringify(c)).not.toMatch(/"default_cost":\s*[0-9]|"avg_cost":\s*[0-9]/)
  })
  it('gives the manager the costs in the same list, and an outsider nothing', async () => {
    const p = await save(manager, 'Costly 2'); await receive(manager, p, 3)
    const m = await till(manager)
    expect(Number(m.products.find((x) => x.id === p)!.default_cost)).toBe(100); expect(Number(m.balances.find((b) => b.product_id === p)!.avg_cost)).toBe(100)
    await expect(till(outsider)).rejects.toThrow(/permission denied/)
  })
  it('keeps a cashier out of every table that holds a cost', async () => {
    for (const t of ['products', 'inventory_balances', 'stock_movements', 'mart_products', 'mart_lots']) expect(await as(cashier, () => q(`select * from public.${t} where business_id=$1`, [biz])), t).toHaveLength(0)
  })
  it('keeps the cost on a sale line from everyone, while a cashier still reads the lines themselves; the reports still use it', async () => {
    const p = await save(manager, 'Costly 3'); await receive(manager, p, 10); const sale = await sell(p, 2)
    expect(await as(cashier, () => q('select id, quantity, unit_price, line_total from public.sale_items where business_id=$1', [biz]))).not.toHaveLength(0)
    for (const u of [cashier, manager, owner]) await expect(as(u, () => q('select unit_cost_snapshot from public.sale_items where business_id=$1', [biz]))).rejects.toThrow(/permission denied/)
    expect(sale).toBeTruthy()
    const f = (await as(owner, () => q<{ o: { financial: { cogs: number } } }>('select public.mart_overview($1,current_date,current_date) as o', [biz])))[0].o.financial
    expect(Number(f.cogs)).toBeGreaterThan(0)
  })
})

describe('product pictures', () => {
  const jpeg = (kb: number) => 'data:image/jpeg;base64,' + 'A'.repeat(kb * 1000)
  const set = (u: string, p: string, thumb: string | null, image: string | null) => as(u, () => q('select public.mart_set_product_image($1,$2,$3)', [p, thumb, image]))
  it('lets a manager add, change and remove a picture; the small one and the large one are kept apart', async () => {
    const p = await save(manager, 'Pictured')
    await set(manager, p, jpeg(5), jpeg(80))
    expect(await q('select 1 from public.product_thumbs where product_id=$1', [p])).toHaveLength(1); expect(await q('select 1 from public.product_images where product_id=$1', [p])).toHaveLength(1)
    await set(manager, p, jpeg(6), jpeg(90)); expect(await num('select count(*) as v from public.product_thumbs where product_id=$1', [p])).toBe(1)
    await set(manager, p, null, null)
    expect(await num('select ((select count(*) from public.product_thumbs where product_id=$1) + (select count(*) from public.product_images where product_id=$1)) as v', [p])).toBe(0)
  })
  it('lets a cashier see pictures (it is the till) but not change them, and keeps them from outsiders', async () => {
    const p = await save(manager, 'Pictured 2'); await set(manager, p, jpeg(5), jpeg(80))
    expect((await as(cashier, () => q('select 1 from public.product_thumbs where business_id=$1', [biz]))).length).toBeGreaterThan(0)
    await expect(set(cashier, p, jpeg(5), jpeg(80))).rejects.toThrow(/permission denied/)
    await expect(set(outsider, p, jpeg(5), jpeg(80))).rejects.toThrow(/permission denied/)
    expect(await as(outsider, () => q('select 1 from public.product_thumbs where business_id=$1', [biz]))).toHaveLength(0)
    expect(await as(outsider, () => q('select 1 from public.product_images where business_id=$1', [biz]))).toHaveLength(0)
  })
  it('refuses anything that is not a small JPEG', async () => {
    const p = await save(manager, 'Pictured 3')
    await expect(set(manager, p, 'data:image/png;base64,AAAA', jpeg(5))).rejects.toThrow(/JPEG/)
    await expect(set(manager, p, jpeg(5), 'data:text/html;base64,AAAA')).rejects.toThrow(/JPEG/)
    await expect(set(manager, p, jpeg(40), jpeg(80))).rejects.toThrow()
    await expect(set(manager, p, jpeg(5), jpeg(250))).rejects.toThrow()
  })
  it('goes when the product goes', async () => {
    const p = await save(manager, 'Pictured 4'); await set(manager, p, jpeg(5), jpeg(80)); await del(manager, 'product', p)
    expect(await q('select 1 from public.product_thumbs where product_id=$1', [p])).toHaveLength(0)
  })
})
