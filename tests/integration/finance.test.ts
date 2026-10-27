import { beforeAll, describe, expect, it } from 'vitest'
import { demoCashbook, demoPayables, demoReceivables, demoRecordExpense, demoReportSummary, demoVoidExpense, getFinance } from '@/demo/demoFinance'
import { ensureDemoInventory, getInv } from '@/demo/demoInventory'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import * as t from '@/demo/demoTrade'
import { withRunningBalance } from '@/modules/finance/financeApi'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

// ------------------------------------------------------------- database
let db: Db
let owner: string, accountant: string, cashier: string, outsider: string
let biz: string, bizB: string, loc: string, product: string, customer: string, supplier: string, sale: string, purchase: string
let n = 0
const key = () => `fin-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const today = new Date().toISOString().slice(0, 10)
const expense = (u: string, b: string, amount: number, over: { cat?: string; date?: string; k?: string; desc?: string } = {}) =>
  as(u, () => q<{ r: { expense_id: string } }>('select public.record_expense($1,$2,$3,$4,$5,$6,null,null,$7) as r', [b, over.cat ?? 'feed', amount, 'cash', over.desc ?? 'Layer mash', over.date ?? today, over.k ?? key()])).then((r) => r[0].r.expense_id)
const summary = (u: string, b = biz) => as(u, () => q<{ r: Record<string, unknown> }>('select public.report_summary($1,$2,$3) as r', [b, today, today])).then((r) => r[0].r)

beforeAll(async () => {
  db = await createDb()
  ;[owner, accountant, cashier, outsider] = await Promise.all(['o', 'a', 'c', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Shop','retail') as id`)))[0].id
  bizB = (await as(outsider, () => q<{ id: string }>(`select public.create_business('Other','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[accountant, 'accountant'], [cashier, 'cashier']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='each'`, [biz]))[0].id
  product = (await as(owner, () => q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price,default_purchase_cost) values ($1,$2,$3,100,40) returning id', [biz, 'Widget', unit])))[0].id
  customer = (await as(owner, () => q<{ id: string }>(`insert into public.customers (business_id,name) values ($1,'Ada') returning id`, [biz])))[0].id
  await as(owner, () => q('select public.set_customer_credit_limit($1,1000)', [customer]))
  supplier = (await as(owner, () => q<{ id: string }>(`insert into public.suppliers (business_id,name) values ($1,'Alpha') returning id`, [biz])))[0].id
  await as(owner, () => q('select public.inventory_receive_stock($1,$2,$3::jsonb,null,$4)', [biz, loc, JSON.stringify([{ product_id: product, quantity: 10, unit_cost: 40 }]), key()]))
  // a credit sale of 500 with 200 paid, and a purchase of 400 with 150 paid
  sale = (await as(owner, () => q<{ r: { sale_id: string } }>('select public.post_sale($1,$2,$3,$4::jsonb,$5::jsonb,$6) as r', [biz, loc, customer, JSON.stringify([{ product_id: product, quantity: 5 }]), JSON.stringify([{ method: 'cash', amount: 200 }]), key()])))[0].r.sale_id
  purchase = (await as(owner, () => q<{ r: { purchase_id: string } }>('select public.create_purchase($1,$2,$3::jsonb,null,$4) as r', [biz, supplier, JSON.stringify([{ product_id: product, quantity: 10, unit_cost: 40 }]), key()])))[0].r.purchase_id
  await as(owner, () => q(`select public.pay_purchase($1,'bank_transfer',150,null,$2)`, [purchase, key()]))
  await expense(owner, biz, 70)
})

