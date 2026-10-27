import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, viewer: string, other: string
let biz: string, bizB: string
let customer: string
let n = 0
const key = () => `cn-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const lines = (...l: [string, number, number][]) => JSON.stringify(l.map(([description, quantity, unit_price]) => ({ description, quantity, unit_price })))
const make = async (total = 10000) => {
  const id = (await as(owner, () => q<{ id: string }>('select public.invoice_save($1,null,$2,null,$3::jsonb,0,0,$4) as id', [biz, customer, lines(['Consulting', 1, total]), ''])))[0].id
  await as(owner, () => q('select public.invoice_send($1)', [id]))
  return id
}
const pay = (id: string, amount: number, u = owner) => as(u, () => q('select public.invoice_record_payment($1,$2,$3,null,null,$4)', [id, amount, 'cash', key()]))
const credit = (id: string, amount: number, reason = 'Goods returned', k = key(), u = owner) =>
  as(u, () => q<{ r: { number: string; status: string } }>('select public.invoice_issue_credit_note($1,$2,$3,$4) as r', [id, amount, reason, k])).then((r) => r[0].r)
const inv = async (id: string) => (await q<{ status: string; credited: string; amount_paid: string; total: string }>('select status, credited, amount_paid, total from public.invoices where id=$1', [id]))[0]

beforeAll(async () => {
  db = await createDb()
  ;[owner, viewer, other] = await Promise.all(['o', 'v', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Consulting Co','general') as id`)))[0].id
  bizB = (await as(other, () => q<{ id: string }>(`select public.create_business('Other Co','general') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  const email = (await q<{ email: string }>('select email from auth.users where id=$1', [viewer]))[0].email
  await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, 'viewer'])); await as(viewer, () => q('select public.accept_my_invitations()'))
  customer = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Acme Ltd') returning id`, [biz])))[0].id
})

describe('credit notes', () => {
  it('lower what is owed without changing the invoice, and are numbered per business', async () => {
    const id = await make()
    const a = await credit(id, 2500)
    expect(a).toMatchObject({ number: 'CN-000001', status: 'sent' })
    expect(await inv(id)).toMatchObject({ status: 'sent', credited: '2500.00', total: '10000.00', amount_paid: '0.00' })
    expect((await credit(id, 500)).number).toBe('CN-000002')
  })

  it('take the balance into account for payments: only what is still owed can be paid', async () => {
    const id = await make()
    await credit(id, 4000)
    await expect(pay(id, 6500)).rejects.toThrow(/more than the balance of 6,000/)
    await pay(id, 2000)
    expect(await inv(id)).toMatchObject({ status: 'partially_paid', credited: '4000.00', amount_paid: '2000.00' })
    await expect(credit(id, 4500)).rejects.toThrow(/more than the balance of 4,000/)
    await pay(id, 4000)
    expect(await inv(id)).toMatchObject({ status: 'paid' })
  })

  it('settle the invoice when credits and payments cover it, and call it Credited when nothing was paid', async () => {
    const full = await make(3000)
    expect(await credit(full, 3000)).toMatchObject({ status: 'credited' })
    const mixed = await make(3000)
    await pay(mixed, 1000)
    expect(await credit(mixed, 2000)).toMatchObject({ status: 'paid' })
  })

  it('cannot be issued on a draft, a settled or a cancelled invoice, without a reason, or for nothing', async () => {
    const draft = (await as(owner, () => q<{ id: string }>('select public.invoice_save($1,null,$2,null,$3::jsonb,0,0,$4) as id', [biz, customer, lines(['x', 1, 100]), ''])))[0].id
    await expect(credit(draft, 10)).rejects.toThrow(/sent invoice/)
    const paid = await make(100); await pay(paid, 100)
    await expect(credit(paid, 10)).rejects.toThrow(/sent invoice/)
    const open = await make(100)
    await expect(credit(open, 10, 'x')).rejects.toThrow(/reason is required/)
    await expect(credit(open, 0)).rejects.toThrow(/amount to credit/)
    const gone = await make(100)
    await as(owner, () => q('select public.invoice_cancel($1,$2)', [gone, 'Entered twice']))
    await expect(credit(gone, 10)).rejects.toThrow(/sent invoice/)
  })

  it('do nothing the second time the same request arrives', async () => {
    const id = await make(1000)
    const k = key()
    const first = await credit(id, 100, 'Once', k)
    expect(await credit(id, 100, 'Once', k)).toEqual(first)
    expect((await inv(id)).credited).toBe('100.00')
  })

  it('stop the invoice being cancelled, and cannot be changed or deleted', async () => {
    const id = await make(1000)
    await credit(id, 100)
    await expect(as(owner, () => q('select public.invoice_cancel($1,$2)', [id, 'Changed my mind']))).rejects.toThrow(/credit notes/)
    await expect(db.exec(`update public.invoice_credit_notes set amount = 1`)).rejects.toThrow(/cannot be changed/)
    await expect(db.exec(`delete from public.invoice_credit_notes`)).rejects.toThrow(/cannot be changed/)
  })

  it('go back to the right status when a payment is reversed', async () => {
    const id = await make(2000)
    await pay(id, 1500)
    await credit(id, 500)
    expect((await inv(id)).status).toBe('paid')
    const pid = (await q<{ id: string }>('select id from public.invoice_payments where invoice_id=$1', [id]))[0].id
    await as(owner, () => q('select public.invoice_reverse_payment($1,$2)', [pid, 'Bounced cheque']))
    expect(await inv(id)).toMatchObject({ status: 'sent', amount_paid: '0.00', credited: '500.00' })
  })
})

