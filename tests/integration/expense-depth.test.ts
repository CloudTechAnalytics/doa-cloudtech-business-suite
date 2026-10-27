import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, viewer: string, other: string
let biz: string
let n = 0
const key = () => `exp-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const today = new Date().toISOString().slice(0, 10)
const month = `${today.slice(0, 7)}-01`
const spend = (category: string, amount: number, o: { date?: string; method?: string; supplier?: string | null; u?: string } = {}) =>
  as(o.u ?? owner, () => q<{ r: { expense_id: string } }>('select public.record_expense($1,$2,$3,$4,$5,$6,$7,null,$8) as r', [biz, category, amount, o.method ?? 'cash', `Spend on ${category}`, o.date ?? today, o.supplier ?? null, key()])).then((r) => r[0].r.expense_id)
type Status = { month: string; rows: { category: string; budget: number | null; spent: number }[] }
const status = (m = month, u = owner) => as(u, () => q<{ r: Status }>('select public.expense_budget_status($1,$2) as r', [biz, m])).then((r) => r[0].r)
const budget = (category: string, amount: number | null, u = owner) => as(u, () => q('select public.expense_set_budget($1,$2,$3)', [biz, category, amount]))

beforeAll(async () => {
  db = await createDb()
  ;[owner, viewer, other] = await Promise.all(['o', 'v', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Consulting Co','general') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  const email = (await q<{ email: string }>('select email from auth.users where id=$1', [viewer]))[0].email
  await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, 'viewer'])); await as(viewer, () => q('select public.accept_my_invitations()'))
})

describe('your own categories', () => {
  it('accepts any short lower-case name, not just the farm set, and refuses what is not one', async () => {
    await spend('marketing', 100); await spend('staff_welfare', 50)
    expect((await q<{ n: string }>(`select count(*)::text n from public.expenses where category in ('marketing','staff_welfare')`))[0].n).toBe('2')
    for (const bad of ['Marketing', 'a', '1abc', 'has space', 'x'.repeat(41), '']) await expect(spend(bad, 5)).rejects.toThrow(/choose a category/)
  })
})

describe('budgets', () => {
  it('put the monthly budget next to what was spent, voided entries left out, and list spending that has no budget', async () => {
    await budget('transport', 1000)
    const a = await spend('transport', 300); await spend('transport', 200); await spend('rent', 800)
    await as(owner, () => q('select public.void_expense($1,$2,$3)', [a, 'Entered twice', key()]))
    const s = await status()
    expect(s.month).toBe(month)
    expect(s.rows.find((r) => r.category === 'transport')).toEqual({ category: 'transport', budget: 1000, spent: 200 })
    expect(s.rows.find((r) => r.category === 'rent')).toEqual({ category: 'rent', budget: null, spent: 800 })
  })
  it('apply to every month, and each month shows only its own spending', async () => {
    const last = new Date(`${month}T00:00:00Z`); last.setUTCMonth(last.getUTCMonth() - 1)
    const lastDay = new Date(last); const date = lastDay.toISOString().slice(0, 10)
    await spend('transport', 150, { date })
    const s = await status(date)
    expect(s.rows.find((r) => r.category === 'transport')).toEqual({ category: 'transport', budget: 1000, spent: 150 })
    expect(s.rows.find((r) => r.category === 'rent')).toBeUndefined()
  })
  it('can be changed and removed, and removing writes the audit log', async () => {
    await budget('transport', 1500)
    expect((await status()).rows.find((r) => r.category === 'transport')!.budget).toBe(1500)
    await budget('transport', null)
    expect((await status()).rows.find((r) => r.category === 'transport')!.budget).toBeNull()
    expect((await q<{ n: string }>(`select count(*)::text n from public.audit_logs where action='expense_budgets.delete' and business_id=$1`, [biz]))[0].n).toBe('1')
    await budget('transport', 0) // nothing to remove: no second entry
    expect((await q<{ n: string }>(`select count(*)::text n from public.audit_logs where action='expense_budgets.delete' and business_id=$1`, [biz]))[0].n).toBe('1')
  })
  it('refuse a negative amount or a bad category, and are for people who can record expenses', async () => {
    await expect(budget('transport', -5)).rejects.toThrow(/negative/)
    await expect(budget('Bad Name', 5)).rejects.toThrow(/choose a category/)
    await expect(budget('transport', 100, viewer)).rejects.toThrow(/permission denied/)
    await expect(budget('transport', 100, other)).rejects.toThrow(/permission denied/)
    expect((await status(month, viewer)).rows.length).toBeGreaterThan(0) // a viewer can read them
    await expect(status(month, other)).rejects.toThrow(/permission denied/)
  })
})

describe('the spending report', () => {
  type Rep = { total: number; count: number; by_category: { category: string; total: number; count: number }[]; by_month: { month: string; total: number }[]; by_method: { method: string; total: number }[]; by_supplier: { supplier: string; total: number }[] }
  const report = (from: string, to: string, u = owner) => as(u, () => q<{ r: Rep }>('select public.expense_report($1,$2,$3) as r', [biz, from, to])).then((r) => r[0].r)
  it('adds up a period by category, month, payment method and supplier, leaving out voided entries', async () => {
    const b = (await as(owner, () => q<{ id: string }>(`select public.create_business('Report Co','general') as id`)))[0].id
    const put = (c: string, amount: number, method: string, supplier: string | null = null) => as(owner, () => q('select public.record_expense($1,$2,$3,$4,$5,$6,$7,null,$8)', [b, c, amount, method, `x ${c}`, today, supplier, key()]))
    const sup2 = (await q<{ id: string }>(`insert into public.suppliers (business_id,name) values ($1,'Fuel Depot') returning id`, [b]))[0].id
    await put('fuel_energy', 400, 'cash', sup2); await put('fuel_energy', 100, 'bank_transfer', sup2); await put('rent', 1000, 'bank_transfer')
    const gone = (await as(owner, () => q<{ r: { expense_id: string } }>('select public.record_expense($1,$2,$3,$4,$5,$6,null,null,$7) as r', [b, 'rent', 777, 'cash', 'to void', today, key()])))[0].r.expense_id
    await as(owner, () => q('select public.void_expense($1,$2,$3)', [gone, 'Wrong entry', key()]))
    const r = (await as(owner, () => q<{ r: Rep }>('select public.expense_report($1,$2,$3) as r', [b, month, today])))[0].r
    expect(r).toMatchObject({ total: 1500, count: 3 })
    expect(r.by_category).toEqual([{ category: 'rent', total: 1000, count: 1 }, { category: 'fuel_energy', total: 500, count: 2 }])
    expect(r.by_month).toEqual([{ month: today.slice(0, 7), total: 1500 }])
    expect(r.by_method).toEqual([{ method: 'bank_transfer', total: 1100 }, { method: 'cash', total: 400 }])
    expect(r.by_supplier).toEqual([{ supplier: 'Fuel Depot', total: 500 }])
  })
  it('is empty for a period with nothing, refuses a backwards period, and is closed to outsiders', async () => {
    expect(await report('2001-01-01', '2001-12-31')).toMatchObject({ total: 0, count: 0, by_category: [], by_month: [] })
    await expect(report(today, '2001-01-01')).rejects.toThrow(/valid period/)
    await expect(report(month, today, other)).rejects.toThrow(/permission denied/)
    expect((await report(month, today, viewer)).count).toBeGreaterThan(0)
  })
})
