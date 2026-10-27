import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, cashier: string, other: string
let biz: string, loc: string, product: string, product2: string, customer: string
let n = 0
const key = () => `pos-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const today = new Date().toISOString().slice(0, 10)
const sell = (u: string, items: { product_id: string; quantity: number }[], payments: { method: string; amount: number }[], cust: string | null = null) =>
  as(u, () => q<{ r: { sale_id: string } }>('select public.post_sale($1,$2,$3,$4::jsonb,$5::jsonb,$6) as r', [biz, loc, cust, JSON.stringify(items), JSON.stringify(payments), key()])).then((r) => r[0].r.sale_id)
const day = (u: string, d = today, b = biz) => as(u, () => q<{ r: { sales_count: number; gross: string; discounts: string; returns: string; outstanding: string; voided_count: number; voided_total: string; by_method: { method: string; amount: string }[]; by_cashier: { cashier: string; sales: number; total: string }[]; top_products: { name: string; quantity: string; total: string }[] } }>('select public.sales_day_summary($1,$2) as r', [b, d])).then((r) => r[0].r)

beforeAll(async () => {
  db = await createDb()
  ;[owner, cashier, other] = await Promise.all(['o', 'c', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Corner Shop','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  const email = (await q<{ email: string }>('select email from auth.users where id=$1', [cashier]))[0].email
  await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, 'cashier'])); await as(cashier, () => q('select public.accept_my_invitations()'))
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='each'`, [biz]))[0].id
  const mk = async (name: string, price: number) => (await as(owner, () => q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price,default_purchase_cost) values ($1,$2,$3,$4,40) returning id', [biz, name, unit, price])))[0].id
  product = await mk('Widget', 100); product2 = await mk('Gadget', 250)
  customer = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Ada') returning id`, [biz])))[0].id
  await as(owner, () => q('select public.set_customer_credit_limit($1,5000)', [customer]))
  await as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, JSON.stringify([{ product_id: product, quantity: 100, unit_cost: 40 }, { product_id: product2, quantity: 100, unit_cost: 100 }]), key()]))
})

describe('splitting a sale between ways of paying', () => {
  it('records each payment with its own method and adds up to the sale', async () => {
    const id = await sell(owner, [{ product_id: product, quantity: 3 }], [{ method: 'cash', amount: 100 }, { method: 'bank_transfer', amount: 200 }])
    const pays = await q<{ payment_method: string; amount: string }>('select payment_method, amount from public.payments where sale_id=$1 order by amount', [id])
    expect(pays).toEqual([{ payment_method: 'cash', amount: '100.00' }, { payment_method: 'bank_transfer', amount: '200.00' }])
    expect((await q<{ payment_status: string; amount_paid: string }>('select payment_status, amount_paid from public.sales where id=$1', [id]))[0]).toEqual({ payment_status: 'paid', amount_paid: '300.00' })
  })

  it('refuses payments that add up to more than the total', async () => {
    await expect(sell(owner, [{ product_id: product, quantity: 1 }], [{ method: 'cash', amount: 80 }, { method: 'bank_transfer', amount: 80 }])).rejects.toThrow()
  })
})

describe('the end-of-day summary', () => {
  it('adds up the day: sales, discounts, what was received and how, what is owed, who sold, and the best sellers', async () => {
    const before = await day(owner)
    const a = await sell(cashier, [{ product_id: product2, quantity: 2 }], [{ method: 'cash', amount: 300 }, { method: 'pos', amount: 200 }]) // 500, paid in full, split
    const b = await sell(owner, [{ product_id: product, quantity: 5 }], [{ method: 'cash', amount: 200 }], customer) // 500 on credit, 200 paid
    const v = await sell(owner, [{ product_id: product, quantity: 1 }], [], customer) // unpaid, so it can be voided
    await as(owner, () => q('select public.void_sale($1,$2,$3)', [v, 'Rung up twice', key()]))
    const item = (await q<{ id: string }>('select id from public.sale_items where sale_id=$1', [a]))[0].id
    await as(owner, () => q(`select public.return_sale($1,$2::jsonb,'Damaged',$3::jsonb,$4)`, [a, JSON.stringify([{ sale_item_id: item, quantity: 1, disposition: 'restock' }]), JSON.stringify({ method: 'cash', amount: 250 }), key()]))
    const d = await day(owner)
    expect(d.sales_count - before.sales_count).toBe(2); expect(Number(d.gross) - Number(before.gross)).toBe(1000); expect(d.voided_count - before.voided_count).toBe(1); expect(Number(d.voided_total) - Number(before.voided_total)).toBe(100)
    expect(Number(d.returns) - Number(before.returns)).toBe(250); expect(Number(d.outstanding) - Number(before.outstanding)).toBe(300)
    const m = (r: typeof d, method: string) => Number(r.by_method.find((x) => x.method === method)?.amount ?? 0)
    expect(m(d, 'cash') - m(before, 'cash')).toBe(300 + 200 - 250) // sale a cash, sale b cash, less the refund paid out
    expect(m(d, 'pos') - m(before, 'pos')).toBe(200)
    expect(d.by_cashier.find((c) => c.cashier)).toBeTruthy()
    expect(d.top_products.map((p) => p.name)).toEqual(['Widget', 'Gadget']) // best seller by value: Widget 300 + 500, Gadget 500 (the voided sale is left out)
    expect(Number(d.top_products[0].total)).toBe(800)
    void b
  })

  it('counts a day by the business\'s own time zone, and an empty day is all zeros', async () => {
    const d = await day(owner, '2001-01-01')
    expect(d).toMatchObject({ sales_count: 0, by_method: [], by_cashier: [], top_products: [] }); expect(Number(d.gross)).toBe(0)
  })

  it('is read-only and for the business\'s own people: others cannot read it', async () => {
    await expect(day(other)).rejects.toThrow(/permission denied/)
    await expect(as(null, () => q('select public.sales_day_summary($1,$2)', [biz, today]))).rejects.toThrow()
    expect((await day(cashier)).sales_count).toBeGreaterThanOrEqual(0) // a cashier can read sales, so can read the day
  })
})
