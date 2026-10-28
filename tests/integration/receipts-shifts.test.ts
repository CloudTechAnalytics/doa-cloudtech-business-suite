import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, manager: string, cashier: string, cashier2: string, outsider: string
let biz: string, loc: string, cola: string
let n = 0
const key = () => `rs-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = JSON.stringify
const sell = (u: string, qty: number, method = 'cash') => as(u, () => q<{ r: { sale_id: string } }>('select public.mart_post_sale($1,$2,null,$3::jsonb,$4::jsonb,$5) as r', [biz, loc, J([{ product_id: cola, quantity: qty }]), J([{ method, amount: qty * 300 }]), key()])).then((r) => r[0].r.sale_id)
const receipt = async (u: string, sale: string) => (await as(u, () => q<{ r: Record<string, any> }>('select public.sale_receipt($1) as r', [sale])))[0].r
const tender = (u: string, sale: string, amount: number) => as(u, () => q<{ r: { tendered: number; change: number } }>('select public.record_sale_tender($1,$2) as r', [sale, amount])).then((r) => r[0].r)
const openShift = (u: string, cash: number) => as(u, () => q<{ r: { shift_id: string } }>('select public.mart_open_shift($1,$2,$3) as r', [biz, cash, key()])).then((r) => r[0].r.shift_id)
const move = (u: string, shift: string, dir: 'in' | 'out', amount: number) => as(u, () => q('select public.mart_cash_movement($1,$2,$3,$4,$5)', [shift, dir, amount, 'Test move', key()]))
const closeShift = (u: string, shift: string, counted: number) => as(u, () => q('select public.mart_close_shift($1,$2,$3,$4)', [shift, counted, 'x', key()]))
const expected = async (shift: string) => Number((await q<{ e: string }>('select expected_cash as e from public.shift_summary where id=$1', [shift]))[0].e)
const delShift = (u: string, shift: string, reason = 'Opened by mistake') => as(u, () => q('select public.mart_delete_shift($1,$2)', [shift, reason]))

beforeAll(async () => {
  db = await createDb()
  ;[owner, manager, cashier, cashier2, outsider] = await Promise.all(['o', 'm', 'c', 'c2', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Test Mart','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[manager, 'manager'], [cashier, 'cashier'], [cashier2, 'cashier']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role])); await as(u, () => q('select public.accept_my_invitations()'))
  }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='each'`, [biz]))[0].id
  cola = (await q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price) values ($1,$2,$3,300) returning id', [biz, 'Cola', unit]))[0].id
  await as(owner, () => q('select public.mart_receive_stock($1,$2,$3::jsonb,$4,$5)', [biz, loc, J([{ product_id: cola, quantity: 500, unit_cost: 200 }]), 'Opening', key()]))
})

describe('what is printed on a receipt', () => {
  it('lets the owner set the address, phone and closing line, and nobody without settings access', async () => {
    await as(owner, () => q('select public.set_business_receipt($1,$2,$3,$4)', [biz, '12 Market Road, Ikeja', '0803 111 2222', 'Goods sold are not returnable.']))
    await expect(as(manager, () => q('select public.set_business_receipt($1,$2,$3,$4)', [biz, 'x', 'y', 'z']))).rejects.toThrow(/permission denied/)
    await expect(as(cashier, () => q('select public.set_business_receipt($1,$2,$3,$4)', [biz, 'x', 'y', 'z']))).rejects.toThrow(/permission denied/)
    await expect(as(outsider, () => q('select public.set_business_receipt($1,$2,$3,$4)', [biz, 'x', 'y', 'z']))).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => q('select public.set_business_receipt($1,$2,$3,$4)', [biz, 'x'.repeat(201), '', '']))).rejects.toThrow(/up to 200 characters/)
  })
  it('shows the shop details, who sold it and when, on the receipt a cashier prints', async () => {
    const r = await receipt(cashier, await sell(cashier, 2))
    expect(r.business).toMatchObject({ name: 'Test Mart', address: '12 Market Road, Ikeja', phone: '0803 111 2222', footer: 'Goods sold are not returnable.' })
    expect(typeof r.cashier).toBe('string'); expect(r.tender).toBeNull()
  })
  it('leaves the details off when none were set, and clears them when emptied', async () => {
    await as(owner, () => q('select public.set_business_receipt($1,$2,$3,$4)', [biz, '', '', '']))
    const r = await receipt(cashier, await sell(cashier, 1))
    expect(r.business.address).toBeNull(); expect(r.business.footer).toBeNull()
    await as(owner, () => q('select public.set_business_receipt($1,$2,$3,$4)', [biz, '12 Market Road, Ikeja', '0803 111 2222', 'Thank you']))
  })
})

