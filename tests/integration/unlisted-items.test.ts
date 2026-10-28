import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, manager: string, cashier: string, outsider: string, pharmacist: string
let biz: string, bizP: string, loc: string, locP: string, cola: string
let n = 0
const key = () => `ui-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = JSON.stringify
const num = async (sql: string, params: unknown[] = []) => Number((await q<{ v: string }>(sql, params))[0].v)

type Line = Record<string, unknown>
const sell = (u: string, items: Line[], paid: number, b = biz, l = loc, rpc: 'post_sale' | 'mart_post_sale' = 'post_sale') =>
  as(u, () => q<{ r: { sale_id: string; grand_total: number } }>(`select public.${rpc}($1,$2,null,$3::jsonb,$4::jsonb,$5) as r`, [b, l, J(items), J([{ method: 'cash', amount: paid }]), key()])).then((r) => r[0].r)
const typed = (name: string, price: number, quantity = 1) => ({ custom_name: name, unit_price: price, quantity })
const allow = (u: string, on: boolean, b = biz) => as(u, () => q('select public.set_unlisted_items_allowed($1,$2)', [b, on]))
const receipt = async (u: string, sale: string) => (await as(u, () => q<{ r: { items: { description: string; unit_price: number; total: number }[] } }>('select public.sale_receipt($1) as r', [sale])))[0].r
/** A sale on credit for a customer, with nothing paid: it can be voided straight away. */
const creditSale = async (items: Line[]) => {
  const cust = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,$2) returning id`, [biz, 'Credit customer ' + n++])))[0].id
  await as(owner, () => q('select public.set_customer_credit_limit($1,100000)', [cust]))
  return as(manager, () => q<{ r: { sale_id: string } }>('select public.post_sale($1,$2,$3,$4::jsonb,$5::jsonb,$6) as r', [biz, loc, cust, J(items), '[]', key()])).then((x) => x[0].r)
}
const movements = () => num('select count(*) as v from public.stock_movements where business_id=$1', [biz])

