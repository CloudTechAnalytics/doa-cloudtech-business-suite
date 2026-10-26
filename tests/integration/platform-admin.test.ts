import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let root: string, engineer: string, support: string, owner: string, other: string, newcomer: string
let farm: string, shop: string
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const call = async <T = unknown>(u: string, sql: string, params: unknown[] = []) => (await as(u, () => q<{ r: T }>(`select ${sql} as r`, params)))[0].r

beforeAll(async () => {
  db = await createDb()
  ;[root, engineer, support, owner, other, newcomer] = await Promise.all(['root', 'eng', 'sup', 'owner', 'other', 'new'].map((p) => createUser(db, `${p}@example.com`)))
  await db.exec(`insert into public.platform_admins (user_id, role) values ('${root}', 'owner'), ('${engineer}', 'engineer'), ('${support}', 'support')`)
  farm = (await as(owner, () => q<{ id: string }>(`select public.create_business('Green Farm','farm') as id`)))[0].id
  shop = (await as(other, () => q<{ id: string }>(`select public.create_business('Corner Shop','retail') as id`)))[0].id
})

describe('who counts as a platform admin', () => {
  it('knows each admin by role and everyone else by nothing', async () => {
    expect(await call(root, 'public.platform_role()')).toBe('owner')
    expect(await call(engineer, 'public.platform_role()')).toBe('engineer')
    expect(await call(support, 'public.platform_role()')).toBe('support')
    expect(await call(owner, 'public.platform_role()')).toBeNull()
  })

  it('keeps every console function closed to business owners, members and signed-out callers', async () => {
    const reads = ['public.platform_overview()', 'public.platform_businesses(null)', `public.platform_business_detail('${farm}')`, 'public.platform_users(null)', 'public.platform_plans()', 'public.platform_audit(10)', 'public.platform_health()', 'public.platform_admins_list()']
    for (const sql of reads) await expect(call(owner, sql)).rejects.toThrow(/permission denied/)
    await expect(call(owner, `public.platform_set_business_status('${farm}','suspended','just because')`)).rejects.toThrow(/permission denied/)
    await expect(call(owner, `public.platform_set_subscription('${farm}','growth',null,null,'just because')`)).rejects.toThrow(/permission denied/)
    await expect(call(owner, `public.platform_add_admin('owner@example.com','owner')`)).rejects.toThrow(/permission denied/)
    await expect(as(null, () => q('select public.platform_overview()'))).rejects.toThrow()
  })

  it('cannot be written to or read around the functions', async () => {
    await expect(as(owner, () => q(`insert into public.platform_admins (user_id, role) values ('${owner}', 'owner')`))).rejects.toThrow()
    expect(await as(owner, () => q('select * from public.platform_admins'))).toHaveLength(0) // a person only ever sees their own row
    expect(await as(engineer, () => q('select * from public.platform_admins'))).toHaveLength(1)
    await expect(as(root, () => q('select * from public.platform_audit_log'))).rejects.toThrow()
  })
})

