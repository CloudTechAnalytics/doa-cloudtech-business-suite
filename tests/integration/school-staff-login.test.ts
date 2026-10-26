import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'
import * as sc from '@/demo/demoSchool'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'

let db: Db
let owner: string, principal: string, teacher: string, newTeacher: string, outsider: string
let biz: string
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const staffId = async (name: string) => (await q<{ id: string }>('select id from public.school_staff where business_id=$1 and name=$2', [biz, name]))[0].id
const addStaff = (u: string, name: string, email: string | null) => as(u, () => q('select public.school_save_staff($1,null,$2,null,$3,$4,null,true)', [biz, name, email, 'Staff']))
const give = (u: string, id: string, role: string) => as(u, () => q('select public.school_give_login($1,$2,$3)', [biz, id, role]))
const pending = (email: string) => q(`select 1 from public.business_invitations where business_id=$1 and email=$2 and status='pending'`, [biz, email])
const access = async (u: string) => (await as(u, () => q<{ r: { staff_id: string; state: string; role: string | null }[] }>('select public.school_staff_access($1) as r', [biz])))[0].r

beforeAll(async () => {
  db = await createDb()
  ;[owner, principal, teacher, newTeacher, outsider] = await Promise.all(['o', 'p', 't', 'n', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, e, r] of [[principal, 'p@example.com', 'principal'], [teacher, 't@example.com', 'teacher']] as const) { await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, e, r])); await as(u, () => q('select public.accept_my_invitations()')) }
})

describe('giving school staff a login', () => {
  it('leaves staff without a login as plain records', async () => {
    await addStaff(principal, 'Mrs Cleaner', null)
    const a = await access(principal)
    expect(a).toHaveLength(1); expect(a[0].state).toBe('none')
  })

  it('needs an email address, and only school roles', async () => {
    await expect(give(principal, await staffId('Mrs Cleaner'), 'teacher')).rejects.toThrow(/email address first/)
    await addStaff(principal, 'Mr New', 'n@example.com')
    const nid = await staffId('Mr New')
    await expect(give(principal, nid, 'owner')).rejects.toThrow(/choose teacher/)
    await expect(give(principal, nid, 'business_admin')).rejects.toThrow(/choose teacher/)
  })

  it('is refused for teachers and outsiders', async () => {
    const nid = await staffId('Mr New')
    await expect(give(teacher, nid, 'teacher')).rejects.toThrow(/permission denied/)
    await expect(give(outsider, nid, 'teacher')).rejects.toThrow(/permission denied/)
    await expect(access(teacher)).rejects.toThrow(/permission denied/)
  })

  it('invites them, and their own sign-up joins them to the school and links their record', async () => {
    const nid = await staffId('Mr New')
    await give(principal, nid, 'teacher')
    expect((await access(principal)).find((a) => a.staff_id === nid)).toMatchObject({ state: 'invited', role: 'teacher' })
    await as(newTeacher, () => q('select public.accept_my_invitations()'))
    await as(newTeacher, () => q('select public.school_claim_links($1)', [biz]))
    expect((await access(principal)).find((a) => a.staff_id === nid)).toMatchObject({ state: 'signed_in', role: 'teacher' })
    await expect(give(principal, nid, 'bursar')).rejects.toThrow(/already has a login/)
  })

  it('lets an unused invitation be re-issued with another role, or withdrawn', async () => {
    await addStaff(principal, 'Mr Bursar', 'b@example.com')
    const id = await staffId('Mr Bursar')
    await give(principal, id, 'teacher'); await give(principal, id, 'bursar')
    expect(await pending('b@example.com')).toHaveLength(1)
    await as(principal, () => q('select public.school_cancel_login($1,$2)', [biz, id]))
    expect(await pending('b@example.com')).toHaveLength(0)
  })

  it('needs the owner or an admin to give the principal role', async () => {
    await addStaff(principal, 'Deputy', 'd@example.com')
    const id = await staffId('Deputy')
    await expect(give(principal, id, 'principal')).rejects.toThrow(/owner or an admin/)
    await give(owner, id, 'principal')
    expect(await pending('d@example.com')).toHaveLength(1)
  })
})

describe('the same in the demo', () => {
  const B = 'b-school'
  it('works for the owner, is refused to a teacher, and shows the state', () => {
    demoSignOut(); demoSignIn('teacher@demo.test', 'demo1234')
    expect(sc.demoGiveLogin(B, 'x', 'teacher')).toMatch(/permission denied/)
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
    expect(sc.demoSaveStaff(B, { id: null, name: 'Mr Demo', phone: '', email: 'mrdemo@example.com', jobTitle: 'Teacher', department: '', active: true })).toBeNull()
    expect(sc.demoSaveStaff(B, { id: null, name: 'Cleaner', phone: '', email: '', jobTitle: 'Cleaner', department: '', active: true })).toBeNull()
    const id = sc.demoStaff(B).find((x) => x.name === 'Mr Demo')!.id
    const cl = sc.demoStaff(B).find((x) => x.name === 'Cleaner')!.id
    expect(sc.demoGiveLogin(B, cl, 'teacher')).toMatch(/email address first/)
    expect(sc.demoGiveLogin(B, id, 'owner')).toMatch(/choose teacher/)
    expect(sc.demoGiveLogin(B, id, 'teacher')).toBeNull()
    expect(sc.demoStaffAccess(B).find((a) => a.staffId === id)).toMatchObject({ state: 'invited', role: 'teacher' })
    expect(sc.demoStaffAccess(B).find((a) => a.staffId === cl)!.state).toBe('none')
    expect(sc.demoCancelLogin(B, id)).toBeNull()
    expect(sc.demoStaffAccess(B).find((a) => a.staffId === id)!.state).toBe('none')
  })
})

