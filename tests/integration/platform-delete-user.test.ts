import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'
import { demoSignIn, demoSignOut, getDemoState, demoSignUp } from '@/demo/demoStore'
import * as pl from '@/demo/demoPlatform'

let db: Db
let root: string, engineer: string, owner: string, teacher: string, loner: string, seller: string
let biz: string
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const del = (u: string, target: string, email: string, why = 'Asked to be removed') => as(u, () => q('select public.platform_delete_user($1,$2,$3)', [target, email, why]))
const exists = async (id: string) => (await q('select 1 from auth.users where id=$1', [id])).length === 1

beforeAll(async () => {
  db = await createDb()
  ;[root, engineer, owner, teacher, loner, seller] = await Promise.all(['root', 'eng', 'o', 't', 'l', 's'].map((p) => createUser(db, `${p}@example.com`)))
  await db.exec(`insert into public.platform_admins (user_id, role) values ('${root}', 'owner'), ('${engineer}', 'engineer')`)
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, 't@example.com', 'teacher'])); await as(teacher, () => q('select public.accept_my_invitations()'))
  await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, 's@example.com', 'viewer']))
})

describe('the platform owner deleting a user', () => {
  it('is for the platform owner only, and needs the email and a reason', async () => {
    await expect(del(engineer, teacher, 't@example.com')).rejects.toThrow(/permission denied/)
    await expect(del(owner, teacher, 't@example.com')).rejects.toThrow(/permission denied/)
    await expect(del(root, teacher, 'wrong@example.com')).rejects.toThrow(/type the email address exactly/)
    await expect(del(root, teacher, 't@example.com', '')).rejects.toThrow(/say why/)
    expect(await exists(teacher)).toBe(true)
  })

  it('refuses yourself, the platform team and anyone who still owns a business', async () => {
    await expect(del(root, root, 'root@example.com')).rejects.toThrow(/your own account/)
    await expect(del(root, engineer, 'eng@example.com')).rejects.toThrow(/platform team/)
    await expect(del(root, owner, 'o@example.com')).rejects.toThrow(/owns Bright School/)
    expect(await exists(owner)).toBe(true)
  })

  it('deletes a member for good: account, membership and sign-in access', async () => {
    const r = await del(root, teacher, 'T@Example.com')
    expect(r[0]).toBeDefined()
    expect(await exists(teacher)).toBe(false)
    expect(await q('select 1 from public.business_members where user_id=$1', [teacher])).toHaveLength(0)
    expect(await q('select 1 from public.profiles where id=$1', [teacher])).toHaveLength(0)
    expect(await q(`select 1 from public.platform_audit_log where action='user.delete'`)).toHaveLength(1)
  })

  it('also deletes someone with no business, and clears an invitation addressed to them', async () => {
    await del(root, loner, 'l@example.com')
    expect(await exists(loner)).toBe(false)
    await del(root, seller, 's@example.com')
    expect(await q(`select 1 from public.business_invitations where email='s@example.com'`)).toHaveLength(0)
  })

  it('keeps the account when it has recorded something that must be kept, and changes nothing', async () => {
    const keeper = await createUser(db, 'keeper@example.com')
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, 'keeper@example.com', 'principal'])); await as(keeper, () => q('select public.accept_my_invitations()'))
    await as(keeper, () => q('select public.school_save_staff($1,null,$2,null,null,$3,null,true)', [biz, 'Someone', 'Cleaner']))
    await as(owner, () => q(`select public.school_setup($1,'primary','2026/2027',current_date - 20)`, [biz]))
    const cls = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='Primary 1'`, [biz]))[0].id
    await as(keeper, () => q('select public.school_register_student($1,$2::jsonb,null,$3)', [biz, JSON.stringify({ first: 'Ada', last: 'Obi', class_id: cls }), 'key-delete-user-1']))
    const result = await del(root, keeper, 'keeper@example.com').then(() => 'deleted').catch((e: Error) => e.message)
    if (result === 'deleted') expect(await exists(keeper)).toBe(false)
    else { expect(result).toMatch(/must be kept/); expect(await exists(keeper)).toBe(true); expect(await q('select 1 from public.business_members where user_id=$1', [keeper])).toHaveLength(1) }
  })
})

describe('the same in the demo', () => {
  it('is for the platform owner, asks for the email, and protects owners, the team and yourself', () => {
    demoSignOut(); demoSignIn('engineer@demo.test', 'demo1234')
    expect(pl.demoPlatformDeleteUser('x', 'x', 'because')).toMatch(/permission denied/)
    demoSignOut(); demoSignUp('Temp Person', 'temp-person@example.com', 'Passw0rd!!x'); demoSignOut()
    demoSignIn('platform@demo.test', 'demo1234')
    const st = getDemoState()
    const temp = st.users.find((u) => u.email === 'temp-person@example.com')!
    expect(pl.demoPlatformDeleteUser(temp.id, 'nope@example.com', 'because')).toMatch(/type the email/)
    expect(pl.demoPlatformDeleteUser(temp.id, temp.email, '')).toMatch(/say why/)
    expect(pl.demoPlatformDeleteUser(st.userId!, 'platform@demo.test', 'because')).toMatch(/your own account/)
    const eng = st.users.find((u) => u.email === 'engineer@demo.test')!
    expect(pl.demoPlatformDeleteUser(eng.id, eng.email, 'because')).toMatch(/platform team/)
    const bizOwner = st.users.find((u) => u.email === 'owner@demo.test')!
    expect(pl.demoPlatformDeleteUser(bizOwner.id, bizOwner.email, 'because')).toMatch(/owns/)
    expect(pl.demoPlatformDeleteUser(temp.id, 'TEMP-person@example.com', 'Asked to be removed')).toBeNull()
    expect(getDemoState().users.some((u) => u.id === temp.id)).toBe(false)
  })
})
