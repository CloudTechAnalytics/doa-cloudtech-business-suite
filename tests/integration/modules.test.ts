import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, cashier: string, outsider: string
let retail: string, farm: string, bakery: string

interface Mod { module_code: string; enabled: boolean; entitled: boolean; permitted: boolean; usable: boolean }
const createBiz = (name: string, industry: string) =>
  rows<{ id: string }>(db, 'select public.create_business($1, $2) as id', [name, industry]).then((r) => r[0].id)
const myModules = (b: string) => rows<Mod>(db, 'select * from public.my_modules($1)', [b])
const usable = async (b: string, code: string, mode = 'use') =>
  (await rows<{ v: boolean }>(db, 'select public.module_usable($1, $2, $3) as v', [b, code, mode]))[0].v
const setPlan = (b: string, plan: string) =>
  db.query(`update public.subscriptions set plan_id = (select id from public.subscription_plans where code = $2) where business_id = $1`, [b, plan])

beforeAll(async () => {
  db = await createDb()
  owner = await createUser(db, 'owner@example.com')
  cashier = await createUser(db, 'cashier@example.com')
  outsider = await createUser(db, 'outsider@example.com')
  retail = await asUser(db, owner, () => createBiz('CityMart', 'retail'))
  farm = await asUser(db, owner, () => createBiz('Greenfield', 'farm'))
  bakery = await asUser(db, owner, () => createBiz('Sunrise', 'bakery'))
  await asUser(db, owner, () => rows(db, `select public.invite_member($1, 'cashier@example.com', 'cashier')`, [retail]))
  await asUser(db, cashier, () => rows(db, 'select public.accept_my_invitations()'))
})

describe('industry templates drive different module sets', () => {
  it('retail, farm and bakery get distinct enabled modules', async () => {
    const enabled = async (b: string) => (await asUser(db, owner, () => myModules(b))).filter((m) => m.enabled).map((m) => m.module_code)
    const [r, f, bk] = [await enabled(retail), await enabled(farm), await enabled(bakery)]
    expect(r).toContain('customers')
    expect(r).not.toContain('farm-batches')
    expect(f).toContain('farm-batches')
    expect(f).not.toContain('suppliers')
    expect(bk).toContain('bakery-recipes')
    expect(bk).not.toContain('farm-batches')
    for (const set of [r, f, bk]) expect(set).toEqual(expect.arrayContaining(['dashboard', 'staff', 'settings']))
  })

  it('new businesses start on a 14-day starter trial', async () => {
    const [s] = await rows<{ status: string; code: string }>(db, `select s.status, p.code from public.subscriptions s join public.subscription_plans p on p.id = s.plan_id where s.business_id = $1`, [retail])
    expect(s).toEqual({ status: 'trialing', code: 'starter' })
  })
})

