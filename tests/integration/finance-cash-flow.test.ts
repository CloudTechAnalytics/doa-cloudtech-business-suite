import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, viewer: string, other: string
let biz: string, customer: string
let n = 0
const key = () => `cf-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
const ahead = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const lines = (total: number) => JSON.stringify([{ description: 'Work', quantity: 1, unit_price: total }])
const spend = (category: string, amount: number, date: string, method = 'cash') => as(owner, () => q('select public.record_expense($1,$2,$3,$4,$5,$6,null,null,$7)', [biz, category, amount, method, `Spend ${category}`, date, key()]))
const invoice = async (total: number, due: string | null) => {
  const id = (await as(owner, () => q<{ id: string }>('select public.invoice_save($1,null,$2,$3,$4::jsonb,0,0,$5) as id', [biz, customer, due, lines(total), ''])))[0].id
  await as(owner, () => q('select public.invoice_send($1)', [id])); return id
}
const received = (id: string, amount: number, date: string, method = 'bank_transfer') => as(owner, () => q('select public.invoice_record_payment($1,$2,$3,$4,null,$5)', [id, amount, method, date, key()]))
type Flow = { opening: number; in_total: number; out_total: number; closing: number; by_month: { month: string; in: number; out: number }[]; in_by_kind: { kind: string; total: number }[]; out_by_kind: { kind: string; category: string | null; total: number }[]; by_method: { method: string; balance: number }[]; expected: { overdue: number; due_30: number; no_date: number } }
const flow = (from: string, to: string, u = owner, b = biz) => as(u, () => q<{ r: Flow }>('select public.finance_cash_flow($1,$2,$3) as r', [b, from, to])).then((r) => r[0].r)

beforeAll(async () => {
  db = await createDb()
  ;[owner, viewer, other] = await Promise.all(['o', 'v', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Consulting Co','general') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  const email = (await q<{ email: string }>('select email from auth.users where id=$1', [viewer]))[0].email
  await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, 'viewer'])); await as(viewer, () => q('select public.accept_my_invitations()'))
  customer = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Acme Ltd') returning id`, [biz])))[0].id
  // before the period: 5000 in, 1200 out. In the period (last 20 days): 3000 + 2000 in, 700 + 300 out.
  const early = await invoice(5000, null); await received(early, 5000, ago(45)); await spend('rent', 1200, ago(44), 'bank_transfer')
  const a = await invoice(3000, ahead(10)); await received(a, 3000, ago(10), 'bank_transfer')
  const b = await invoice(4000, ahead(5)); await q('update public.invoices set issued_on = $2, due_on = $3 where id = $1', [b, ago(30), ago(5)]); await received(b, 2000, ago(3), 'cash') // 2000 still owed and overdue
  await spend('marketing', 700, ago(8), 'bank_transfer'); await spend('transport', 300, ago(2), 'cash')
  await invoice(1500, ahead(20)) // sent, nothing paid: expected within 30 days
  await invoice(900, null) // sent, no due date
})

describe('the cash flow report', () => {
  it('reconciles: opening plus money in less money out is the closing balance', async () => {
    const r = await flow(ago(20), ago(0))
    expect(r).toMatchObject({ opening: 3800, in_total: 5000, out_total: 1000, closing: 7800 })
    expect(Number(r.opening) + Number(r.in_total) - Number(r.out_total)).toBe(Number(r.closing))
  })
  it('splits money in and out by where it came from and went, with each expense category named', async () => {
    const r = await flow(ago(20), ago(0))
    expect(r.in_by_kind).toEqual([{ kind: 'invoice_receipt', total: 5000 }])
    expect(r.out_by_kind.map((k) => [k.kind, k.category, Number(k.total)])).toEqual([['expense', 'marketing', 700], ['expense', 'transport', 300]])
  })
  it('shows each month of the period, and the balance in each way of paying to the end of it', async () => {
    const r = await flow(ago(20), ago(0))
    expect(r.by_month.reduce((a, m) => a + Number(m.in), 0)).toBe(5000); expect(r.by_month.reduce((a, m) => a + Number(m.out), 0)).toBe(1000)
    const bal = Object.fromEntries(r.by_method.map((m) => [m.method, Number(m.balance)]))
    expect(bal).toEqual({ bank_transfer: 5000 + 3000 - 1200 - 700, cash: 2000 - 300 })
  })
  it('does not count anything after the period, and a period before anything happened is all zeros', async () => {
    const r = await flow(ago(20), ago(5))
    expect(r).toMatchObject({ in_total: 3000, out_total: 700, closing: 3800 + 3000 - 700 })
    expect(await flow('2001-01-01', '2001-01-31')).toMatchObject({ opening: 0, in_total: 0, out_total: 0, closing: 0, by_month: [], in_by_kind: [], out_by_kind: [], by_method: [] })
  })
  it('leaves out reversed payments and voided expenses', async () => {
    const id = await invoice(800, null); await received(id, 800, ago(1))
    const pid = (await q<{ id: string }>('select id from public.invoice_payments where invoice_id=$1', [id]))[0].id
    await as(owner, () => q('select public.invoice_reverse_payment($1,$2)', [pid, 'Bounced']))
    const x = (await as(owner, () => q<{ r: { expense_id: string } }>('select public.record_expense($1,$2,$3,$4,$5,$6,null,null,$7) as r', [biz, 'meals', 400, 'cash', 'Lunch', ago(1), key()])))[0].r.expense_id
    await as(owner, () => q('select public.void_expense($1,$2,$3)', [x, 'Entered twice', key()]))
    expect(await flow(ago(20), ago(0))).toMatchObject({ in_total: 5000, out_total: 1000 })
  })
  it('says what is expected from invoices: overdue, due in 30 days, and with no due date, after payments', async () => {
    const r = await flow(ago(20), ago(0))
    expect(r.expected.overdue).toBe(2000); expect(r.expected.due_30).toBe(1500); expect(r.expected.no_date).toBe(900 + 800) // the reversed 800 is owed again
  })
  it('refuses a backwards period, and people who cannot read finance or belong elsewhere', async () => {
    await expect(flow(ago(0), ago(20))).rejects.toThrow(/valid period/)
    await expect(flow(ago(20), ago(0), other)).rejects.toThrow(/permission denied/)
    const b2 = (await as(other, () => q<{ id: string }>(`select public.create_business('Other Co','general') as id`)))[0].id
    await expect(flow(ago(20), ago(0), owner, b2)).rejects.toThrow(/permission denied/)
    void viewer
  })
})
