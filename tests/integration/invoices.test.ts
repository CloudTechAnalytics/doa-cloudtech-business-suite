import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, accountant: string, cashier: string, viewer: string, other: string
let biz: string, bizB: string, retail: string, school: string
let customer: string, otherCustomer: string
let n = 0
const key = () => `inv-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const J = (v: unknown) => JSON.stringify(v)
const lines = (...l: [string, number, number][]) => J(l.map(([description, quantity, unit_price]) => ({ description, quantity, unit_price })))
const save = (u: string, b: string, o: { id?: string | null; customer?: string | null; due?: string | null; lines?: string; discount?: number; tax?: number } = {}) =>
  as(u, () => q<{ id: string }>('select public.invoice_save($1,$2,$3,$4,$5::jsonb,$6,$7,$8) as id', [b, o.id ?? null, o.customer === undefined ? customer : o.customer, o.due ?? null, o.lines ?? lines(['Consulting', 2, 5000]), o.discount ?? 0, o.tax ?? 0, ''])).then((r) => r[0].id)
const send = (u: string, id: string) => as(u, () => q('select public.invoice_send($1)', [id]))
const pay = (u: string, id: string, amount: number, k = key(), method = 'bank_transfer', paidOn: string | null = null) =>
  as(u, () => q<{ r: { payment_id: string; status: string; amount_paid: number } }>('select public.invoice_record_payment($1,$2,$3,$4,null,$5) as r', [id, amount, method, paidOn, k])).then((r) => r[0].r)
const inv = async (id: string) => (await q<{ status: string; amount_paid: string; total: string; subtotal: string; tax_amount: string; number: string }>('select status, amount_paid, total, subtotal, tax_amount, number from public.invoices where id=$1', [id]))[0]
const sent = async (o: Parameters<typeof save>[2] = {}) => { const id = await save(owner, biz, o); await send(owner, id); return id }

beforeAll(async () => {
  db = await createDb()
  ;[owner, accountant, cashier, viewer, other] = await Promise.all(['o', 'a', 'c', 'v', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Consulting Co','general') as id`)))[0].id
  bizB = (await as(other, () => q<{ id: string }>(`select public.create_business('Other Co','general') as id`)))[0].id
  retail = (await as(owner, () => q<{ id: string }>(`select public.create_business('Corner Shop','retail') as id`)))[0].id
  school = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[accountant, 'accountant'], [cashier, 'cashier'], [viewer, 'viewer']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  customer = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Acme Ltd') returning id`, [biz])))[0].id
  otherCustomer = (await as(other, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Their customer') returning id`, [bizB])))[0].id
})

describe('who has the Invoices app', () => {
  it('is on for Business apps, and a shop or farm can switch it on; a school cannot', async () => {
    const mods = async (b: string) => (await as(owner, () => q<{ module_code: string; enabled: boolean }>('select module_code, enabled from public.my_modules($1)', [b])))
    expect((await mods(biz)).find((m) => m.module_code === 'invoices')).toMatchObject({ enabled: true })
    expect((await mods(retail)).find((m) => m.module_code === 'invoices')).toMatchObject({ enabled: false })
    expect((await mods(school)).find((m) => m.module_code === 'invoices')).toBeUndefined()
    await as(owner, () => q('select public.enable_module($1,$2)', [retail, 'invoices']))
    expect((await mods(retail)).find((m) => m.module_code === 'invoices')).toMatchObject({ enabled: true })
    await expect(as(owner, () => q('select public.enable_module($1,$2)', [school, 'invoices']))).rejects.toThrow(/not compatible/)
  })

  it('is part of the free Starter plan along with Expenses, Reports and the supplier list (purchase orders are not)', async () => {
    const r = await q<{ code: string; included: boolean }>(`select m.code, pm.included from public.plan_modules pm join public.modules m on m.id = pm.module_id join public.subscription_plans p on p.id = pm.plan_id where p.code = 'starter' and m.code in ('invoices','expenses','reports','purchases','suppliers')`)
    expect(Object.fromEntries(r.map((x) => [x.code, x.included]))).toEqual({ invoices: true, expenses: true, reports: true, purchases: false, suppliers: true })
  })
})