describe('entitlements and permissions (backend enforced)', () => {
  it('starter plan locks purchases and reports even though they are enabled', async () => {
    const m = (await asUser(db, owner, () => myModules(retail))).find((x) => x.module_code === 'purchases')!
    expect(m).toMatchObject({ enabled: true, entitled: false, usable: false })
    expect(await asUser(db, owner, () => usable(retail, 'purchases'))).toBe(false)
    expect(await asUser(db, owner, () => usable(retail, 'sales'))).toBe(true)
  })

  it('upgrading the plan unlocks them', async () => {
    await setPlan(retail, 'growth')
    expect(await asUser(db, owner, () => usable(retail, 'purchases'))).toBe(true)
    expect(await asUser(db, owner, () => usable(retail, 'reports'))).toBe(true)
  })

  it('role permissions apply on top of module availability', async () => {
    const m = await asUser(db, cashier, () => myModules(retail))
    const get = (c: string) => m.find((x) => x.module_code === c)!
    expect(get('sales').usable).toBe(true)
    expect(get('reports')).toMatchObject({ entitled: true, permitted: false, usable: false })
    const ok = await asUser(db, cashier, () => rows<{ v: boolean }>(db, `select public.has_module_permission($1, 'sales', 'sales.create') as v`, [retail]))
    const denied = await asUser(db, cashier, () => rows<{ v: boolean }>(db, `select public.has_module_permission($1, 'reports', 'reports.finance.read') as v`, [retail]))
    expect([ok[0].v, denied[0].v]).toEqual([true, false])
  })

  it('non-members and forged business ids get nothing', async () => {
    expect(await asUser(db, outsider, () => myModules(retail))).toHaveLength(0)
    expect(await asUser(db, outsider, () => usable(retail, 'sales'))).toBe(false)
    // cashier is not a member of the farm
    expect(await asUser(db, cashier, () => usable(farm, 'dashboard'))).toBe(false)
  })

  it('an expired subscription blocks use but keeps historical read access; core stays', async () => {
    await db.query(`update public.subscriptions set status = 'expired', current_period_end = now() - interval '1 day' where business_id = $1`, [bakery])
    expect(await asUser(db, owner, () => usable(bakery, 'sales'))).toBe(false)
    expect(await asUser(db, owner, () => usable(bakery, 'sales', 'read'))).toBe(true)
    expect(await asUser(db, owner, () => usable(bakery, 'dashboard'))).toBe(true)
    // restricted paid features cannot be activated either
    await expect(asUser(db, owner, () => rows(db, `select public.invite_member($1, 'a@example.com', 'viewer')`, [bakery]))).rejects.toThrow(/subscription is not active/)
  })

  it('past_due keeps access during the 7-day grace period only', async () => {
    await db.query(`update public.subscriptions set status = 'past_due', current_period_end = now() - interval '3 days' where business_id = $1`, [bakery])
    expect(await asUser(db, owner, () => usable(bakery, 'sales'))).toBe(true)
    await db.query(`update public.subscriptions set current_period_end = now() - interval '9 days' where business_id = $1`, [bakery])
    expect(await asUser(db, owner, () => usable(bakery, 'sales'))).toBe(false)
  })
})

describe('plan limits', () => {
  it('enforces branch limits', async () => {
    await expect(asUser(db, owner, () => db.query(`insert into public.branches (business_id, name, code) values ($1, 'Two', 'TWO')`, [farm]))).rejects.toThrow(/branch limit/)
    await setPlan(farm, 'growth')
    await asUser(db, owner, () => db.query(`insert into public.branches (business_id, name, code) values ($1, 'Two', 'TWO')`, [farm]))
  })

  it('enforces member limits including pending invitations', async () => {
    const biz = await asUser(db, owner, () => createBiz('Tiny', 'retail'))
    for (const e of ['a@example.com', 'b@example.com']) {
      await asUser(db, owner, () => rows(db, `select public.invite_member($1, $2, 'viewer')`, [biz, e]))
    }
    await expect(asUser(db, owner, () => rows(db, `select public.invite_member($1, 'c@example.com', 'viewer')`, [biz]))).rejects.toThrow(/member limit/)
  })
})

