import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let root: string, engineer: string, ownerA: string, clerk: string, shared: string, ownerB: string
let bizA: string, bizB: string
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const exists = async (id: string) => Number((await q<{ c: string }>('select count(*) as c from auth.users where id = $1', [id]))[0].c) === 1
const hasProfile = async (id: string) => Number((await q<{ c: string }>('select count(*) as c from public.profiles where id = $1', [id]))[0].c) === 1
const join = async (owner: string, biz: string, user: string, email: string, role: string) => {
  await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
  await as(user, () => q('select public.accept_my_invitations()'))
}

beforeAll(async () => {
  db = await createDb()
  ;[root, engineer, ownerA, clerk, shared, ownerB] = await Promise.all(['root', 'eng', 'ownera', 'clerk', 'shared', 'ownerb'].map((p) => createUser(db, `${p}@example.com`)))
  await db.exec(`insert into public.platform_admins (user_id, role) values ('${root}', 'owner'), ('${engineer}', 'engineer')`)
  bizA = (await as(ownerA, () => q<{ id: string }>(`select public.create_business('Shop A','retail') as id`)))[0].id
  bizB = (await as(ownerB, () => q<{ id: string }>(`select public.create_business('Shop B','retail') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  await join(ownerA, bizA, clerk, 'clerk@example.com', 'cashier')
  await join(ownerA, bizA, shared, 'shared@example.com', 'cashier')
  await join(ownerB, bizB, shared, 'shared@example.com', 'cashier') // belongs to both shops
  await join(ownerA, bizA, engineer, 'eng@example.com', 'business_admin') // on the platform team too
})

describe('deleting a business also deletes the people who belonged only to it', () => {
  it('deletes their accounts and profiles, and keeps everyone who still has somewhere else to be', async () => {
    const r = (await as(root, () => q<{ r: { accounts_deleted: number; accounts_kept: number } }>(`select public.platform_purge_business($1,'Shop A','Owner asked for permanent deletion') as r`, [bizA])))[0].r
    expect(Number(r.accounts_deleted)).toBe(2) // the owner and the clerk
    expect(Number(r.accounts_kept)).toBe(2) // the shared cashier (also in Shop B) and the platform engineer
    expect(await exists(ownerA)).toBe(false); expect(await hasProfile(ownerA)).toBe(false)
    expect(await exists(clerk)).toBe(false); expect(await hasProfile(clerk)).toBe(false)
    expect(await exists(shared)).toBe(true)
    expect(await exists(engineer)).toBe(true)
    expect(await exists(root)).toBe(true)
    expect(await exists(ownerB)).toBe(true)
  })

  it('leaves the other business and its people working', async () => {
    expect((await as(shared, () => q<{ r: boolean }>('select public.is_active_member($1) as r', [bizB])))[0].r).toBe(true)
    expect((await as(ownerB, () => q<{ r: boolean }>('select public.is_active_member($1) as r', [bizB])))[0].r).toBe(true)
  })

  it('deletes the shared person too once their last business is deleted, and records the counts', async () => {
    const r = (await as(root, () => q<{ r: { accounts_deleted: number } }>(`select public.platform_purge_business($1,'Shop B','Closing down') as r`, [bizB])))[0].r
    expect(Number(r.accounts_deleted)).toBe(2) // the owner of Shop B and the shared cashier
    expect(await exists(shared)).toBe(false)
    expect(await exists(ownerB)).toBe(false)
    const log = (await as(root, () => q<{ r: { action: string; detail: { accounts_deleted: number } }[] }>('select public.platform_audit(10) as r')))[0].r
    expect(log.filter((l) => l.action === 'business.purge').map((l) => Number(l.detail.accounts_deleted)).sort()).toEqual([2, 2])
  })

  it('never deletes the person who does it or anyone on the platform team', async () => {
    const solo = (await as(engineer, () => q<{ id: string }>(`select public.create_business('Engineer Shop','retail') as id`)))[0].id
    await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
    const r = (await as(root, () => q<{ r: { accounts_deleted: number; accounts_kept: number } }>(`select public.platform_purge_business($1,'Engineer Shop','Test') as r`, [solo])))[0].r
    expect(Number(r.accounts_deleted)).toBe(0); expect(Number(r.accounts_kept)).toBe(1)
    expect(await exists(engineer)).toBe(true)
  })
})