describe('invoices', () => {
  it('are numbered per business, and the database works out the totals', async () => {
    const a = await save(owner, biz, { lines: lines(['Design', 2, 1500.5], ['Hosting', 1, 999.99]), discount: 100, tax: 7.5 })
    expect(await inv(a)).toMatchObject({ number: 'INV-000001', status: 'draft', subtotal: '4000.99', tax_amount: '292.57', total: '4193.56' })
    const b = await save(owner, biz)
    expect((await inv(b)).number).toBe('INV-000002')
    const c = (await as(other, () => q<{ id: string }>('select public.invoice_save($1,null,$2,null,$3::jsonb,0,0,$4) as id', [bizB, otherCustomer, lines(['X', 1, 1]), ''])))[0].id
    expect((await inv(c)).number).toBe('INV-000001')
  })

  it('check the customer, the lines, the discount, the tax and the due date', async () => {
    await expect(save(owner, biz, { customer: null })).rejects.toThrow(/choose the customer/)
    await expect(save(owner, biz, { customer: otherCustomer })).rejects.toThrow(/choose the customer/)
    await expect(save(owner, biz, { lines: '[]' })).rejects.toThrow(/at least one line/)
    await expect(save(owner, biz, { lines: lines(['', 1, 5]) })).rejects.toThrow(/needs a description/)
    await expect(save(owner, biz, { lines: lines(['A', 0, 5]) })).rejects.toThrow(/quantity above zero/)
    await expect(save(owner, biz, { lines: lines(['A', 1, -1]) })).rejects.toThrow(/price of zero or more/)
    await expect(save(owner, biz, { lines: J([{ description: 'A', quantity: 'x', unit_price: 1 }]) })).rejects.toThrow(/must be numbers/)
    await expect(save(owner, biz, { discount: 99999 })).rejects.toThrow(/discount cannot be more/)
    await expect(save(owner, biz, { tax: 101 })).rejects.toThrow(/tax rate/)
    await expect(save(owner, biz, { due: '2000-01-01' })).rejects.toThrow(/due date cannot be before/)
  })

  it('can be edited only as a draft; sending locks them', async () => {
    const id = await save(owner, biz)
    await save(owner, biz, { id, lines: lines(['Changed', 3, 100]) })
    expect((await inv(id)).total).toBe('300.00')
    await send(owner, id)
    expect((await inv(id)).status).toBe('sent')
    await expect(save(owner, biz, { id })).rejects.toThrow(/can no longer be changed/)
    await expect(send(owner, id)).rejects.toThrow(/only a draft/)
  })

  it('are only for people who manage invoices, and only for their own business', async () => {
    const id = await save(owner, biz)
    await expect(save(cashier, biz)).rejects.toThrow(/permission denied/)
    await expect(save(viewer, biz)).rejects.toThrow(/permission denied/)
    await expect(save(other, biz)).rejects.toThrow(/permission denied/)
    await expect(send(viewer, id)).rejects.toThrow(/permission denied/)
    expect((await as(viewer, () => q('select id from public.invoices where id=$1', [id]))).length).toBe(1)
    expect((await as(cashier, () => q('select id from public.invoices where id=$1', [id]))).length).toBe(0) // the cashier has neither invoice nor finance access
    expect((await as(other, () => q('select id from public.invoices where id=$1', [id]))).length).toBe(0)
    await expect(as(owner, () => q('update public.invoices set total = 1 where id=$1', [id]))).rejects.toThrow()
    await expect(as(owner, () => q('insert into public.invoices (business_id, number, customer_id, lines) values ($1,$2,$3,$4)', [biz, 'INV-X', customer, '[]']))).rejects.toThrow()
    await expect(as(owner, () => q('delete from public.invoices where id=$1', [id]))).rejects.toThrow()
  })
})

