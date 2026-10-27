import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, other: string
let n = 0
const key = () => `use-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const lines = (price: number) => JSON.stringify([{ description: 'Job', quantity: 1, unit_price: price }])
const setLimits = (plan: string, limits: Record<string, number>) => db.exec(`update public.subscription_plans set limits = '{"max_members": 50, "max_branches": 10}'::jsonb || '${JSON.stringify(limits)}'::jsonb where code = '${plan}'`)
const business = async (u = owner, type = 'general') => {
  const id = (await as(u, () => q<{ id: string }>(`select public.create_business('B ${n++}','${type}') as id`)))[0].id
  return id
}
const usage = async (b: string) => Object.fromEntries((await as(owner, () => q<{ r: { key: string; used: number; limit: number | null }[] }>('select public.my_usage($1) as r', [b])))[0].r.map((x) => [x.key, [x.used, x.limit]]))
const addCustomer = (b: string, name: string) => as(owner, () => q<{ id: string }>('insert into public.customers (business_id, name) values ($1,$2) returning id', [b, name]))
const invoice = (b: string, c: string, price = 100) => as(owner, () => q<{ id: string }>('select public.invoice_save($1,null,$2,null,$3::jsonb,0,0,$4) as id', [b, c, lines(price), ''])).then((r) => r[0].id)

beforeAll(async () => {
  db = await createDb()
  ;[owner, other] = await Promise.all(['o', 'x'].map((p) => createUser(db, `${p}@example.com`)))
})

describe('usage limits', () => {
  it('start with no limit on any seeded plan, so nothing is blocked until numbers are set', async () => {
    const r = await q<{ code: string; limits: Record<string, number> }>('select code, limits from public.subscription_plans')
    for (const p of r) expect(Object.keys(p.limits).sort(), p.code).toEqual(['max_branches', 'max_members'])
    const b = await business()
    expect(await usage(b)).toEqual({ customers: [0, null], invoices_per_month: [0, null], sales_per_month: [0, null], expenses_per_month: [0, null] })
  })

  it('stop a new customer when the plan limit is used up, with a message that says what to do', async () => {
    await setLimits('starter', { customers: 2 })
    const b = await business()
    await addCustomer(b, 'One'); await addCustomer(b, 'Two')
    await expect(addCustomer(b, 'Three')).rejects.toThrow(/plan limit reached: your plan allows 2 customers/)
    expect(await usage(b)).toMatchObject({ customers: [2, 2] })
    await setLimits('starter', {})
  })

  it('apply to customers added by any route, not only the table', async () => {
    await setLimits('starter', { customers: 1 })
    const b = await business()
    await as(owner, () => q("select public.invoice_add_customer($1,$2,null,'first@example.com')", [b, 'First']))
    await expect(as(owner, () => q('select public.invoice_add_customer($1,$2,null,null)', [b, 'Second']))).rejects.toThrow(/plan limit reached/)
    const again = await as(owner, () => q<{ id: string }>("select public.invoice_add_customer($1,$2,null,'FIRST@example.com') as id", [b, 'First again']))
    expect(again[0].id).toBeTruthy() // a match is reused, so no new record and no block
    await setLimits('starter', {})
  })

  it('count invoices a month, ignore cancelled ones and last month, and keep what exists editable', async () => {
    await setLimits('starter', { invoices_per_month: 2 })
    const b = await business()
    const c = (await addCustomer(b, 'Payer'))[0].id
    const a = await invoice(b, c); await invoice(b, c)
    await expect(invoice(b, c)).rejects.toThrow(/plan limit reached: your plan allows 2 invoices a month/)
    await as(owner, () => q('select public.invoice_cancel($1,$2)', [a, 'Made by mistake']))
    expect(await usage(b)).toMatchObject({ invoices_per_month: [1, 2] })
    await invoice(b, c) // the cancelled one no longer counts
    await expect(invoice(b, c)).rejects.toThrow(/plan limit reached/)
    // existing records stay editable at the limit
    const id = (await q<{ id: string }>(`select id from public.invoices where business_id=$1 and status='draft' limit 1`, [b]))[0].id
    await as(owner, () => q('select public.invoice_save($1,$2,$3,null,$4::jsonb,0,0,$5)', [b, id, c, lines(999), 'edited']))
    expect((await q<{ total: string }>('select total from public.invoices where id=$1', [id]))[0].total).toBe('999.00')
    // last month's invoices do not count against this month
    await db.exec(`update public.invoices set created_at = now() - interval '40 days' where business_id = '${b}'`)
    expect(await usage(b)).toMatchObject({ invoices_per_month: [0, 2] })
    await invoice(b, c)
    await setLimits('starter', {})
  })

  it('count expenses and sales a month the same way', async () => {
    await setLimits('starter', { expenses_per_month: 1 })
    const b = await business()
    await as(owner, () => q(`select public.record_expense($1,'rent',100,'cash','Office rent',current_date,null,null,$2)`, [b, key()]))
    await expect(as(owner, () => q(`select public.record_expense($1,'rent',100,'cash','More rent',current_date,null,null,$2)`, [b, key()]))).rejects.toThrow(/plan limit reached: your plan allows 1 expenses a month/)
    await setLimits('starter', {})
  })

  it('lift when the business moves to a bigger plan, and never remove records when a plan is lowered', async () => {
    await setLimits('starter', { customers: 1 }); await setLimits('growth', { customers: 5 })
    const b = await business()
    await addCustomer(b, 'One')
    await expect(addCustomer(b, 'Two')).rejects.toThrow(/plan limit reached/)
    await db.exec(`update public.subscriptions set plan_id = (select id from public.subscription_plans where code = 'growth') where business_id = '${b}'`)
    await addCustomer(b, 'Two'); await addCustomer(b, 'Three')
    expect(await usage(b)).toMatchObject({ customers: [3, 5] })
    await setLimits('growth', { customers: 1 }) // lowered below what exists: nothing is removed, only new ones are blocked
    expect((await as(owner, () => q('select id from public.customers where business_id=$1', [b]))).length).toBe(3)
    await expect(addCustomer(b, 'Four')).rejects.toThrow(/plan limit reached/)
    await setLimits('starter', {}); await setLimits('growth', {})
  })

  it('belong to the business: one business at its limit does not stop another, and only members can see usage', async () => {
    await setLimits('starter', { customers: 1 })
    const a = await business(owner); const z = await business(other)
    await addCustomer(a, 'A1')
    await expect(addCustomer(a, 'A2')).rejects.toThrow(/plan limit reached/)
    await as(other, () => q('insert into public.customers (business_id, name) values ($1,$2)', [z, 'Z1']))
    await expect(as(other, () => q('select public.my_usage($1)', [a]))).rejects.toThrow(/permission denied/)
    await setLimits('starter', {})
  })

  it('cannot be switched off from the browser: the helper functions are not callable by users', async () => {
    const b = await business()
    await expect(as(owner, () => q('select public._plan_limit($1,$2)', [b, 'customers']))).rejects.toThrow()
    await expect(as(owner, () => q('select public._usage($1,$2)', [b, 'customers']))).rejects.toThrow()
    await expect(as(owner, () => q(`update public.subscription_plans set limits = '{}'::jsonb`))).rejects.toThrow()
  })
})