describe('what the console shows', () => {
  it('counts businesses, trials, users and revenue from the records', async () => {
    const o = await call<Record<string, number>>(support, 'public.platform_overview()')
    expect(Number(o.businesses)).toBe(2)
    expect(Number(o.trial)).toBe(2)
    expect(Number(o.paid)).toBe(0)
    expect(Number(o.mrr)).toBe(0)
    expect(Number(o.users)).toBe(6)
    expect(Number(o.platform_team)).toBe(3)
    expect((o as unknown as { by_industry: { industry: string }[] }).by_industry.map((x) => x.industry).sort()).toEqual(['farm', 'retail'])
  })

  it('lists businesses with the owner, plan and status, and finds them by owner email', async () => {
    const all = await call<{ name: string; owner_email: string; subscription_status: string; plan_code: string }[]>(support, 'public.platform_businesses(null)')
    expect(all.map((b) => b.name).sort()).toEqual(['Corner Shop', 'Green Farm'])
    expect(all.find((b) => b.name === 'Green Farm')).toMatchObject({ owner_email: 'owner@example.com', subscription_status: 'trialing', plan_code: 'starter' })
    const found = await call<{ name: string }[]>(support, `public.platform_businesses('OWNER@example')`)
    expect(found.map((b) => b.name)).toEqual(['Green Farm'])
  })

  it('shows one business with its people, plan and modules', async () => {
    const d = await call<{ owner: { email: string }; members: { role: string }[]; subscription: { plan_code: string }; modules: string[] }>(support, `public.platform_business_detail('${farm}')`)
    expect(d.owner.email).toBe('owner@example.com')
    expect(d.members.map((m) => m.role)).toEqual(['owner'])
    expect(d.subscription.plan_code).toBe('starter')
    expect(d.modules.length).toBeGreaterThan(0)
    await expect(call(support, `public.platform_business_detail('${newcomer}')`)).rejects.toThrow(/business not found/)
  })

  it('lists users with the businesses they belong to', async () => {
    const users = await call<{ email: string; businesses: { business: string }[]; platform_role: string | null }[]>(support, 'public.platform_users(null)')
    expect(users).toHaveLength(6)
    expect(users.find((u) => u.email === 'owner@example.com')!.businesses.map((b) => b.business)).toEqual(['Green Farm'])
    expect(users.find((u) => u.email === 'root@example.com')!.platform_role).toBe('owner')
  })

  it('reports real health checks', async () => {
    const h = await call<{ checks: { name: string; ok: boolean }[] }>(support, 'public.platform_health()')
    expect(h.checks.every((c) => c.ok)).toBe(true)
    expect(h.checks.length).toBeGreaterThan(3)
  })

  it('lists the plans with prices and how many businesses use each', async () => {
    const p = await call<{ code: string; price: number; businesses: number }[]>(support, 'public.platform_plans()')
    expect(p.map((x) => x.code)).toEqual(['starter', 'basic', 'growth', 'business'])
    expect(Number(p.find((x) => x.code === 'starter')!.businesses)).toBe(2)
  })
})

