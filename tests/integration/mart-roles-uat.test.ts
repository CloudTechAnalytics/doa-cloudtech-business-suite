import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

/**
 * Acceptance test of a mart, person by person: the same actions are tried by every role and the outcomes compared with what that role is meant to do.
 */
let db: Db
const U: Record<string, string> = {}
let biz: string, loc: string, cola: string
let n = 0
const key = () => `mu-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = JSON.stringify
const ok = async (fn: () => Promise<unknown>) => { try { await fn(); return 'ok' } catch (e) { return /permission denied|not allowed|only|cannot|refused/i.test(String((e as Error).message)) ? 'denied' : 'error: ' + (e as Error).message } }
const usable = async (u: string) => (await as(u, () => q<{ module_code: string; usable: boolean }>('select * from public.my_modules($1)', [biz]))).filter((m) => m.usable).map((m) => m.module_code).sort()
const ROLES = ['owner', 'business_admin', 'manager', 'accountant', 'cashier', 'inventory_officer', 'viewer'] as const

beforeAll(async () => {
  db = await createDb()
  for (const r of [...ROLES, 'stranger']) U[r] = await createUser(db, `${r}@example.com`)
  biz = (await as(U.owner, () => q<{ id: string }>(`select public.create_business('UAT Mart','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const r of ROLES.filter((x) => x !== 'owner')) { await as(U.owner, () => q('select public.invite_member($1,$2,$3)', [biz, `${r}@example.com`, r])); await as(U[r], () => q('select public.accept_my_invitations()')) }
  loc = (await q<{ id: string }>('select id from public.inventory_locations where business_id=$1', [biz]))[0].id
  const unit = (await q<{ id: string }>(`select id from public.units_of_measure where business_id=$1 and code='each'`, [biz]))[0].id
  cola = (await q<{ id: string }>('insert into public.products (business_id,name,base_unit_id,selling_price) values ($1,$2,$3,300) returning id', [biz, 'Cola', unit]))[0].id
  await as(U.owner, () => q('select public.mart_receive_stock($1,$2,$3::jsonb,$4,$5)', [biz, loc, J([{ product_id: cola, quantity: 500, unit_cost: 200 }]), 'Opening', key()]))
})

describe('which mart pages each role can open', () => {
  it('gives the owner, an admin and a manager the whole mart', async () => {
    for (const r of ['owner', 'business_admin', 'manager']) expect(await usable(U[r]), r).toEqual(expect.arrayContaining(['sales', 'retail-products', 'retail-counts', 'retail-losses', 'retail-returns', 'retail-shifts', 'retail-reports', 'purchases', 'suppliers', 'expenses', 'reports', 'customers']))
    for (const r of ['owner', 'business_admin']) expect(await usable(U[r]), r).toEqual(expect.arrayContaining(['settings', 'staff']))
  })
  it('gives a cashier the till, their shift and customers, and no stock pages, nothing about money out, purchasing, reports or staff', async () => {
    const m = await usable(U.cashier)
    expect(m).toEqual(expect.arrayContaining(['sales', 'retail-shifts', 'customers']))
    for (const no of ['inventory', 'retail-products', 'retail-counts', 'retail-losses', 'retail-categories', 'purchases', 'suppliers', 'expenses', 'reports', 'retail-reports', 'staff', 'settings', 'retail-returns']) expect(m, no).not.toContain(no)
  })
  it('gives a storekeeper stock, purchasing and suppliers, and no till, shifts, expenses or staff', async () => {
    const m = await usable(U.inventory_officer)
    expect(m).toEqual(expect.arrayContaining(['inventory', 'purchases', 'suppliers', 'retail-counts', 'retail-losses', 'retail-returns', 'retail-products']))
    for (const no of ['sales', 'retail-shifts', 'expenses', 'customers', 'staff', 'settings', 'reports']) expect(m, no).not.toContain(no)
  })
  it('gives an accountant the figures: reports, expenses, purchases and the mart reports, and no shifts, staff or settings', async () => {
    const m = await usable(U.accountant)
    expect(m).toEqual(expect.arrayContaining(['reports', 'expenses', 'purchases', 'retail-reports']))
    for (const no of ['retail-shifts', 'staff', 'settings']) expect(m, no).not.toContain(no)
  })
  it('gives someone outside the mart nothing', async () => { await expect(usable(U.stranger)).resolves.toEqual([]) })
})

describe('what each role can do in the mart', () => {
  const probes: Record<string, (u: string) => Promise<unknown>> = {
    'ring up a sale': (u) => as(u, () => q('select public.mart_post_sale($1,$2,null,$3::jsonb,$4::jsonb,$5)', [biz, loc, J([{ product_id: cola, quantity: 1 }]), J([{ method: 'cash', amount: 300 }]), key()])),
    'add a product': (u) => as(u, () => q('select public.mart_save_product($1,$2,$3,null,$4,$5,null,$6,$7,$8,null,$9,null,$10,$11,$12::jsonb,$13)', [biz, null, 'P' + n++, null, null, 'each', 1000, 1500, 20, false, true, '[]', key()])),
    'receive stock': (u) => as(u, () => q('select public.mart_receive_stock($1,$2,$3::jsonb,$4,$5)', [biz, loc, J([{ product_id: cola, quantity: 1, unit_cost: 200 }]), 'Probe', key()])),
    'record a loss': (u) => as(u, () => q('select public.mart_record_loss($1,$2,$3,1,$4,$5,$6)', [biz, cola, loc, 'damaged', 'probe', key()])),
    'start a stock count': (u) => as(u, () => q('select public.mart_start_count($1,$2,null,$3)', [biz, loc, key()])),
    'open a cashier shift': (u) => as(u, () => q('select public.mart_open_shift($1,$2,$3)', [biz, 1000, key()])),
    'change the sales tax': (u) => as(u, () => q('select public.set_business_tax($1,$2)', [biz, 0])),
  }
  const all = Object.keys(probes)
  const can: Record<string, string[]> = {
    owner: all, business_admin: all,
    manager: all.filter((x) => x !== 'change the sales tax'),
    cashier: ['ring up a sale', 'open a cashier shift'],
    inventory_officer: ['receive stock', 'record a loss', 'start a stock count'],
    accountant: [], viewer: [], stranger: [],
  }
  for (const [role, allowed] of Object.entries(can)) {
    it(`${role} can ${allowed.length === all.length ? 'do all of these' : allowed.length ? allowed.join('; ') : 'do none of these'}, and is refused the rest`, async () => {
      const got: Record<string, string> = {}; for (const [name, run] of Object.entries(probes)) got[name] = await ok(() => run(U[role]))
      const want: Record<string, string> = {}; for (const name of all) want[name] = allowed.includes(name) ? 'ok' : 'denied'
      expect(got).toEqual(want)
    })
  }
})