describe('record_expense / void_expense (database)', () => {
  it('lets the owner and accountant record; a cashier and an outsider cannot', async () => {
    await expense(accountant, biz, 5, { desc: 'Accountant entry' })
    await expect(expense(cashier, biz, 1)).rejects.toThrow(/permission denied/)
    await expect(expense(outsider, biz, 1)).rejects.toThrow(/permission denied/)
    await expect(expense(owner, bizB, 1)).rejects.toThrow(/permission denied/)
    const id = (await q<{ id: string }>(`select id from public.expenses where description='Accountant entry'`))[0].id
    await as(owner, () => q('select public.void_expense($1,$2,$3)', [id, 'entered by mistake', key()]))
  })

  it('validates amount, date and category, and is idempotent', async () => {
    await expect(expense(owner, biz, 0)).rejects.toThrow(/positive/)
    await expect(expense(owner, biz, 1.234)).rejects.toThrow(/2 decimals/)
    await expect(expense(owner, biz, 5, { date: '2999-01-01' })).rejects.toThrow(/future/)
    await expect(expense(owner, biz, 5, { cat: 'Not Valid!' })).rejects.toThrow(/choose a category/)
    const k = key()
    const a = await expense(owner, biz, 9, { desc: 'Idem expense', k })
    expect(await expense(owner, biz, 9, { desc: 'Idem expense', k })).toBe(a)
    expect(await q(`select 1 from public.expenses where description='Idem expense'`)).toHaveLength(1)
    await as(owner, () => q('select public.void_expense($1,$2,$3)', [a, 'duplicate test row', key()]))
  })

  it('cannot be edited or deleted; a void needs a reason and happens once', async () => {
    const id = await expense(owner, biz, 11, { desc: 'Immutable' })
    await expect(db.query('update public.expenses set amount = 1 where id = $1', [id])).rejects.toThrow(/immutable/)
    await expect(db.query('delete from public.expenses where id = $1', [id])).rejects.toThrow(/cannot be deleted/)
    await expect(as(owner, () => q('select public.void_expense($1,$2,$3)', [id, 'x', key()]))).rejects.toThrow(/reason is required/)
    await as(owner, () => q('select public.void_expense($1,$2,$3)', [id, 'wrong entry', key()]))
    await expect(as(owner, () => q('select public.void_expense($1,$2,$3)', [id, 'wrong entry again', key()]))).rejects.toThrow(/already voided/)
    await expect(db.query(`update public.expenses set status = 'posted' where id = $1`, [id])).rejects.toThrow(/cannot be reopened/)
  })

  it('shows an expense to its own business only', async () => {
    await expense(outsider, bizB, 3, { desc: 'Their cost' })
    expect((await as(owner, () => q<{ description: string }>('select description from public.expenses'))).map((e) => e.description)).not.toContain('Their cost')
    expect((await as(cashier, () => q('select * from public.expenses'))).length).toBe(0)
  })
})

describe('receivables, payables, cashbook and the summary (database)', () => {
  it('lists what is owed each way', async () => {
    const r = await as(owner, () => q<{ sale_id: string; balance_due: string; customer_name: string }>('select * from public.receivables'))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ sale_id: sale, customer_name: 'Ada' })
    expect(Number(r[0].balance_due)).toBe(300)
    const p = await as(owner, () => q<{ purchase_id: string; balance_due: string; supplier_name: string }>('select * from public.payables'))
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ purchase_id: purchase, supplier_name: 'Alpha' })
    expect(Number(p[0].balance_due)).toBe(250)
  })

  it('drops a receivable when it is paid and a payable when it is paid off', async () => {
    await as(owner, () => q(`select public.record_sale_payment($1,'cash',300,'successful',null,$2)`, [sale, key()]))
    expect(await as(owner, () => q('select * from public.receivables'))).toHaveLength(0)
    await as(owner, () => q(`select public.pay_purchase($1,'bank_transfer',250,null,$2)`, [purchase, key()]))
    expect(await as(owner, () => q('select * from public.payables'))).toHaveLength(0)
  })

  it('lists every successful payment and posted expense, and leaves reversed and voided ones out', async () => {
    const entries = await as(owner, () => q<{ kind: string; direction: string; amount: string }>('select kind, direction, amount from public.cashbook order by entry_at, amount'))
    const total = (dir: string) => entries.filter((e) => e.direction === dir).reduce((a, e) => a + Number(e.amount), 0)
    // in: 200 + 300 ; out: purchase 150 + 250, expenses 70 + 11(voided, excluded) + 9(voided) + 5(voided)
    expect(total('in')).toBe(500)
    expect(total('out')).toBe(470)
    expect(entries.filter((e) => e.kind === 'expense').map((e) => Number(e.amount))).toEqual([70])
  })

  it('computes the period summary on the server', async () => {
    const s = await summary(owner)
    expect(Number(s.sales_total)).toBe(500)
    expect(Number(s.purchases_total)).toBe(400)
    expect(Number(s.expenses_total)).toBe(70)
    expect(Number(s.cash_in)).toBe(500)
    expect(Number(s.cash_out)).toBe(470)
    expect(Number(s.operating_surplus)).toBe(30)
    expect(Number(s.receivables_open)).toBe(0)
    expect(Number(s.payables_open)).toBe(0)
    expect(Number(s.stock_value)).toBe(200) // 5 left at average cost 40
    expect(s.expenses_by_category).toEqual({ feed: 70 })
  })

  it('keeps financial figures from roles without the financial-reports permission', async () => {
    await expect(summary(cashier)).rejects.toThrow(/permission denied/)
    await expect(summary(outsider)).rejects.toThrow(/permission denied/)
    expect(await summary(accountant)).toMatchObject({ sales_count: 1 })
    await expect(as(owner, () => q('select public.report_summary($1,$2,$3)', [biz, today, '2000-01-01']))).rejects.toThrow(/valid period/)
  })
})