describe('what an engineer can change', () => {
  it('needs a reason for every change, and support cannot change anything', async () => {
    await expect(call(engineer, `public.platform_set_subscription('${farm}','growth',null,null,'')`)).rejects.toThrow(/say why/)
    await expect(call(support, `public.platform_set_subscription('${farm}','growth',null,null,'Upgrade requested')`)).rejects.toThrow(/permission denied/)
    await expect(call(support, `public.platform_set_business_status('${farm}','suspended','Late payment')`)).rejects.toThrow(/permission denied/)
  })

  it('moves a business to a paid plan, and the overview counts the revenue', async () => {
    await as(engineer, () => q(`select public.platform_set_subscription($1,'growth','active',null,'Paid by transfer, ref 1234')`, [farm]))
    const o = await call<Record<string, number>>(root, 'public.platform_overview()')
    expect(Number(o.paid)).toBe(1)
    expect(Number(o.trial)).toBe(1)
    expect(Number(o.mrr)).toBe(15000)
    const d = await call<{ subscription: { plan_code: string; status: string } }>(root, `public.platform_business_detail('${farm}')`)
    expect(d.subscription).toMatchObject({ plan_code: 'growth', status: 'active' })
  })

  it('extends a trial from where it ends and refuses silly values', async () => {
    const before = (await call<{ subscription: { trial_end: string } }>(root, `public.platform_business_detail('${shop}')`)).subscription.trial_end
    await as(engineer, () => q(`select public.platform_set_subscription($1,null,null,7,'Asked for more time')`, [shop]))
    const after = (await call<{ subscription: { trial_end: string } }>(root, `public.platform_business_detail('${shop}')`)).subscription.trial_end
    expect(Math.round((new Date(after).getTime() - new Date(before).getTime()) / 86400000)).toBe(7)
    await expect(call(engineer, `public.platform_set_subscription('${shop}',null,null,0,'zero days')`)).rejects.toThrow(/1 to 366/)
    await expect(call(engineer, `public.platform_set_subscription('${shop}','gold',null,null,'no such plan')`)).rejects.toThrow(/unknown plan/)
    await expect(call(engineer, `public.platform_set_subscription('${shop}',null,'free',null,'no such status')`)).rejects.toThrow(/subscription status/)
  })

  it('suspends a business so its people cannot use it, and reactivates it', async () => {
    const member = async () => (await as(owner, () => q<{ r: boolean }>(`select public.is_active_member($1) as r`, [farm])))[0].r
    expect(await member()).toBe(true)
    await as(engineer, () => q(`select public.platform_set_business_status($1,'suspended','Unpaid invoice')`, [farm]))
    expect(await member()).toBe(false)
    expect(Number((await call<Record<string, number>>(root, 'public.platform_overview()')).suspended)).toBe(1)
    await as(engineer, () => q(`select public.platform_set_business_status($1,'active','Paid')`, [farm]))
    expect(await member()).toBe(true)
    await expect(call(engineer, `public.platform_set_business_status('${farm}','archived','nope')`)).rejects.toThrow(/choose active or suspended/)
  })

  it('records every change with who, what and why, and the record cannot be altered', async () => {
    const log = await call<{ action: string; by: string; reason: string; business: string }[]>(support, 'public.platform_audit(50)')
    const actions = log.map((l) => l.action)
    expect(actions).toEqual(expect.arrayContaining(['subscription.update', 'business.suspend', 'business.reactivate']))
    const suspend = log.find((l) => l.action === 'business.suspend')!
    expect(suspend).toMatchObject({ by: 'eng@example.com', reason: 'Unpaid invoice', business: 'Green Farm' })
    await expect(db.exec(`update public.platform_audit_log set reason = 'changed'`)).rejects.toThrow(/cannot be changed/)
    await expect(db.exec('delete from public.platform_audit_log')).rejects.toThrow(/cannot be changed/)
    const detail = await call<{ platform_actions: { reason: string }[] }>(support, `public.platform_business_detail('${farm}')`)
    expect(detail.platform_actions.map((a) => a.reason)).toContain('Unpaid invoice')
  })
})

describe('who runs the platform', () => {
  it('lets only an owner change the team, by email of an existing account', async () => {
    await expect(call(engineer, `public.platform_add_admin('new@example.com','support')`)).rejects.toThrow(/permission denied/)
    await expect(call(root, `public.platform_add_admin('nobody@example.com','support')`)).rejects.toThrow(/sign up first/)
    await expect(call(root, `public.platform_add_admin('new@example.com','boss')`)).rejects.toThrow(/choose owner/)
    await as(root, () => q(`select public.platform_add_admin('NEW@example.com','support')`))
    expect(await call(newcomer, 'public.platform_role()')).toBe('support')
    const team = await call<{ email: string; role: string }[]>(support, 'public.platform_admins_list()')
    expect(team.map((t) => t.email).sort()).toEqual(['eng@example.com', 'new@example.com', 'root@example.com', 'sup@example.com'])
    await as(root, () => q('select public.platform_remove_admin($1)', [newcomer]))
    expect(await call(newcomer, 'public.platform_role()')).toBeNull()
  })

  it('never leaves the platform without an owner', async () => {
    await expect(call(root, 'public.platform_remove_admin($1)'.replace('$1', `'${root}'`))).rejects.toThrow(/at least one platform owner/)
    await expect(call(root, `public.platform_add_admin('root@example.com','engineer')`)).rejects.toThrow(/at least one platform owner/)
    await as(root, () => q(`select public.platform_add_admin('eng@example.com','owner')`))
    await as(root, () => q(`select public.platform_add_admin('root@example.com','engineer')`)) // fine now that there are two owners
    expect(await call(root, 'public.platform_role()')).toBe('engineer')
  })
})