describe('invoice payments', () => {
  it('move an invoice from sent to part paid to paid, and cannot go over the balance', async () => {
    const id = await sent({ lines: lines(['Work', 1, 1000]) })
    const p1 = await pay(owner, id, 400)
    expect(p1.status).toBe('partially_paid')
    expect(await inv(id)).toMatchObject({ status: 'partially_paid', amount_paid: '400.00' })
    await expect(pay(owner, id, 700)).rejects.toThrow(/more than the balance/)
    await pay(accountant, id, 600)
    expect(await inv(id)).toMatchObject({ status: 'paid', amount_paid: '1000.00' })
    await expect(pay(owner, id, 1)).rejects.toThrow(/sent invoice that is not fully paid/)
  })

  it('are booked once, however many times the same request arrives', async () => {
    const id = await sent({ lines: lines(['Work', 1, 1000]) })
    const k = key()
    const a = await pay(owner, id, 300, k); const b = await pay(owner, id, 300, k)
    expect(b.payment_id).toBe(a.payment_id)
    expect((await q('select id from public.invoice_payments where invoice_id=$1', [id])).length).toBe(1)
    expect((await inv(id)).amount_paid).toBe('300.00')
    await expect(as(owner, () => q('select public.invoice_record_payment($1,$2,$3,null,null,$4)', [id, 1, 'cash', k]))).resolves.toBeDefined() // same key, same operation: still returns the stored result
  })

  it('check the amount, the method, the date and the invoice state', async () => {
    const id = await sent()
    await expect(pay(owner, id, 0)).rejects.toThrow(/enter the amount/)
    await expect(pay(owner, id, 10, key(), 'bitcoin')).rejects.toThrow(/choose how it was paid/)
    await expect(pay(owner, id, 10, key(), 'cash', '2999-01-01')).rejects.toThrow(/cannot be in the future/)
    await expect(pay(owner, id, 10, 'short')).rejects.toThrow(/idempotency key/)
    const draft = await save(owner, biz)
    await expect(pay(owner, draft, 10)).rejects.toThrow(/sent invoice/)
    await expect(pay(cashier, id, 10)).rejects.toThrow(/permission denied/)
    await expect(pay(viewer, id, 10)).rejects.toThrow(/permission denied/)
  })

  it('are reversed, not edited or deleted, and the invoice goes back', async () => {
    const id = await sent({ lines: lines(['Work', 1, 1000]) })
    const p = await pay(owner, id, 1000)
    expect((await inv(id)).status).toBe('paid')
    await expect(as(owner, () => q('select public.invoice_reverse_payment($1,$2)', [p.payment_id, ' ']))).rejects.toThrow(/reason is required/)
    await as(owner, () => q('select public.invoice_reverse_payment($1,$2)', [p.payment_id, 'Cheque bounced']))
    expect(await inv(id)).toMatchObject({ status: 'sent', amount_paid: '0.00' })
    await expect(as(owner, () => q('select public.invoice_reverse_payment($1,$2)', [p.payment_id, 'again']))).rejects.toThrow(/already reversed/)
    await expect(as(owner, () => q('update public.invoice_payments set amount = 1 where id=$1', [p.payment_id]))).rejects.toThrow()
    await expect(as(owner, () => q('delete from public.invoice_payments where id=$1', [p.payment_id]))).rejects.toThrow()
    await expect(as(owner, () => q(`update public.invoice_payments set status='successful' where id=$1`, [p.payment_id]))).rejects.toThrow()
  })

  it('stop an invoice being cancelled until its payments are reversed', async () => {
    const id = await sent({ lines: lines(['Work', 1, 1000]) })
    const p = await pay(owner, id, 100)
    await expect(as(owner, () => q('select public.invoice_cancel($1,$2)', [id, 'Customer left']))).rejects.toThrow(/reverse the payments/)
    await as(owner, () => q('select public.invoice_reverse_payment($1,$2)', [p.payment_id, 'Wrong invoice']))
    await expect(as(owner, () => q('select public.invoice_cancel($1,$2)', [id, '']))).rejects.toThrow(/reason is required/)
    await as(owner, () => q('select public.invoice_cancel($1,$2)', [id, 'Customer left']))
    expect((await inv(id)).status).toBe('cancelled')
    await expect(pay(owner, id, 10)).rejects.toThrow(/sent invoice/)
  })
})