describe('enable / disable modules', () => {
  it('enables a compatible optional module', async () => {
    await asUser(db, owner, () => rows(db, `select public.enable_module($1, 'suppliers')`, [farm]))
    const m = (await asUser(db, owner, () => myModules(farm))).find((x) => x.module_code === 'suppliers')!
    expect(m.enabled).toBe(true)
  })

  it('rejects incompatible modules, unknown callers and non-managers', async () => {
    await expect(asUser(db, owner, () => rows(db, `select public.enable_module($1, 'bakery-recipes')`, [farm]))).rejects.toThrow(/not compatible/)
    await expect(asUser(db, cashier, () => rows(db, `select public.enable_module($1, 'customers')`, [retail]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, outsider, () => rows(db, `select public.enable_module($1, 'customers')`, [retail]))).rejects.toThrow(/permission denied/)
  })

  it('disabling keeps the row and configuration; re-enabling restores it', async () => {
    await db.query(`update public.business_modules set configuration = '{"note":"keep"}' where business_id = $1 and module_id = (select id from public.modules where code = 'suppliers')`, [farm])
    await asUser(db, owner, () => rows(db, `select public.disable_module($1, 'suppliers')`, [farm]))
    expect(await asUser(db, owner, () => usable(farm, 'suppliers'))).toBe(false)
    expect(await asUser(db, owner, () => usable(farm, 'suppliers', 'read'))).toBe(true)
    await asUser(db, owner, () => rows(db, `select public.enable_module($1, 'suppliers')`, [farm]))
    const [r] = await rows<{ configuration: { note: string } }>(db, `select configuration from public.business_modules where business_id = $1 and module_id = (select id from public.modules where code = 'suppliers')`, [farm])
    expect(r.configuration.note).toBe('keep')
  })

  it('refuses to disable core or required modules', async () => {
    await expect(asUser(db, owner, () => rows(db, `select public.disable_module($1, 'settings')`, [farm]))).rejects.toThrow(/cannot be disabled/)
    await expect(asUser(db, owner, () => rows(db, `select public.disable_module($1, 'farm-overview')`, [farm]))).rejects.toThrow(/cannot be disabled/)
  })

  it('has no direct write path to business_modules', async () => {
    await expect(asUser(db, owner, () => db.query(`update public.business_modules set status = 'enabled' where business_id = $1`, [farm]))).rejects.toThrow(/permission denied/)
  })
})

describe('industry change workflow', () => {
  let biz: string
  beforeAll(async () => { biz = await asUser(db, owner, () => createBiz('Convertible', 'farm')) })

  it('previews incompatible modules without changing anything', async () => {
    const [p] = await asUser(db, owner, () => rows<{ p: { incompatible_modules: string[] } }>(db, `select public.preview_industry_change($1, 'retail') as p`, [biz]))
    expect(p.p.incompatible_modules).toContain('farm-batches')
    const [b] = await rows<{ primary_industry_code: string }>(db, 'select primary_industry_code from public.businesses where id = $1', [biz])
    expect(b.primary_industry_code).toBe('farm')
  })

  it('requires explicit confirmation when modules would be disabled', async () => {
    await expect(asUser(db, owner, () => rows(db, `select public.change_industry($1, 'retail')`, [biz]))).rejects.toThrow(/Confirm/)
  })

  it('is owner-only, and pharmacy is not selectable', async () => {
    await asUser(db, owner, () => rows(db, `select public.invite_member($1, 'cashier@example.com', 'business_admin')`, [biz]))
    await asUser(db, cashier, () => rows(db, 'select public.accept_my_invitations()'))
    await expect(asUser(db, cashier, () => rows(db, `select public.change_industry($1, 'retail', true)`, [biz]))).rejects.toThrow(/only the owner/)
    await expect(asUser(db, owner, () => rows(db, `select public.change_industry($1, 'pharmacy', true)`, [biz]))).rejects.toThrow(/not available/)
    await expect(asUser(db, owner, () => rows(db, `select public.create_business('Pharma', 'pharmacy')`))).rejects.toThrow(/not available/)
  })

  it('switches industry, disables (not deletes) old modules and records history', async () => {
    await asUser(db, owner, () => rows(db, `select public.change_industry($1, 'retail', true)`, [biz]))
    const mods = await asUser(db, owner, () => myModules(biz))
    expect(mods.some((m) => m.module_code === 'farm-batches')).toBe(false)
    expect(mods.find((m) => m.module_code === 'sales')!.enabled).toBe(true)
    // old data stays readable
    expect(await asUser(db, owner, () => usable(biz, 'farm-batches', 'read'))).toBe(true)
    const [row] = await rows<{ status: string }>(db, `select bm.status from public.business_modules bm join public.modules m on m.id = bm.module_id where bm.business_id = $1 and m.code = 'farm-batches'`, [biz])
    expect(row.status).toBe('disabled')
    const [h] = await rows<{ from_industry: string; to_industry: string }>(db, 'select from_industry, to_industry from public.business_industry_changes where business_id = $1', [biz])
    expect(h).toEqual({ from_industry: 'farm', to_industry: 'retail' })
  })
})
