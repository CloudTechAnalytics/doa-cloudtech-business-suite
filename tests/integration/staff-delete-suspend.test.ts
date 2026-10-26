import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'
import * as sc from '@/demo/demoSchool'
import * as store from '@/demo/demoStore'

let db: Db
let owner: string, admin: string, principal: string, teacher: string, cashierUser: string
let biz: string
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const memberOf = async (u: string) => (await q<{ id: string; status: string }>('select id, status from public.business_members where business_id=$1 and user_id=$2', [biz, u]))[0]
const staffId = async (name: string) => (await q<{ id: string }>('select id from public.school_staff where business_id=$1 and name=$2', [biz, name]))[0]?.id
const access = async (u: string) => (await as(u, () => q<{ r: { staff_id: string; state: string }[] }>('select public.school_staff_access($1) as r', [biz])))[0].r

beforeAll(async () => {
  db = await createDb()
  ;[owner, admin, principal, teacher, cashierUser] = await Promise.all(['o', 'a', 'p', 't', 'c'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, e, r] of [[admin, 'a@example.com', 'business_admin'], [principal, 'p@example.com', 'principal'], [teacher, 't@example.com', 'teacher'], [cashierUser, 'c@example.com', 'viewer']] as const) {
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, e, r])); await as(u, () => q('select public.accept_my_invitations()'))
  }
  await as(owner, () => q(`select public.school_setup($1,'combined','2026/2027',current_date - 20)`, [biz]))
  await as(principal, () => q('select public.school_save_staff($1,null,$2,null,$3,$4,null,true)', [biz, 'Mr Teacher', 't@example.com', 'Teacher']))
  await as(teacher, () => q('select public.school_claim_links($1)', [biz]))
  const cls = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='Primary 1'`, [biz]))[0].id
  const teacherStaff = await staffId('Mr Teacher')
  await as(principal, () => q('select public.school_set_assignments($1,$2,$3::jsonb)', [biz, teacherStaff, JSON.stringify([{ class_id: cls, subject_id: null, class_teacher: true }])]))
})

describe('a suspended person is told, not sent to create a business', () => {
  it('shows suspended staff as suspended on the staff list, and lists the blocked access for that person only', async () => {
    const m = await memberOf(teacher)
    await as(admin, () => q('select public.set_member_status($1,$2)', [m.id, 'suspended']))
    expect((await access(principal)).find((a) => a.staff_id !== undefined && a.state === 'suspended')).toBeTruthy()
    expect(await as(teacher, () => q('select 1 from public.businesses where id=$1', [biz]))).toHaveLength(0) // locked out of the data itself
    const mine = await as(teacher, () => q<{ business_name: string; status: string }>('select * from public.my_blocked_memberships()'))
    expect(mine).toEqual([expect.objectContaining({ business_name: 'Bright School', status: 'suspended' })])
    expect(await as(principal, () => q('select * from public.my_blocked_memberships()'))).toHaveLength(0)
    await as(admin, () => q('select public.set_member_status($1,$2)', [m.id, 'active']))
    expect(await as(teacher, () => q('select * from public.my_blocked_memberships()'))).toHaveLength(0)
  })
})

describe('deleting a member of the business', () => {
  it('is for people who manage staff, never the owner or yourself, and only the owner may remove an admin', async () => {
    const del = (u: string, member: string) => as(u, () => q('select public.delete_member($1)', [member]))
    const [viewerId, ownerId, adminId] = [(await memberOf(cashierUser)).id, (await memberOf(owner)).id, (await memberOf(admin)).id]
    await expect(del(teacher, viewerId)).rejects.toThrow(/permission denied/)
    await expect(del(admin, ownerId)).rejects.toThrow(/cannot be removed/)
    await expect(del(admin, adminId)).rejects.toThrow(/cannot be removed/)
    await expect(del(principal, adminId)).rejects.toThrow(/permission denied/)
  })

  it('removes the membership, keeps the account, and revokes a pending invitation', async () => {
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, 'c@example.com', 'viewer'])).catch(() => undefined)
    const viewerId = (await memberOf(cashierUser)).id
    await as(admin, () => q('select public.delete_member($1)', [viewerId]))
    expect(await memberOf(cashierUser)).toBeUndefined()
    expect(await q(`select 1 from auth.users where email='c@example.com'`)).toHaveLength(1)
    expect(await q(`select 1 from public.audit_logs where business_id=$1 and action='business_member.delete'`, [biz])).toHaveLength(1)
  })
})

describe('deleting a school staff record', () => {
  it('needs the owner or an admin and a reason', async () => {
    const id = await staffId('Mr Teacher')
    await expect(as(principal, () => q('select public.school_delete_staff($1,$2,$3)', [biz, id, 'left the school']))).rejects.toThrow(/permission denied/)
    await expect(as(teacher, () => q('select public.school_delete_staff($1,$2,$3)', [biz, id, 'left the school']))).rejects.toThrow(/permission denied/)
    await expect(as(admin, () => q('select public.school_delete_staff($1,$2,$3)', [biz, id, '']))).rejects.toThrow(/say why/)
  })

  it('erases the record and assignments, removes their access, and is audited', async () => {
    const id = await staffId('Mr Teacher')
    await as(admin, () => q('select public.school_delete_staff($1,$2,$3)', [biz, id, 'Left the school']))
    expect(await staffId('Mr Teacher')).toBeUndefined()
    expect(await q('select 1 from public.school_assignments where staff_id=$1', [id])).toHaveLength(0)
    expect(await memberOf(teacher)).toBeUndefined()
    expect(await as(teacher, () => q('select * from public.my_blocked_memberships()'))).toHaveLength(0) // gone entirely, not suspended
    expect(await q(`select 1 from public.audit_logs where business_id=$1 and action='school_staff.delete'`, [biz])).toHaveLength(1)
  })

  it('removes a staff member who never had a login, and never the owner through their record', async () => {
    await as(principal, () => q('select public.school_save_staff($1,null,$2,null,null,$3,null,true)', [biz, 'Mrs Cleaner', 'Cleaner']))
    const cleaner = await staffId('Mrs Cleaner')
    await as(owner, () => q('select public.school_delete_staff($1,$2,$3)', [biz, cleaner, 'Resigned']))
    expect(await staffId('Mrs Cleaner')).toBeUndefined()
    await as(admin, () => q('select public.school_save_staff($1,null,$2,null,$3,$4,null,true)', [biz, 'The Owner', 'o@example.com', 'Proprietor']))
    await as(owner, () => q('select public.school_claim_links($1)', [biz]))
    const ownerStaff = await staffId('The Owner')
    await expect(as(admin, () => q('select public.school_delete_staff($1,$2,$3)', [biz, ownerStaff, 'testing']))).rejects.toThrow(/cannot be removed/)
  })
})

describe('the same in the demo', () => {
  const B = 'b-school'
  it('deletes a member and a staff record for owners only, and tells a suspended person', () => {
    store.demoSignOut(); store.demoSignIn('teacher@demo.test', 'demo1234')
    expect(store.demoDeleteMember('nope')).toMatch(/permission denied/)
    expect(sc.demoDeleteStaff(B, 'nope', 'reason')).toMatch(/permission denied/)
    store.demoSignOut(); store.demoSignIn('owner@demo.test', 'demo1234')
    expect(sc.demoSaveStaff(B, { id: null, name: 'Mr Gone', phone: '', email: 'gone@example.com', jobTitle: 'Teacher', department: '', active: true })).toBeNull()
    const id = sc.demoStaff(B).find((x) => x.name === 'Mr Gone')!.id
    expect(sc.demoCreateLogin(B, id, 'teacher', 'Sunrise2026x')).toBeNull()
    const member = store.getDemoState().members.find((m) => m.email === 'gone@example.com')!
    expect(store.demoSetStatus(member.id, 'suspended')).toBeNull()
    expect(sc.demoStaffAccess(B).find((a) => a.staffId === id)!.state).toBe('suspended')
    store.demoSignOut(); store.demoSignIn('gone@example.com', 'Sunrise2026x')
    expect(store.demoBlockedMemberships()).toEqual([expect.objectContaining({ name: expect.any(String), status: 'suspended' })])
    store.demoSignOut(); store.demoSignIn('owner@demo.test', 'demo1234')
    expect(sc.demoDeleteStaff(B, id, '')).toMatch(/say why/)
    expect(sc.demoDeleteStaff(B, id, 'Left the school')).toBeNull()
    expect(sc.demoStaff(B).some((x) => x.id === id)).toBe(false)
    expect(store.getDemoState().members.some((m) => m.email === 'gone@example.com')).toBe(false)
  })
})