describe('creating a login with a temporary password', () => {
  const make = (u: string, id: string, role: string, pw: string) => as(u, () => q('select public.school_create_login($1,$2,$3,$4)', [biz, id, role, pw]))

  it('creates the account, joins the school, links the record and flags a password change', async () => {
    await addStaff(principal, 'Miss Temp', 'temp@example.com')
    const id = await staffId('Miss Temp')
    await make(principal, id, 'teacher', 'Sunrise2026x')
    const u = (await q<{ id: string; encrypted_password: string; raw_user_meta_data: { must_change_password?: boolean }; email_confirmed_at: string | null }>(`select id, encrypted_password, raw_user_meta_data, email_confirmed_at from auth.users where email='temp@example.com'`))[0]
    expect(u.encrypted_password).not.toContain('Sunrise2026x'); expect(u.raw_user_meta_data.must_change_password).toBe(true); expect(u.email_confirmed_at).not.toBeNull()
    expect(await q(`select 1 from public.business_members m join public.roles r on r.id=m.role_id where m.business_id=$1 and m.user_id=$2 and m.status='active' and r.name='teacher'`, [biz, u.id])).toHaveLength(1)
    expect((await access(principal)).find((a) => a.staff_id === id)).toMatchObject({ state: 'signed_in', role: 'teacher' })
    expect(await q('select 1 from auth.identities where user_id=$1 and provider=$2', [u.id, 'email'])).toHaveLength(1)
  })

  it('refuses weak passwords, missing emails, wrong roles and people without permission', async () => {
    await addStaff(principal, 'Mr Weak', 'weak@example.com'); await addStaff(principal, 'No Mail', null)
    const weak = await staffId('Mr Weak')
    await expect(make(principal, weak, 'teacher', 'short1A')).rejects.toThrow(/at least 10 characters/)
    await expect(make(principal, weak, 'teacher', 'alllowercase123')).rejects.toThrow(/at least 10 characters/)
    await expect(make(principal, await staffId('No Mail'), 'teacher', 'Sunrise2026x')).rejects.toThrow(/email address first/)
    await expect(make(principal, weak, 'owner', 'Sunrise2026x')).rejects.toThrow(/choose teacher/)
    await expect(make(principal, weak, 'principal', 'Sunrise2026x')).rejects.toThrow(/owner or an admin/)
    await expect(make(teacher, weak, 'teacher', 'Sunrise2026x')).rejects.toThrow(/permission denied/)
    await expect(make(outsider, weak, 'teacher', 'Sunrise2026x')).rejects.toThrow(/permission denied/)
    expect(await q(`select 1 from auth.users where email='weak@example.com'`)).toHaveLength(0)
  })

  it('never touches an account that already exists', async () => {
    await addStaff(principal, 'Existing', 't@example.com')
    await expect(make(principal, await staffId('Existing'), 'bursar', 'Sunrise2026x')).rejects.toThrow(/already has an account/)
  })
})

describe('the temporary password in the demo', () => {
  const B = 'b-school'
  it('creates the account, signs in, must be replaced, and never overwrites an existing account', async () => {
    const store = await import('@/demo/demoStore')
    store.demoSignOut(); store.demoSignIn('owner@demo.test', 'demo1234')
    expect(sc.demoSaveStaff(B, { id: null, name: 'Mrs Temp', phone: '', email: 'mrstemp@example.com', jobTitle: 'Teacher', department: '', active: true })).toBeNull()
    const id = sc.demoStaff(B).find((x) => x.name === 'Mrs Temp')!.id
    expect(sc.demoCreateLogin(B, id, 'teacher', 'weak')).toMatch(/at least 10 characters/)
    expect(sc.demoCreateLogin(B, id, 'teacher', 'Sunrise2026x')).toBeNull()
    expect(sc.demoStaffAccess(B).find((a) => a.staffId === id)).toMatchObject({ state: 'signed_in', role: 'teacher' })
    store.demoSignOut()
    expect(store.demoSignIn('mrstemp@example.com', 'wrong')).toMatch(/Invalid/)
    expect(store.demoSignIn('mrstemp@example.com', 'Sunrise2026x')).toBeNull()
    expect(store.getDemoState().users.find((u) => u.email === 'mrstemp@example.com')!.mustChange).toBe(true)
    expect(store.demoSetOwnPassword('MyOwnPassw0rd')).toBeNull()
    expect(store.getDemoState().users.find((u) => u.email === 'mrstemp@example.com')!.mustChange).toBe(false)
    store.demoSignOut(); expect(store.demoSignIn('mrstemp@example.com', 'MyOwnPassw0rd')).toBeNull()
    store.demoSignOut(); store.demoSignIn('owner@demo.test', 'demo1234')
    expect(sc.demoSaveStaff(B, { id: null, name: 'Dup', phone: '', email: 'owner@demo.test', jobTitle: '', department: '', active: true })).toBeNull()
    expect(sc.demoCreateLogin(B, sc.demoStaff(B).find((x) => x.name === 'Dup')!.id, 'teacher', 'Sunrise2026x')).toMatch(/already has an account/)
  })
})
