import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'
import { demoSetTax, demoSignIn, demoSignOut, getDemoState } from '@/demo/demoStore'

let db: Db
let owner: string, admin: string, cashier: string, other: string
let biz: string, loc: string, cola: string
let n = 0
const key = () => `tax-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = JSON.stringify
const setTax = (u: string, rate: number | null, b = biz) => as(u, () => q('select public.set_business_tax($1,$2)', [b, rate]))
const sell = (qty: number, pay: number) => as(owner, () => q<{ r: { grand_total: number; sale_id: string } }>('select public.post_sale($1,$2,null,$3::jsonb,$4::jsonb,$5) as r', [biz, loc, J([{ product_id: cola, quantity: qty }]), J([{ method: 'cash', amount: pay }]), key()])).then((r) => r[0].r)
const rateNow = async () => Number((await q<{ r: string | null }>(`select settings ->> 'tax_rate_percent' as r from public.businesses where id=$1`, [biz]))[0].r ?? 0)

beforeAll(async () => {
  db = await createDb()
  ;[owner, admin, cashier, other] = await Promise.all(['o', 'a', 'c', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Test Mart','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[admin, 'business_admin'], [cashier, 'cashier']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role])); await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='each'`, [biz]))[0].id
  cola = (await q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price) values ($1,$2,$3,300) returning id', [biz, 'Cola', unit]))[0].id
  await as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, J([{ product_id: cola, quantity: 100, unit_cost: 200 }]), key()]))
})

describe('changing the sales tax after the business exists', () => {
  it('lets the owner and an admin change it, and keeps the old and new rate in the audit trail', async () => {
    await setTax(owner, 7.5); expect(await rateNow()).toBe(7.5)
    await setTax(admin, 5); expect(await rateNow()).toBe(5)
    const log = await q<{ metadata: { from: number; to: number } }>(`select metadata from public.audit_logs where business_id=$1 and action='business.tax_rate' order by occurred_at`, [biz])
    expect(log.map((l) => [Number(l.metadata.from), Number(l.metadata.to)]).sort((a, b) => a[1] - b[1])).toEqual([[7.5, 5], [0, 7.5]])
  })
  it('refuses a cashier and an outsider, and rates outside 0 to 100', async () => {
    await expect(setTax(cashier, 1)).rejects.toThrow(/permission denied/); await expect(setTax(other, 1)).rejects.toThrow(/permission denied/)
    for (const bad of [-1, 100.5, null]) await expect(setTax(owner, bad)).rejects.toThrow(/between 0 and 100/)
    expect(await rateNow()).toBe(5)
  })
  it('applies to sales made after the change and never to sales already made', async () => {
    await setTax(owner, 7.5)
    const a = await sell(3, 967.5); expect(Number(a.grand_total)).toBe(967.5)
    await setTax(owner, 0)
    const b = await sell(3, 900); expect(Number(b.grand_total)).toBe(900)
    expect(Number((await q<{ g: string }>('select grand_total as g from public.sales where id=$1', [a.sale_id]))[0].g)).toBe(967.5)
  })
})

describe('the same in the demo', () => {
  it('is refused to a cashier and to bad rates, and works for the owner', () => {
    const B = getDemoState().businesses.find((b) => b.industry === 'retail')!.id
    demoSignOut(); demoSignIn('cashier@demo.test', 'demo1234')
    expect(demoSetTax(B, 5)).toMatch(/permission denied/)
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
    expect(demoSetTax(B, 101)).toMatch(/between 0 and 100/); expect(demoSetTax(B, 7.5)).toBeNull()
    expect(getDemoState().businesses.find((b) => b.id === B)!.settings?.tax_rate_percent).toBe(7.5)
  })
})
