import { beforeAll, describe, expect, it } from 'vitest'
import { STANDALONE_APPS, appsOn } from '@/core/app-catalogue/apps'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let root: string, support: string, owner: string, other: string
let n = 0
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const call = async <T = unknown>(u: string, sql: string, params: unknown[] = []) => (await as(u, () => q<{ r: T }>(`select ${sql} as r`, params)))[0].r
const workspace = async (u = owner) => (await as(u, () => q<{ id: string }>(`select public.create_business('Apps ${n++}','general') as id`)))[0].id
/** What the browser does when someone starts from an app's link: switch the other defaults off, then record the starting app. */
const startWith = async (b: string, app: string, u = owner) => {
  const keep = new Set(STANDALONE_APPS.find((a) => a.id === app)!.modules)
  for (const m of ['inventory', 'sales', 'purchases', 'suppliers', 'customers', 'invoices', 'expenses', 'reports']) if (!keep.has(m)) await as(u, () => q('select public.disable_module($1,$2)', [b, m]))
  await as(u, () => q('select public.set_started_with_app($1,$2)', [b, app]))
}
const detail = (b: string) => call<{ started_with_app: string | null; apps: string[]; app_activity: Record<string, { records: number; last_at: string | null }>; app_events: { module: string; action: string; by: string | null }[] }>(root, 'public.platform_business_detail($1)', [b])

beforeAll(async () => {
  db = await createDb()
  ;[root, support, owner, other] = await Promise.all(['root', 'sup', 'owner', 'other'].map((p) => createUser(db, `${p}@example.com`)))
  await db.exec(`insert into public.platform_admins (user_id, role) values ('${root}', 'owner'), ('${support}', 'support')`)
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
})

describe('the SQL app definitions match the app catalogue', () => {
  it('has the same modules for every app', async () => {
    const r = await q<{ app: string; module: string }>('select app, module from public.app_modules order by app, module')
    const sql = Object.fromEntries(STANDALONE_APPS.map((a) => [a.id, r.filter((x) => x.app === a.id).map((x) => x.module).sort()]))
    for (const a of STANDALONE_APPS) expect(sql[a.id], a.id).toEqual([...a.modules].sort())
    expect(r.length).toBe(STANDALONE_APPS.reduce((s, a) => s + a.modules.length, 0))
  })

  it('works out the apps a workspace has on the same way in SQL and in the app', async () => {
    const b = await workspace()
    const sqlApps = async () => (await call<string[]>(root, 'public._business_apps($1)', [b]).catch(async () => (await call<{ apps: string[] }>(root, 'public.platform_business_detail($1)', [b])).apps)) as string[]
    expect(await sqlApps()).toEqual(appsOn(['inventory', 'sales', 'purchases', 'suppliers', 'customers', 'invoices', 'expenses', 'reports']))
    await as(owner, () => q('select public.disable_module($1,$2)', [b, 'inventory']))
    expect(await sqlApps()).toEqual(appsOn(['sales', 'purchases', 'suppliers', 'customers', 'invoices', 'expenses', 'reports'])) // POS needs Inventory, so POS and Inventory both go
  })
})

describe('the starting app', () => {
  it('is recorded once, by the owner, on a new Business apps workspace, and replaces the setup noise with a start entry', async () => {
    const b = await workspace()
    await startWith(b, 'crm')
    const d = await detail(b)
    expect(d.started_with_app).toBe('crm'); expect(d.apps).toEqual(['crm'])
    expect(d.app_events.map((e) => `${e.module}:${e.action}`)).toEqual(['customers:start'])
    await expect(as(owner, () => q('select public.set_started_with_app($1,$2)', [b, 'pos']))).rejects.toThrow(/already has a starting app/)
  })

  it('is refused for other people, other kinds of business, unknown apps and old workspaces', async () => {
    const b = await workspace()
    await expect(as(other, () => q('select public.set_started_with_app($1,$2)', [b, 'crm']))).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => q('select public.set_started_with_app($1,$2)', [b, 'nope']))).rejects.toThrow(/unknown app/)
    const shop = (await as(owner, () => q<{ id: string }>(`select public.create_business('Shop','retail') as id`)))[0].id
    await expect(as(owner, () => q('select public.set_started_with_app($1,$2)', [shop, 'crm']))).rejects.toThrow(/only a Business apps workspace/)
    await db.exec(`update public.businesses set created_at = now() - interval '2 hours' where id = '${b}'`)
    await expect(as(owner, () => q('select public.set_started_with_app($1,$2)', [b, 'crm']))).rejects.toThrow(/only be set when the workspace is new/)
  })
})

