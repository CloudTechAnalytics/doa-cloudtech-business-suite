import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'
import { getIndustry } from '@/core/industry-registry'
import * as sc from '@/demo/demoSchool'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'

let db: Db
let owner: string
let n = 0
const key = () => `rs-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const names = async (b: string, t: string, where = '') => (await q<{ name: string }>(`select name from public.${t} where business_id=$1 ${where} order by name`, [b])).map((r) => r.name)
const setType = (b: string, type: string) => as(owner, () => q('select public.school_save_settings($1,$2,null,null,null,40,60,false,$3)', [b, type, '{1,2,3,4,5}']))
const fresh = async (type: string) => {
  const b = (await as(owner, () => q<{ id: string }>(`select public.create_business('S ${n++}','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  await as(owner, () => q(`select public.school_setup($1,$2,'2026/2027',current_date - 20)`, [b, type]))
  return b
}

beforeAll(async () => { db = await createDb(); owner = await createUser(db, 'o@example.com') })

describe('changing the kind of school reshapes it', () => {
  it('secondary to primary: departments and secondary classes go, primary classes and subjects arrive', async () => {
    const b = await fresh('secondary')
    expect(await names(b, 'school_departments')).toEqual(['Art', 'Commercial', 'Science'])
    await setType(b, 'primary')
    expect(await names(b, 'school_departments')).toEqual([])
    expect(await names(b, 'school_classes', 'and active')).toEqual(['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'])
    expect(await names(b, 'school_classes')).toHaveLength(6) // the unused secondary classes were deleted, not just hidden
    const subjects = await names(b, 'school_subjects')
    expect(subjects).toEqual(expect.arrayContaining(['English Language', 'Mathematics', 'Basic Science', 'Social Studies']))
    for (const gone of ['Physics', 'Economics', 'Literature in English', 'Basic Technology']) expect(subjects).not.toContain(gone)
    const p1 = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='Primary 1'`, [b]))[0].id
    expect((await q('select 1 from public.school_class_subjects where class_id=$1', [p1])).length).toBeGreaterThanOrEqual(7)
    expect(await q('select 1 from public.school_subjects where business_id=$1 and department_id is not null', [b])).toHaveLength(0)
  })

  it('secondary to nursery: nursery classes and early-years subjects', async () => {
    const b = await fresh('secondary')
    await setType(b, 'nursery')
    expect(await names(b, 'school_classes')).toEqual(['Nursery 1', 'Nursery 2'])
    expect(await names(b, 'school_subjects')).toEqual(['Creative Arts', 'Literacy', 'Numeracy', 'Rhymes and Music', 'Social and Health Habits'])
    expect(await names(b, 'school_departments')).toEqual([])
  })

  it('primary to all: adds the nursery, secondary classes, departments and subjects that were missing', async () => {
    const b = await fresh('primary')
    await setType(b, 'combined')
    expect(await names(b, 'school_departments')).toEqual(['Art', 'Commercial', 'Science'])
    expect(await names(b, 'school_classes')).toHaveLength(20)
    expect(await names(b, 'school_subjects')).toEqual(expect.arrayContaining(['Physics', 'Literacy', 'English Language']))
  })

  it('keeps, but retires, a secondary class that holds records, and still removes the departments', async () => {
    const b = await fresh('combined')
    const jss1 = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='JSS 1'`, [b]))[0].id
    const reg = await as(owner, () => q<{ r: { student_id: string } }>('select public.school_register_student($1,$2::jsonb,null,$3) as r', [b, JSON.stringify({ first: 'Old', last: 'Boy', class_id: jss1 }), key()]))
    await as(owner, () => q('select public.school_set_student_status($1,$2,$3)', [reg[0].r.student_id, 'withdrawn', 'Left the school']))
    await setType(b, 'primary')
    const kept = await q<{ active: boolean }>(`select active from public.school_classes where business_id=$1 and name='JSS 1'`, [b])
    expect(kept).toHaveLength(1); expect(kept[0].active).toBe(false)
    expect(await names(b, 'school_departments')).toEqual([])
  })

  it('is still refused while active students are in a class that would go, and then changes nothing', async () => {
    const b = await fresh('combined')
    const jss1 = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='JSS 1'`, [b]))[0].id
    await as(owner, () => q('select public.school_register_student($1,$2::jsonb,null,$3)', [b, JSON.stringify({ first: 'Kay', last: 'Eze', class_id: jss1 }), key()]))
    await expect(setType(b, 'primary')).rejects.toThrow(/still have active students/)
    expect(await names(b, 'school_departments')).toEqual(['Art', 'Commercial', 'Science'])
  })
})

describe('the same in the demo', () => {
  const create = async (type: string) => {
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
    const id = demoCreateBusiness('Reshape ' + type, 'school')
    await getIndustry('school').afterCreate!(id, { school_type: type, session_name: '2026/2027' })
    return id
  }
  const save = (id: string, type: sc.SSettings['schoolType']) => sc.demoSaveSettings(id, { schoolType: type, address: '', phone: '', email: '', caMax: 40, examMax: 60, showPosition: false, workingDays: [1, 2, 3, 4, 5] })

  it('secondary to primary removes the departments and brings in the primary subjects', async () => {
    const id = await create('secondary')
    expect(sc.demoStructure(id).departments).toHaveLength(3)
    expect(save(id, 'primary')).toBeNull()
    const st = sc.demoStructure(id)
    expect(st.departments).toEqual([])
    expect(st.classes.map((c) => c.name)).toEqual(['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'])
    expect(st.subjects.map((x) => x.name)).toEqual(expect.arrayContaining(['English Language', 'Basic Science']))
    expect(st.subjects.map((x) => x.name)).not.toContain('Physics')
    expect(st.classSubjects.filter((x) => x.classId === st.classes[0].id).length).toBeGreaterThanOrEqual(7)
  })

  it('secondary to nursery gives nursery classes and subjects only', async () => {
    const id = await create('secondary')
    expect(save(id, 'nursery')).toBeNull()
    const st = sc.demoStructure(id)
    expect(st.classes.map((c) => c.name)).toEqual(['Nursery 1', 'Nursery 2'])
    expect(st.subjects.map((x) => x.name).sort()).toEqual(['Creative Arts', 'Literacy', 'Numeracy', 'Rhymes and Music', 'Social and Health Habits'])
  })
})