describe('Invoices on its own (no CRM app)', () => {
  it('lists and adds customers without the CRM, reuses a match, and keeps other businesses out', async () => {
    const b = (await as(owner, () => q<{ id: string }>(`select public.create_business('Solo Co','general') as id`)))[0].id
    await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
    await as(owner, () => q('select public.disable_module($1,$2)', [b, 'customers']))
    expect((await as(owner, () => q<{ module_code: string; enabled: boolean }>('select module_code, enabled from public.my_modules($1)', [b]))).find((m) => m.module_code === 'customers')).toMatchObject({ enabled: false })
    const add = (u: string, name: string, phone: string | null, email: string | null) => as(u, () => q<{ id: string }>('select public.invoice_add_customer($1,$2,$3,$4) as id', [b, name, phone, email])).then((r) => r[0].id)
    const zed = await add(owner, 'Zed Ltd', '0803', 'zed@example.com')
    expect(await add(owner, 'Zed again', null, 'ZED@example.com')).toBe(zed)
    expect(await add(owner, 'Zed by phone', '0803', null)).toBe(zed)
    expect((await as(owner, () => q<{ name: string }>('select name from public.customers where business_id=$1', [b]))).map((c) => c.name)).toEqual(['Zed Ltd'])
    await expect(add(owner, ' ', null, null)).rejects.toThrow(/enter the customer name/)
    await expect(add(other, 'Intruder', null, null)).rejects.toThrow(/permission denied/)
    const id = (await as(owner, () => q<{ id: string }>('select public.invoice_save($1,null,$2,null,$3::jsonb,0,0,$4) as id', [b, zed, lines(['Job', 1, 100]), ''])))[0].id
    expect(await inv(id)).toMatchObject({ status: 'draft', total: '100.00' })
    expect((await as(other, () => q('select id from public.customers where business_id=$1', [b]))).length).toBe(0)
    await expect(add(cashier, 'Nobody', null, null)).rejects.toThrow(/permission denied/)
  })
})

describe('quotes become invoices', () => {
  const accepted = async (o: { customer?: string | null; lead?: string | null } = {}) => {
    const id = (await as(owner, () => q<{ id: string }>('select public.crm_save_quote($1,null,null,$2,$3,null,$4::jsonb,50,$5) as id', [biz, o.customer === undefined ? customer : o.customer, o.lead ?? null, lines(['Service', 2, 500]), 'Thanks'])))[0].id
    await as(owner, () => q('select public.crm_set_quote_status($1,$2)', [id, 'sent'])); await as(owner, () => q('select public.crm_set_quote_status($1,$2)', [id, 'accepted']))
    return id
  }
  const fromQuote = (u: string, id: string) => as(u, () => q<{ id: string }>('select public.invoice_from_quote($1) as id', [id])).then((r) => r[0].id)

  it('once, as a draft carrying the lines, discount and notes', async () => {
    const qid = await accepted()
    const id = await fromQuote(owner, qid)
    expect(await inv(id)).toMatchObject({ status: 'draft', subtotal: '1000.00', total: '950.00' })
    expect((await q<{ quote_id: string; notes: string; customer_id: string }>('select quote_id, notes, customer_id from public.invoices where id=$1', [id]))[0]).toEqual({ quote_id: qid, notes: 'Thanks', customer_id: customer })
    await expect(fromQuote(owner, qid)).rejects.toThrow(/already been invoiced/)
  })

  it('only when accepted, only for a customer, and only by people who manage invoices', async () => {
    const draft = (await as(owner, () => q<{ id: string }>('select public.crm_save_quote($1,null,null,$2,null,null,$3::jsonb,0,$4) as id', [biz, customer, lines(['A', 1, 1]), ''])))[0].id
    await expect(fromQuote(owner, draft)).rejects.toThrow(/only an accepted quote/)
    const lead = (await as(owner, () => q<{ id: string }>(`insert into public.crm_leads (business_id,name) values ($1,'Prospect') returning id`, [biz])))[0].id
    const forLead = await accepted({ customer: null, lead })
    await expect(fromQuote(owner, forLead)).rejects.toThrow(/convert the lead/)
    const ok = await accepted()
    await expect(fromQuote(cashier, ok)).rejects.toThrow(/permission denied/)
    await expect(fromQuote(other, ok)).rejects.toThrow(/permission denied/)
  })
})