describe('cash given and change', () => {
  it('records what the customer handed over, works out the change, and prints both', async () => {
    const sale = await sell(cashier, 3) // 900 in cash
    expect(await tender(cashier, sale, 1000)).toEqual({ tendered: 1000, change: 100 })
    const r = await receipt(cashier, sale)
    expect(r.tender).toEqual({ tendered: 1000, change: 100 })
  })
  it('refuses cash given below what was paid, a second record, a sale not paid in cash, and someone else\'s sale', async () => {
    const sale = await sell(cashier, 2)
    await expect(tender(cashier, sale, 500)).rejects.toThrow(/less than the cash paid/)
    await expect(tender(cashier2, sale, 700)).rejects.toThrow(/permission denied/)
    await tender(cashier, sale, 600)
    await expect(tender(cashier, sale, 700)).rejects.toThrow(/already recorded/)
    await expect(tender(cashier, await sell(cashier, 1, 'card'), 500)).rejects.toThrow(/not paid in cash/)
    await expect(tender(outsider, sale, 700)).rejects.toThrow(/permission denied/)
  })
  it('lets a manager record it for a cashier, and never counts change as cash taken in the drawer', async () => {
    const s = await openShift(cashier, 1000); const before = await expected(s)
    const sale = await sell(cashier, 1)
    await tender(manager, sale, 1000)
    expect(await expected(s)).toBe(before + 300)
    await closeShift(cashier, s, before + 300)
  })
})

describe('cash in and cash out of the drawer', () => {
  it('lets cash out be at most what is in the drawer, and says how much there is', async () => {
    const s = await openShift(cashier2, 1000)
    await expect(move(cashier2, s, 'out', 1500)).rejects.toThrow(/only ₦1,000.00 in the drawer, so ₦1,500.00 cannot be taken out/)
    await move(cashier2, s, 'out', 400); expect(await expected(s)).toBe(600)
    await expect(move(cashier2, s, 'out', 700)).rejects.toThrow(/only ₦600.00 in the drawer/)
    await move(cashier2, s, 'in', 500); await move(cashier2, s, 'out', 700); expect(await expected(s)).toBe(400)
    await closeShift(cashier2, s, 400)
  })
  it('counts cash sales into what can be taken out', async () => {
    const s = await openShift(cashier2, 0)
    await expect(move(cashier2, s, 'out', 100)).rejects.toThrow(/only ₦0.00 in the drawer/)
    await sell(cashier2, 2); await move(cashier2, s, 'out', 600); expect(await expected(s)).toBe(0)
    await closeShift(cashier2, s, 0)
  })
})

describe('deleting a shift', () => {
  it('lets a manager delete a shift opened by mistake, with a reason kept in the audit trail', async () => {
    const s = await openShift(cashier, 500)
    await expect(delShift(cashier, s)).rejects.toThrow(/permission denied/); await expect(delShift(manager, s, 'x')).rejects.toThrow(/reason is required/)
    await delShift(manager, s)
    expect(await q('select 1 from public.cashier_shifts where id=$1', [s])).toHaveLength(0)
    const log = await q<{ metadata: { reason: string } }>(`select metadata from public.audit_logs where business_id=$1 and action='cashier_shifts.delete'`, [biz])
    expect(log.map((l) => l.metadata.reason)).toContain('Opened by mistake')
  })
  it('refuses a shift with any sale or cash in and out: it is a money record, closed and reviewed instead', async () => {
    const a = await openShift(cashier, 100); await sell(cashier, 1)
    await expect(delShift(manager, a)).rejects.toThrow(/money record/)
    await closeShift(cashier, a, 400)
    const b = await openShift(cashier2, 100); await move(cashier2, b, 'in', 50)
    await expect(delShift(manager, b)).rejects.toThrow(/money record/)
    await closeShift(cashier2, b, 150)
    await expect(delShift(outsider, b)).rejects.toThrow(/permission denied/)
  })
  it('refuses a shift where only card payments were taken, since there are still sales in it', async () => {
    const s = await openShift(cashier, 100); await sell(cashier, 1, 'card')
    await expect(delShift(manager, s)).rejects.toThrow(/money record/)
    await closeShift(cashier, s, 100)
  })
  it('refuses a closed shift even when nothing happened in it, and lets the owner delete an open empty one', async () => {
    const closed = await openShift(cashier2, 250); await closeShift(cashier2, closed, 250)
    await expect(delShift(manager, closed)).rejects.toThrow(/closed shift carries the cash count/)
    await expect(delShift(owner, closed)).rejects.toThrow(/closed shift carries the cash count/)
    expect(await q('select 1 from public.cashier_shifts where id=$1', [closed])).toHaveLength(1)
    const open = await openShift(cashier2, 75)
    await delShift(owner, open)
    expect(await q('select 1 from public.cashier_shifts where id=$1', [open])).toHaveLength(0)
  })
})