beforeAll(async () => {
  db = await createDb()
  ;[owner, manager, cashier, outsider, pharmacist] = await Promise.all(['o', 'm', 'c', 'x', 'p'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Test Mart','retail') as id`)))[0].id
  bizP = (await as(pharmacist, () => q<{ id: string }>(`select public.create_business('Care Pharmacy','pharmacy') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[manager, 'manager'], [cashier, 'cashier']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role])); await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  locP = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [bizP]))[0].id
  const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='each'`, [biz]))[0].id
  cola = (await q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price) values ($1,$2,$3,300) returning id', [biz, 'Cola', unit]))[0].id
  await as(owner, () => q('select public.mart_receive_stock($1,$2,$3::jsonb,$4,$5)', [biz, loc, J([{ product_id: cola, quantity: 100, unit_cost: 200 }]), 'Opening', key()]))
})

describe('who may sell an item that is not in the product list', () => {
  it('lets the owner and a manager, and not a cashier until the owner allows it', async () => {
    await sell(owner, [typed('Garri (2 cups)', 400)], 400)
    await sell(manager, [typed('Plastic bag', 50, 3)], 150)
    await expect(sell(cashier, [typed('Garri (2 cups)', 400)], 400)).rejects.toThrow(/not allowed here/)
    await allow(owner, true)
    expect((await sell(cashier, [typed('Garri (2 cups)', 400)], 400)).sale_id).toBeTruthy()
    await allow(owner, false)
    await expect(sell(cashier, [typed('Garri (2 cups)', 400)], 400)).rejects.toThrow(/not allowed here/)
  })
  it('lets only an owner or admin change the setting, and keeps it in the audit trail', async () => {
    await expect(allow(manager, true)).rejects.toThrow(/permission denied/); await expect(allow(cashier, true)).rejects.toThrow(/permission denied/); await expect(allow(outsider, true)).rejects.toThrow(/permission denied/)
    await allow(owner, true); await allow(owner, false)
    const log = await q<{ metadata: { allowed: boolean } }>(`select metadata from public.audit_logs where business_id=$1 and action='business.unlisted_items' order by occurred_at`, [biz])
    expect(log.map((l) => l.metadata.allowed).slice(-2)).toEqual([true, false])
  })
  it('is refused to an outsider, and in a pharmacy, where every medicine must be a listed product', async () => {
    await expect(sell(outsider, [typed('X', 10)], 10)).rejects.toThrow(/permission denied/)
    await expect(sell(pharmacist, [typed('Paracetamol (loose)', 100)], 100, bizP, locP)).rejects.toThrow(/not allowed here/)
  })
})

describe('what a typed item does to the sale', () => {
  it('prints under the name that was typed, at the price that was typed, and adds up with listed items and tax', async () => {
    await as(owner, () => q('select public.set_business_tax($1,$2)', [biz, 10]))
    try {
      const s = await sell(manager, [{ product_id: cola, quantity: 2 }, typed('Garri (2 cups)', 400, 3)], 1980)
      expect(Number(s.grand_total)).toBe(1980) // (600 + 1200) + 10%
      const r = await receipt(manager, s.sale_id)
      expect(r.items.map((i) => [i.description, Number(i.unit_price), Number(i.total)]).sort()).toEqual([['Cola', 300, 660], ['Garri (2 cups)', 400, 1320]])
    } finally { await as(owner, () => q('select public.set_business_tax($1,$2)', [biz, 0])) }
  })
  it('takes nothing off the stock and records no stock movement', async () => {
    const before = await movements()
    await sell(manager, [typed('Loose sweets', 20, 10)], 200)
    expect(await movements()).toBe(before)
  })
  it('marks the sale, and only a sale with a typed item', async () => {
    const a = await sell(manager, [typed('Loose sweets', 20, 10)], 200); const b = await sell(manager, [{ product_id: cola, quantity: 1 }], 300)
    expect(await q('select 1 from public.sales where id=$1 and has_unlisted', [a.sale_id])).toHaveLength(1); expect(await q('select 1 from public.sales where id=$1 and has_unlisted', [b.sale_id])).toHaveLength(0)
  })
  it('needs a name and a price above zero with at most two decimals, and a name that is not too long', async () => {
    await expect(sell(manager, [{ custom_name: 'No price', quantity: 1 }], 0)).rejects.toThrow(/enter the price of No price/)
    for (const price of [0, -5, 10.555]) await expect(sell(manager, [typed('Odd', price)], 1)).rejects.toThrow(/enter the price of Odd/)
    await expect(sell(manager, [typed('x'.repeat(81), 10)], 10)).rejects.toThrow(/at most 80 characters/)
  })
  it('works through the mart\'s sale function too, next to a pack line', async () => {
    const s = await sell(manager, [typed('Garri (1 cup)', 200), { product_id: cola, quantity: 1 }], 500, biz, loc, 'mart_post_sale')
    expect(Number(s.grand_total)).toBe(500)
  })
  it('can be voided like any sale, and a sale that was voided leaves the reports', async () => {
    const s = await creditSale([typed('Garri (2 cups)', 400)])
    await as(owner, () => q('select public.void_sale($1,$2,$3)', [s.sale_id, 'Rung up twice', key()]))
    expect((await q<{ status: string }>('select status from public.sales where id=$1', [s.sale_id]))[0].status).toBe('voided')
  })
})

describe('where the placeholder shows, and where it does not', () => {
  it('stays out of the till list and the mart\'s product list, for everyone', async () => {
    for (const u of [owner, manager]) {
      const t = (await as(u, () => q<{ r: { products: { name: string }[] } }>('select public.till_catalog($1) as r', [biz])))[0].r
      expect(t.products.map((p) => p.name)).not.toContain('Unlisted item')
      expect((await as(u, () => q<{ name: string }>('select name from public.mart_products where business_id=$1', [biz]))).map((p) => p.name)).not.toContain('Unlisted item')
    }
  })
  it('tells the till whether a typed item may be added, and which product those lines sit on', async () => {
    const opt = (u: string) => as(u, () => q<{ r: { allowed: boolean; product_id: string | null } }>('select public.till_options($1) as r', [biz])).then((r) => r[0].r)
    expect((await opt(owner)).allowed).toBe(true); expect((await opt(manager)).allowed).toBe(true); expect((await opt(cashier)).allowed).toBe(false)
    expect((await opt(owner)).product_id).toBeTruthy()
    await allow(owner, true); expect((await opt(cashier)).allowed).toBe(true); await allow(owner, false)
    await expect(as(outsider, () => q('select public.till_options($1)', [biz]))).rejects.toThrow(/permission denied/)
  })
  it('is totalled in the reports as "sold without being in the product list", and counts only sales that stand', async () => {
    const o = async () => (await as(owner, () => q<{ o: { financial: { unlisted_sales: number; unlisted_count: number; net_sales: number } } }>('select public.mart_overview($1,current_date,current_date) as o', [biz])))[0].o.financial
    const before = await o()
    const s = await creditSale([typed('Garri (2 cups)', 400, 2)])
    const after = await o()
    expect(Number(after.unlisted_sales) - Number(before.unlisted_sales)).toBe(800); expect(after.unlisted_count - before.unlisted_count).toBe(1)
    expect(Number(after.net_sales) - Number(before.net_sales)).toBe(800)
    await as(owner, () => q('select public.void_sale($1,$2,$3)', [s.sale_id, 'Rung up twice', key()]))
    const gone = await o()
    expect(Number(gone.unlisted_sales)).toBe(Number(before.unlisted_sales)); expect(gone.unlisted_count).toBe(before.unlisted_count)
  })
})