describe('what Finance sees', () => {
  it('reads the lower figure in receivables, the invoice summary and the invoiced total', async () => {
    const b = (await as(owner, () => q<{ id: string }>(`select public.create_business('Books Co','general') as id`)))[0].id
    const c = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Zed') returning id`, [b])))[0].id
    const id = (await as(owner, () => q<{ id: string }>('select public.invoice_save($1,null,$2,null,$3::jsonb,0,0,$4) as id', [b, c, lines(['Work', 1, 10000]), ''])))[0].id
    await as(owner, () => q('select public.invoice_send($1)', [id]))
    await as(owner, () => q('select public.invoice_issue_credit_note($1,$2,$3,$4)', [id, 3000, 'Price corrected', key()]))
    await as(owner, () => q('select public.invoice_record_payment($1,$2,$3,null,null,$4)', [id, 2000, 'cash', key()]))
    const rec = (await as(owner, () => q<{ grand_total: string; balance_due: string }>(`select grand_total, balance_due from public.receivables where business_id=$1 and source='invoice'`, [b])))[0]
    expect(rec).toEqual({ grand_total: '7000.00', balance_due: '5000.00' })
    const s = (await as(owner, () => q<{ r: { outstanding: number } }>('select public.invoice_summary($1) as r', [b])))[0].r
    expect(Number(s.outstanding)).toBe(5000)
    const today = new Date().toISOString().slice(0, 10)
    const rep = (await as(owner, () => q<{ r: { invoiced_total: number; receivables_open: number } }>('select public.report_summary($1,$2,$3) as r', [b, today, today])))[0].r
    expect(Number(rep.invoiced_total)).toBe(7000); expect(Number(rep.receivables_open)).toBe(5000)
  })
})

describe('who may issue and read credit notes', () => {
  it('needs the manage permission to issue; a viewer can read them; another business cannot', async () => {
    const id = await make(500)
    await expect(credit(id, 50, 'Nope', key(), viewer)).rejects.toThrow()
    await credit(id, 50)
    expect((await as(viewer, () => q('select id from public.invoice_credit_notes where invoice_id=$1', [id]))).length).toBe(1)
    expect((await as(other, () => q('select id from public.invoice_credit_notes where business_id=$1', [biz]))).length).toBe(0)
    await expect(credit(id, 50, 'Cross', key(), other)).rejects.toThrow()
    void bizB
  })
})
