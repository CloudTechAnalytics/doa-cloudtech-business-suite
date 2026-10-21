import { beforeAll, expect, it } from 'vitest'
import { priceCart, refundForReturn } from '@/modules/sales/pricing'
import { asUser, createDb, createUser, rows } from '../helpers/harness'

let db: Awaited<ReturnType<typeof createDb>>
beforeAll(async () => { db = await createDb() })

// Prices and quantities chosen to hit awkward rounding (half-cent boundaries, 4dp quantities, odd tax rates).
const cases: { qty: number; price: number; discount: number; rate: number }[] = [
  { qty: 2, price: 1000, discount: 100, rate: 7.5 },
  { qty: 3, price: 333.33, discount: 0, rate: 7.5 },
  { qty: 0.3333, price: 99.99, discount: 0.01, rate: 5 },
  { qty: 1.005, price: 10, discount: 0, rate: 0 },
  { qty: 7, price: 0.05, discount: 0.1, rate: 12.5 },
  { qty: 12.5, price: 1234.56, discount: 100, rate: 7.5 },
  { qty: 1, price: 0.01, discount: 0, rate: 7.5 },
  { qty: 0.0001, price: 50000, discount: 0, rate: 10 },
  { qty: 2.5, price: 19.99, discount: 0, rate: 7.5 },
  { qty: 100, price: 4.35, discount: 5, rate: 0.5 },
]

it('browser pricing equals the server for every awkward case', async () => {
  const owner = await createUser(db, 'o@example.com')
  const biz = (await asUser(db, owner, () => rows<{ id: string }>(db, `select public.create_business('P','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  const loc = (await rows<{ id: string }>(db, 'select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  const unit = (await rows<{ id: string }>(db, `select id from public.units_of_measure where business_id=$1 and code='each'`, [biz]))[0].id
  const customer = (await asUser(db, owner, () => rows<{ id: string }>(db, `insert into public.customers (business_id,name) values ($1,'Big Credit') returning id`, [biz])))[0].id
  await asUser(db, owner, () => rows(db, 'select public.set_customer_credit_limit($1, 1000000000)', [customer]))
  for (const [i, c] of cases.entries()) {
    await db.query(`update public.businesses set settings = settings || $2::jsonb where id=$1`, [biz, JSON.stringify({ tax_rate_percent: c.rate })])
    const p = (await asUser(db, owner, () => rows<{ id: string }>(db,
      'insert into public.products (business_id,name,base_unit_id,selling_price,tracks_stock) values ($1,$2,$3,$4,false) returning id', [biz, `P${i}`, unit, c.price])))[0].id
    const item = { product_id: p, quantity: c.qty, discount_amount: c.discount }
    const r = (await asUser(db, owner, () => rows<{ r: { sale_id: string } }>(db,
      'select public.post_sale($1,$2,$3,$4::jsonb,$5::jsonb,$6) as r', [biz, loc, customer, JSON.stringify([item]), '[]', `pp-${i}-abcdefgh`])))[0].r
    const [s] = await rows<{ subtotal: string; discount_total: string; tax_total: string; grand_total: string }>(db, 'select * from public.sales where id=$1', [r.sale_id])
    const priced = priceCart([{ quantity: c.qty, unitPrice: c.price, discount: c.discount }], c.rate)
    expect([Number(s.subtotal), Number(s.discount_total), Number(s.tax_total), Number(s.grand_total)], JSON.stringify(c))
      .toEqual([priced.subtotal, priced.discountTotal, priced.taxTotal, priced.grandTotal])
  }
})

it('refund splitting matches the documented remainder rule', () => {
  const parts = [refundForReturn(2999, 3, 0, 0, 1), refundForReturn(2999, 3, 1, 999.67, 1), refundForReturn(2999, 3, 2, 1999.34, 1)]
  expect(parts).toEqual([999.67, 999.67, 999.66])
})