// ------------------------------------------------------------- demo mirror
const B = 'b-retail'
const dkey = () => `dfin-${n++}-abcdefgh`

describe('demo finance mirrors the database rules', () => {
  let dloc: string, oil: string, ada: string, alpha: string
  beforeAll(() => {
    demoSignIn('owner@demo.test', 'demo1234')
    ensureDemoInventory(B, 'retail'); t.ensureDemoTrade(B)
    dloc = getInv().locations.find((l) => l.businessId === B)!.id
    oil = getInv().products.find((p) => p.businessId === B && p.name.startsWith('Vegetable Oil'))!.id
    ada = t.getTrade().customers.find((c) => c.name === 'Ada Stores')!.id
    alpha = t.getTrade().suppliers.find((s) => s.name === 'Alpha Distributors')!.id
  })

  it('builds receivables, payables, cashbook and the summary from the trade ledgers', () => {
    const sold = t.demoPostSale(B, dloc, ada, [{ productId: oil, quantity: 1 }], [{ method: 'cash', amount: 3000 }], dkey())
    expect(sold.error).toBeNull()
    const po = t.demoCreatePurchase(B, alpha, [{ productId: oil, quantity: 2, unitCost: 100 }], '', dkey())
    expect(po.error).toBeNull()
    expect(t.demoPayPurchase(B, po.result!.purchaseId, 'bank_transfer', 50, '', dkey())).toBeNull()
    expect(demoRecordExpense(B, { category: 'feed', amount: 70, method: 'cash', description: 'Layer mash', date: new Date().toISOString().slice(0, 10), supplierId: null, batchId: null }, dkey()).error).toBeNull()

    expect(demoReceivables(B).map((r) => r.balanceDue)).toEqual([6800])
    expect(demoPayables(B).map((r) => r.balanceDue)).toEqual([150])
    const today = new Date().toISOString().slice(0, 10)
    const s = demoReportSummary(B, today, today)
    expect(s).toMatchObject({ salesCount: 1, salesTotal: 9800, purchasesTotal: 200, expensesTotal: 70, cashIn: 3000, cashOut: 120, operatingSurplus: 2880, receivablesOpen: 6800, payablesOpen: 150 })
    expect(s.expensesByCategory).toEqual({ feed: 70 })
    expect(demoCashbook(B).map((e) => `${e.direction}:${e.amount}`).sort()).toEqual(['in:3000', 'out:50', 'out:70'])
  })

  it('rejects a bad amount, a future date and a bad category; is idempotent; voids with a reason', () => {
    const today = new Date().toISOString().slice(0, 10)
    const v = { category: 'feed' as const, amount: 5, method: 'cash', description: 'Test expense', date: today, supplierId: null, batchId: null }
    expect(demoRecordExpense(B, { ...v, amount: 0 }, dkey()).error).toMatch(/positive/)
    expect(demoRecordExpense(B, { ...v, date: '2999-01-01' }, dkey()).error).toMatch(/future/)
    expect(demoRecordExpense(B, { ...v, category: 'Not Valid!' }, dkey()).error).toMatch(/choose a category/)
    const k = dkey()
    const a = demoRecordExpense(B, v, k); const b = demoRecordExpense(B, v, k)
    expect(b.result).toEqual(a.result)
    expect(getFinance().expenses.filter((e) => e.businessId === B && e.description === 'Test expense')).toHaveLength(1)
    const id = a.result!.expenseId
    expect(demoVoidExpense(B, id, 'x', dkey())).toMatch(/reason is required/)
    expect(demoVoidExpense(B, id, 'entered by mistake', dkey())).toBeNull()
    expect(demoVoidExpense(B, id, 'again please', dkey())).toMatch(/already voided/)
    expect(demoCashbook(B).some((e) => e.sourceId === id)).toBe(false)
  })

  it('refuses roles without the permission', () => {
    demoSignOut(); demoSignIn('cashier@demo.test', 'demo1234')
    const v = { category: 'feed' as const, amount: 5, method: 'cash', description: 'Nope', date: new Date().toISOString().slice(0, 10), supplierId: null, batchId: null }
    expect(demoRecordExpense(B, v, dkey()).error).toMatch(/permission denied/)
    expect(() => demoReportSummary(B, '2026-01-01', '2026-12-31')).toThrow(/permission denied/)
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
  })

  it('computes a running balance per payment method', () => {
    const e = (method: string, direction: 'in' | 'out', amount: number) => ({ at: '2026-01-01', kind: 'x', direction, method, amount, reference: '', sourceId: String(amount) })
    expect(withRunningBalance([e('cash', 'in', 100), e('bank_transfer', 'out', 30), e('cash', 'out', 40.5), e('cash', 'in', 10)]).map((x) => x.balance)).toEqual([100, -30, 59.5, 69.5])
  })
})
