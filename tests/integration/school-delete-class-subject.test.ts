import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'
import * as sc from '@/demo/demoSchool'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'

let db: Db
let owner: string, teacher: string
let biz: string
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const classId = async (name: string) => (await q<{ id: string }>('select id from public.school_classes where business_id=$1 and name=$2', [biz, name]))[0].id
const subjectId = async (name: string) => (await q<{ id: string }>('select id from public.school_subjects where business_id=$1 and name=$2', [biz, name]))[0].id
const delClass = (u: string, id: string) => as(u, () => q('select public.school_delete_class($1,$2)', [biz, id]))
const delSubject = (u: string, id: string) => as(u, () => q('select public.school_delete_subject($1,$2)', [biz, id]))

beforeAll(async () => {
  db = await createDb()
  ;[owner, teacher] = await Promise.all(['o', 't'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, 't@example.com', 'teacher'])); await as(teacher, () => q('select public.accept_my_invitations()'))
  await as(owner, () => q(`select public.school_setup($1,'combined','2026/2027',current_date - 20)`, [biz]))
})

describe('deleting a class', () => {
  it('removes an unused class with its subject choices, and is for school managers only', async () => {
    const id = await classId('Nursery 2')
    await expect(delClass(teacher, id)).rejects.toThrow(/permission denied/)
    await delClass(owner, id)
    expect(await q('select 1 from public.school_classes where id=$1', [id])).toHaveLength(0)
    expect(await q('select 1 from public.school_class_subjects where class_id=$1', [id])).toHaveLength(0)
  })

  it('refuses a class that has students, and one that only has history', async () => {
    const id = await classId('Primary 1')
    const r = (await as(owner, () => q<{ r: { student_id: string } }>('select public.school_register_student($1,$2::jsonb,null,$3) as r', [biz, JSON.stringify({ first: 'Ada', last: 'Obi', class_id: id }), 'key-class-delete-1']))).at(0)!.r
    await expect(delClass(owner, id)).rejects.toThrow(/still has students/)
    await as(owner, () => q("select public.school_set_student_status($1,$2,'withdrawn',null,null)", [biz, r.student_id]).catch(() => []))
  })

  it('says a missing class is not found', async () => {
    await expect(delClass(owner, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(/class not found/)
  })
})

describe('deleting a subject', () => {
  it('removes an unused subject from every class, and is for school managers only', async () => {
    const id = await subjectId('Rhymes and Music')
    await expect(delSubject(teacher, id)).rejects.toThrow(/permission denied/)
    await delSubject(owner, id)
    expect(await q('select 1 from public.school_subjects where id=$1', [id])).toHaveLength(0)
    expect(await q('select 1 from public.school_class_subjects where subject_id=$1', [id])).toHaveLength(0)
  })
})

describe('the same in the demo', () => {
  const B = 'b-school'
  it('deletes unused classes and subjects, and refuses used ones with a clear reason', () => {
    demoSignOut(); demoSignIn('teacher@demo.test', 'demo1234')
    expect(sc.demoDeleteClass(B, 'x')).toMatch(/permission denied/)
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
    const withStudents = sc.demoStudents(B).find((x) => x.status === 'active')!.classId!
    expect(sc.demoDeleteClass(B, withStudents)).toMatch(/still has students/)
    expect(sc.demoSaveClass(B, { id: null, name: 'Spare Class', levelOrder: 99, arm: '', active: true, stage: 'primary', departmentId: null })).toBeNull()
    const spare = sc.demoStructure(B).classes.find((c) => c.name === 'Spare Class')!
    expect(sc.demoDeleteClass(B, spare.id)).toBeNull()
    expect(sc.demoStructure(B).classes.some((c) => c.id === spare.id)).toBe(false)

    expect(sc.demoSaveSubject(B, { id: null, name: 'Spare Subject', code: '', levels: ['primary'], departmentId: null })).toBeNull()
    const sub = sc.demoStructure(B).subjects.find((x) => x.name === 'Spare Subject')!
    expect(sc.demoDeleteSubject(B, sub.id)).toBeNull()
    const scored = sc.demoScores(B)[0].subjectId
    expect(sc.demoDeleteSubject(B, scored)).toMatch(/already has results/)
  })
})