describe('Finance sees invoices without a second entry', () => {
  it('counts an invoice payment once in the cashbook, the receivables and the summary, and removes it when reversed', async () => {
    const b = (await as(owner, () => q<{ id: string }>(`select public.create_business('Finance Co','general') as id`)))[0].id
    await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
    const c = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Payer') returning id`, [b])))[0].id
    const mk = async (price: number) => { const id = (await as(owner, () => q<{ id: string }>('select public.invoice_save($1,null,$2,null,$3::jsonb,0,0,$4) as id', [b, c, lines(['Job', 1, price]), ''])))[0].id; await send(owner, id); return id }
    const a = await mk(1000); await mk(500)
    const p = await pay(owner, a, 400)
    const summary = async () => (await as(owner, () => q<{ r: { cash_in: number; receivables_open: number; invoiced_total: number; operating_surplus: number } }>(`select public.report_summary($1, current_date - 1, current_date + 1) as r`, [b])))[0].r
    const s = await summary()
    expect(Number(s.cash_in)).toBe(400); expect(Number(s.receivables_open)).toBe(1100); expect(Number(s.invoiced_total)).toBe(1500)
    const cash = await as(owner, () => q<{ kind: string; direction: string; amount: string; reference: string }>(`select kind, direction, amount, reference from public.cashbook where business_id=$1`, [b]))
    expect(cash).toEqual([{ kind: 'invoice_receipt', direction: 'in', amount: '400.00', reference: 'INV-000001' }])
    const owed = await as(owner, () => q<{ source: string; balance_due: string }>(`select source, balance_due from public.receivables where business_id=$1 order by balance_due`, [b]))
    expect(owed).toEqual([{ source: 'invoice', balance_due: '500.00' }, { source: 'invoice', balance_due: '600.00' }])
    // a finance reader without invoice access still sees the same figures (the accountant has both; the cashier neither)
    await as(owner, () => q('select public.invoice_reverse_payment($1,$2)', [p.payment_id, 'Entered twice']))
    const after = await summary()
    expect(Number(after.cash_in)).toBe(0); expect(Number(after.receivables_open)).toBe(1500)
  })

  it('leaves sales and expenses exactly as they were', async () => {
    const b = (await as(owner, () => q<{ id: string }>(`select public.create_business('Books Co','general') as id`)))[0].id
    await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
    await as(owner, () => q(`select public.record_expense($1,'rent',700,'cash','Office rent',current_date,null,null,$2)`, [b, key()]))
    const s = (await as(owner, () => q<{ r: { cash_out: number; expenses_total: number; invoiced_total: number } }>(`select public.report_summary($1, current_date - 1, current_date + 1) as r`, [b])))[0].r
    expect(Number(s.cash_out)).toBe(700); expect(Number(s.expenses_total)).toBe(700); expect(Number(s.invoiced_total)).toBe(0)
  })
})

describe('the invoice summary', () => {
  it('adds up what is outstanding, overdue and received this month', async () => {
    const b = (await as(owner, () => q<{ id: string }>(`select public.create_business('Summary Co','general') as id`)))[0].id
    await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
    const c = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'S') returning id`, [b])))[0].id
    const mk = async (price: number, due: string | null) => { const id = (await as(owner, () => q<{ id: string }>('select public.invoice_save($1,null,$2,$3,$4::jsonb,0,0,$5) as id', [b, c, due, lines(['Job', 1, price]), ''])))[0].id; await send(owner, id); return id }
    const a = await mk(1000, null); await mk(300, null)
    await db.exec(`update public.invoices set due_on = current_date - 5, issued_on = current_date - 10 where business_id = '${b}' and total = 300`) // as the test clock cannot wait, move one into the past
    await pay(owner, a, 250)
    const r = (await as(owner, () => q<{ r: { outstanding: number; overdue: number; overdue_count: number; paid_this_month: number; by_status: Record<string, number> } }>('select public.invoice_summary($1) as r', [b])))[0].r
    expect(Number(r.outstanding)).toBe(1050); expect(Number(r.overdue)).toBe(300); expect(Number(r.overdue_count)).toBe(1); expect(Number(r.paid_this_month)).toBe(250)
    expect(r.by_status).toEqual({ sent: 1, partially_paid: 1 })
    await expect(as(other, () => q('select public.invoice_summary($1)', [b]))).rejects.toThrow(/permission denied/)
  })
})
