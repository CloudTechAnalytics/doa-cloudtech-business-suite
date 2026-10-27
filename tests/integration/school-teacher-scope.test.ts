import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'
import { rolePermissions } from '@/core/permissions/roles'

let db: Db
let owner: string, admin: string, manager: string, principal: string, teacher: string, other: string
let biz: string
let n = 0
const key = () => `ts-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = (v: unknown) => JSON.stringify(v)
const usable = async (u: string) => (await as(u, () => q<{ module_code: string; usable: boolean }>('select * from public.my_modules($1)', [biz]))).filter((m) => m.usable).map((m) => m.module_code)

beforeAll(async () => {
  db = await createDb()
  ;[owner, admin, manager, principal, teacher, other] = await Promise.all(['o', 'a', 'm', 'p', 't', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, e, r] of [[admin, 'a@example.com', 'business_admin'], [manager, 'm@example.com', 'manager'], [principal, 'p@example.com', 'principal'], [teacher, 't@example.com', 'teacher']] as const) { await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, e, r])); await as(u, () => q('select public.accept_my_invitations()')) }
  await as(owner, () => q(`select public.school_setup($1,'combined','2026/2027',current_date - 20)`, [biz]))
  const c = async (name: string) => (await q<{ id: string }>('select id from public.school_classes where business_id=$1 and name=$2', [biz, name]))[0].id
  const p1 = await c('Primary 1'), p2 = await c('Primary 2')
  await as(owner, () => q('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4)', [biz, J({ first: 'Ada', last: 'Obi', class_id: p1 }), J([{ name: 'Mrs Obi', email: 'obi@example.com', relationship: 'mother', primary: true }]), key()]))
  await as(owner, () => q('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4)', [biz, J({ first: 'Bayo', last: 'Ade', class_id: p2 }), J([{ name: 'Mr Ade', email: 'ade@example.com', relationship: 'father', primary: true }]), key()]))
  await as(principal, () => q('select public.school_save_staff($1,null,$2,null,$3,$4,null,true)', [biz, 'Mr Teacher', 't@example.com', 'Teacher']))
  await as(principal, () => q('select public.school_claim_links($1)', [biz])).catch(() => undefined)
  await as(teacher, () => q('select public.school_claim_links($1)', [biz]))
  const staff = (await q<{ id: string }>('select id from public.school_staff where business_id=$1', [biz]))[0].id
  await as(principal, () => q('select public.school_set_assignments($1,$2,$3::jsonb)', [biz, staff, J([{ class_id: p1, subject_id: null, class_teacher: true }])]))
})

describe('who gets My Classes', () => {
  it('only teachers: not the owner, an admin, a manager or the principal', async () => {
    expect(await usable(teacher)).toContain('school-my-classes')
    for (const u of [owner, admin, manager, principal]) expect(await usable(u)).not.toContain('school-my-classes')
  })

  it('is not in the roles of anyone but the teacher, in the app as in the database', async () => {
    const holders = (await q<{ name: string }>(`select r.name from public.role_permissions rp join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id where p.code = 'school.teach' and r.business_id is null`)).map((r) => r.name)
    expect(holders).toEqual(['teacher'])
    for (const role of ['owner', 'business_admin', 'manager', 'principal', 'bursar', 'admissions_officer', 'parent', 'viewer'] as const) expect(rolePermissions(role).has('school.teach')).toBe(false)
    expect(rolePermissions('teacher').has('school.teach')).toBe(true)
  })
})

describe('teachers and parents & guardians', () => {
  it('gives teachers the Parents & Guardians page, along with the roles that already read parents', async () => {
    for (const u of [teacher, principal, owner, admin, manager]) expect(await usable(u)).toContain('school-guardians')
    expect(await usable(other)).not.toContain('school-guardians')
  })

  it('shows a teacher only the parents of the pupils in their own classes', async () => {
    const seen = (await as(teacher, () => q<{ name: string }>('select name from public.school_guardians where business_id=$1 order by name', [biz]))).map((g) => g.name)
    expect(seen).toEqual(['Mrs Obi'])
    expect((await as(owner, () => q('select 1 from public.school_guardians where business_id=$1', [biz]))).length).toBe(2)
  })

  it('does not let a teacher change parents', async () => {
    const g = (await q<{ id: string }>(`select id from public.school_guardians where business_id=$1 and name='Mrs Obi'`, [biz]))[0].id
    await expect(as(teacher, () => q(`select public.school_save_guardian($1,$2,'X','1','x@example.com','')`, [biz, g]))).rejects.toThrow()
  })
})

describe('the app models the same roles', () => {
  it('has school.guardians for teachers and the parent-reading roles only', () => {
    for (const role of ['teacher', 'principal', 'bursar', 'admissions_officer', 'owner', 'business_admin', 'manager'] as const) expect(rolePermissions(role).has('school.guardians')).toBe(true)
    for (const role of ['parent', 'viewer', 'cashier'] as const) expect(rolePermissions(role).has('school.guardians')).toBe(false)
  })
})

describe('a teacher and the Timetable and Reports pages', () => {
  it('can open both, as can the owner and the principal', async () => {
    for (const u of [teacher, owner, principal]) expect(await usable(u)).toEqual(expect.arrayContaining(['school-timetable', 'school-reports']))
  })
  it('sees the timetable of the class they teach and no other', async () => {
    const cls = async (name: string) => (await q<{ id: string }>('select id from public.school_classes where business_id=$1 and name=$2', [biz, name]))[0].id
    const [p1, p2] = [await cls('Primary 1'), await cls('Primary 2')]
    await as(owner, () => q('select public.school_save_periods($1,$2::jsonb)', [biz, J([{ label: 'P1', starts: '08:00', ends: '08:40', is_break: false }])]))
    const period = (await q<{ id: string }>('select id from public.school_periods where business_id=$1', [biz]))[0].id
    for (const c of [p1, p2]) {
      const sub = (await q<{ subject_id: string }>('select subject_id from public.school_class_subjects where class_id=$1 limit 1', [c]))[0].subject_id
      await as(owner, () => q('select public.school_set_slot($1,$2,1,$3,$4,null,null)', [biz, c, period, sub]))
    }
    const seen = (await as(teacher, () => q<{ class_id: string }>('select distinct class_id from public.school_timetable where business_id=$1', [biz]))).map((r) => r.class_id)
    expect(seen).toEqual([p1])
    expect(await q('select 1 from public.school_timetable where business_id=$1', [biz])).toHaveLength(2)
  })
  it('still cannot change the timetable', async () => {
    await expect(as(teacher, () => q(`select public.school_save_periods($1,'[]'::jsonb)`, [biz]))).rejects.toThrow(/permission denied/)
  })
})