describe('the history of apps switched on and off', () => {
  it('is written by the database, with who did it, and shows later changes newest first', async () => {
    const b = await workspace()
    await startWith(b, 'crm')
    await db.exec(`update public.business_module_events set at = at - interval '5 minutes' where business_id = '${b}'`)
    await db.exec(`update public.businesses set created_at = now() - interval '10 minutes' where id = '${b}'`)
    await as(owner, () => q('select public.enable_module($1,$2)', [b, 'invoices']))
    await as(owner, () => q('select public.disable_module($1,$2)', [b, 'invoices']))
    await as(owner, () => q('select public.enable_module($1,$2)', [b, 'expenses']))
    const d = await detail(b)
    expect(d.app_events.map((e) => `${e.module}:${e.action}`)).toEqual(['expenses:on', 'invoices:off', 'invoices:on', 'customers:start'])
    expect(d.app_events[0].by).toBeTruthy()
    expect(d.apps).toEqual(['crm', 'expenses'])
  })

  it('cannot be written or read around the console functions', async () => {
    const b = await workspace()
    await expect(as(owner, () => q(`insert into public.business_module_events (business_id, module_code, action) values ($1,'sales','on')`, [b]))).rejects.toThrow()
    await expect(as(owner, () => q('select * from public.business_module_events'))).rejects.toThrow(/permission denied/)
  })
})

describe('how much each app is used', () => {
  it('counts records and the latest use per app, and says nothing for an app that is on but unused', async () => {
    const b = await workspace()
    await as(owner, () => q(`insert into public.customers (business_id, name) values ($1,'Acme')`, [b]))
    const c = (await q<{ id: string }>('select id from public.customers where business_id=$1', [b]))[0].id
    await as(owner, () => q('select public.invoice_save($1,null,$2,null,$3::jsonb,0,0,$4)', [b, c, JSON.stringify([{ description: 'J', quantity: 1, unit_price: 10 }]), '']))
    const d = await detail(b)
    expect(d.app_activity.crm.records).toBe(1); expect(d.app_activity.crm.last_at).not.toBeNull()
    expect(d.app_activity.invoices.records).toBe(1)
    expect(d.app_activity.expenses).toEqual({ records: 0, last_at: null })
    expect(d.app_activity.pos.records).toBe(0)
  })
})

describe('the console', () => {
  it('lists each workspace with its apps and its starting app', async () => {
    const b = await workspace(); await startWith(b, 'invoices')
    const list = await call<{ id: string; apps: string[]; started_with_app: string | null; industry: string }[]>(support, 'public.platform_businesses(null)')
    expect(list.find((x) => x.id === b)).toMatchObject({ apps: ['invoices'], started_with_app: 'invoices', industry: 'general' })
  })

  it('counts adoption per app: using, started, grew into a second app, and active in the last 30 days', async () => {
    const crmOnly = await workspace(); await startWith(crmOnly, 'crm')
    const grew = await workspace(); await startWith(grew, 'crm')
    await as(owner, () => q('select public.enable_module($1,$2)', [grew, 'invoices']))
    await as(owner, () => q(`insert into public.customers (business_id, name) values ($1,'Active one')`, [grew]))
    const adoption = Object.fromEntries((await call<{ app: string; workspaces: number; started: number; grew: number; active_30d: number }[]>(root, 'public.platform_app_adoption()')).map((a) => [a.app, a]))
    expect(adoption.crm.started).toBeGreaterThanOrEqual(2); expect(adoption.crm.grew).toBeGreaterThanOrEqual(1); expect(adoption.crm.active_30d).toBeGreaterThanOrEqual(1)
    expect(adoption.invoices.workspaces).toBeGreaterThanOrEqual(1)
    expect(Object.keys(adoption)).toEqual(['crm', 'pos', 'inventory', 'invoices', 'expenses', 'finance'])
    for (const a of Object.values(adoption)) expect(a.grew).toBeLessThanOrEqual(a.started)
  })

  it('does not count industry businesses in app adoption', async () => {
    const before = await call<{ app: string; workspaces: number }[]>(root, 'public.platform_app_adoption()')
    await as(owner, () => q(`select public.create_business('A Shop','retail')`))
    const after = await call<{ app: string; workspaces: number }[]>(root, 'public.platform_app_adoption()')
    expect(after).toEqual(before)
  })

  it('is closed to everyone who is not on the platform team', async () => {
    await expect(call(owner, 'public.platform_app_adoption()')).rejects.toThrow(/permission denied/)
    await expect(as(null, () => q('select public.platform_app_adoption()'))).rejects.toThrow()
  })
})
