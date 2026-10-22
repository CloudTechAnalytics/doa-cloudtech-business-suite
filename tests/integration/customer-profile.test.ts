import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, cashier: string, accountant: string, outsider: string
let biz: string, loc: string, ada: string, chidi: string, rice: string, oil: string
let n = 0
const key = () => `cp-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const sell = (customer: string | null, items: object[], paid: number) =>
  as(cashier, () => q<{ r: { sale_id: string } }>('select public.post_sale($1,$2,$3,$4::jsonb,$5::jsonb,$6) as r', [biz, loc, customer, JSON.stringify(items), JSON.stringify(paid > 0 ? [{ method: 'cash', amount: paid }] : []), key()])).then((r) => r[0].r.sale_id)
const summary = (u: string, c: string) => as(u, () => q<{ orders: string; lifetime_spend: string; paid: string; outstanding: string; last_purchase_at: string | null }>('select * from public.customer_summary where customer_id=$1', [c])).then((r) => r[0])

beforeAll(async () => {
  db = await createDb()
  ;[owner, cashier, accountant, outsider] = await Promise.all(['o', 'c', 'a', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('CityMart','retail') as id`)))[0].id
  await as(outsider, () => q(`select public.create_business('Other','retail')`))
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[cashier, 'cashier'], [accountant, 'accountant']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  const save = (name: string, price: number) => as(owner, () => q<{ r: { product_id: string } }>('select public.mart_save_product($1,null,$2,null,null,null,null,$3,$4,$5,null,null,null,false,true,$6::jsonb,$7) as r', [biz, name, 'each', price / 2, price, '[]', key()])).then((r) => r[0].r.product_id)
  rice = await save('Rice 1kg', 1000); oil = await save('Veg Oil 1L', 2000)
  await as(owner, () => q('select public.mart_receive_stock($1,$2,$3::jsonb,$4,$5)', [biz, loc, JSON.stringify([{ product_id: rice, quantity: 100, unit_cost: 500 }, { product_id: oil, quantity: 100, unit_cost: 1000 }]), 'Opening', key()]))
  ada = (await as(cashier, () => q<{ id: string }>(`insert into public.customers (business_id,name,company,contact_person,city,address,notes,category) values ($1,'Ada Obi','Ada Stores','Ada','Lagos','12 Market Rd','Pays on Fridays','Retailer') returning id`, [biz])))[0].id
  chidi = (await as(cashier, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Chidi Foods') returning id`, [biz])))[0].id
  await as(owner, () => q('select public.set_credit_limit($1,$2,$3)', [biz, ada, 50000])).catch(async () => { await db.exec(`update public.customers set credit_limit = 50000 where id = '${ada}'`) })
})

describe('customer details', () => {
  it('stores the fuller profile and lets staff with customer access change it', async () => {
    const c = (await as(cashier, () => q<{ company: string; city: string; notes: string; contact_person: string }>('select company, city, notes, contact_person from public.customers where id=$1', [ada])))[0]
    expect(c).toMatchObject({ company: 'Ada Stores', city: 'Lagos', notes: 'Pays on Fridays', contact_person: 'Ada' })
    await as(cashier, () => q(`update public.customers set city='Ikeja', notes='Prefers delivery' where id=$1`, [ada]))
    expect((await q<{ city: string }>('select city from public.customers where id=$1', [ada]))[0].city).toBe('Ikeja')
  })

  it('refuses edits from staff without customer access and from other businesses', async () => {
    await as(accountant, () => q(`update public.customers set city='Abuja' where id=$1`, [ada]))
    expect((await q<{ city: string }>('select city from public.customers where id=$1', [ada]))[0].city).toBe('Ikeja') // the policy matched no rows
    await as(outsider, () => q(`update public.customers set city='Abuja' where id=$1`, [ada]))
    expect((await q<{ city: string }>('select city from public.customers where id=$1', [ada]))[0].city).toBe('Ikeja')
    expect(await as(outsider, () => q('select id from public.customers where id=$1', [ada]))).toHaveLength(0)
  })

  it('rejects an over-long note', async () => {
    await expect(as(cashier, () => q(`update public.customers set notes = repeat('x', 2001) where id=$1`, [ada]))).rejects.toThrow()
  })
})

describe('what a customer spends and buys', () => {
  it('starts at zero for a customer who has bought nothing', async () => {
    const z = await summary(owner, chidi)
    expect([Number(z.orders), Number(z.lifetime_spend), Number(z.outstanding), z.last_purchase_at]).toEqual([0, 0, 0, null])
  })

  it('adds up sales net of returns, shows what is owed, and ignores voided sales', async () => {
    const s1 = await sell(ada, [{ product_id: rice, quantity: 10 }, { product_id: oil, quantity: 2 }], 14000) // 10,000 + 4,000, paid in full
    await sell(ada, [{ product_id: oil, quantity: 4 }], 4000) // 8,000, 4,000 on credit
    const bad = await sell(ada, [{ product_id: rice, quantity: 1 }], 0) // on credit, then voided
    await as(owner, () => q(`select public.void_sale($1,'entered twice',$2)`, [bad, key()]))
    const item = (await q<{ id: string }>('select id from public.sale_items where sale_id=$1 and product_id=$2', [s1, rice]))[0].id
    await as(owner, () => q(`select public.return_sale($1,$2::jsonb,'Damaged',null,$3)`, [s1, JSON.stringify([{ sale_item_id: item, quantity: 2, disposition: 'restock' }]), key()]))
    const s = await summary(owner, ada)
    expect(Number(s.orders)).toBe(2)
    expect(Number(s.lifetime_spend)).toBe(20000) // 10,000 + 4,000 + 8,000 less the 2,000 returned
    expect(Number(s.outstanding)).toBe(4000)
    expect(s.last_purchase_at).not.toBeNull()
  })

  it('ranks the products they buy by revenue', async () => {
    const top = (await as(owner, () => q<{ r: { product: string; units: number; revenue: number }[] }>('select public.customer_top_products($1,5) as r', [ada])))[0].r
    expect(top.map((t) => t.product)).toEqual(['Veg Oil 1L', 'Rice 1kg'])
    expect(top[0]).toMatchObject({ units: 6 })
    expect(Number(top[0].revenue)).toBe(12000)
  })

  it('shows money only to roles that can read sales, and nothing across businesses', async () => {
    expect(await summary(accountant, ada)).toBeUndefined() // accountants can read sales but not customer records
    expect(Number((await summary(cashier, ada)).orders)).toBe(2) // cashiers read both customers and sales
    await expect(as(outsider, () => q('select public.customer_top_products($1,5)', [ada]))).rejects.toThrow(/permission denied/)
    expect(await as(outsider, () => q('select * from public.customer_summary where customer_id=$1', [ada]))).toHaveLength(0)
  })
})
