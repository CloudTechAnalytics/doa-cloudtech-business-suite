import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let root: string, support: string, owner: string
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const usage = async (u: string) => (await as(u, () => q<{ r: Record<string, number> }>('select public.platform_usage() as r')))[0].r

beforeAll(async () => {
  db = await createDb()
  ;[root, support, owner] = await Promise.all(['root', 'sup', 'owner'].map((p) => createUser(db, `${p}@example.com`)))
  await db.exec(`insert into public.platform_admins (user_id, role) values ('${root}', 'owner'), ('${support}', 'support')`)
  await as(owner, () => q(`select public.create_business('Green Farm','farm')`))
})

describe('plan usage in the platform console', () => {
  it('is closed to everyone who is not on the platform team, and the limits table cannot be read directly', async () => {
    await expect(usage(owner)).rejects.toThrow(/permission denied/)
    await expect(as(root, () => q('select * from public.platform_settings'))).rejects.toThrow()
    await expect(as(owner, () => q(`update public.platform_settings set value = '1'::jsonb`))).rejects.toThrow()
  })

  it('reports real sizes against the plan limits and real counts', async () => {
    const u = await usage(support)
    expect(Number(u.database_bytes)).toBeGreaterThan(0)
    expect(Number(u.database_cap_bytes)).toBe(500 * 1024 * 1024)
    expect(Number(u.storage_cap_bytes)).toBe(1024 * 1024 * 1024)
    expect(Number(u.storage_bytes)).toBe(0) // no file storage in the test database
    expect(Number(u.businesses)).toBe(1)
    expect(Number(u.users)).toBe(3)
  })

  it('counts audit events from inside businesses and from the console together', async () => {
    const before = Number((await usage(root)).audit_events)
    const id = (await q<{ id: string }>('select id from public.businesses limit 1'))[0].id
    await as(root, () => q(`select public.platform_set_business_status($1,'suspended','Checking the count')`, [id]))
    expect(Number((await usage(root)).audit_events)).toBeGreaterThan(before)
  })
})
