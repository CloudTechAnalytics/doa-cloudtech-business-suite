import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'
import { getIndustry } from '@/core/industry-registry'
import * as sc from '@/demo/demoSchool'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'

let db: Db
let owner: string, teacher: string
let n = 0
const key = () => `on-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const names = async (b: string, t: string, where = '') => (await q<{ name: string }>(`select name from public.${t} where business_id=$1 ${where} order by name`, [b])).map((r) => r.name)
const fresh = async (type: string) => {
  const b = (await as(owner, () => q<{ id: string }>(`select public.create_business('S ${n++}','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  await as(owner, () => q(`select public.school_setup($1,$2,'2026/2027',current_date - 20)`, [b, type]))
  return b
}
const course = (b: string, name: string, description: string | null = null, duration: string | null = null, u = owner) =>
  as(u, () => q('select public.school_save_class($1,null,$2,1,null,true,$3,null,$4,$5) as id', [b, name, 'online', description, duration]))

beforeAll(async () => { db = await createDb(); [owner, teacher] = await Promise.all(['o', 't'].map((p) => createUser(db, `${p}@example.com`))) })

describe('an online school', () => {
  it('starts with no courses, units or departments, and one cohort instead of three terms', async () => {
    const b = await fresh('online')
    expect(await names(b, 'school_classes')).toEqual([]); expect(await names(b, 'school_subjects')).toEqual([]); expect(await names(b, 'school_departments')).toEqual([])
    expect(await names(b, 'school_terms')).toEqual(['2026/2027']); expect(await names(b, 'school_sessions')).toEqual(['2026/2027']) // one cohort, not three terms
    expect((await q<{ school_type: string }>('select school_type from public.school_settings where business_id=$1', [b]))[0].school_type).toBe('online')
  })

  it('lets the owner add courses with a description and duration, and edit them', async () => {
    const b = await fresh('online')
    const id = (await course(b, 'Web Development', 'HTML, CSS and JavaScript from scratch', '12 weeks'))[0].id as string
    const row = (await q<{ stage: string; description: string; duration: string }>('select stage, description, duration from public.school_classes where id=$1', [id]))[0]
    expect(row).toEqual({ stage: 'online', description: 'HTML, CSS and JavaScript from scratch', duration: '12 weeks' })
    await as(owner, () => q('select public.school_save_class($1,$2,$3,1,null,true,$4,null,$5,$6)', [b, id, 'Web Development', 'online', 'Updated', '8 weeks']))
    expect((await q<{ duration: string }>('select duration from public.school_classes where id=$1', [id]))[0].duration).toBe('8 weeks')
    await expect(course(b, 'Web Development')).rejects.toThrow(/a course with this name already exists/)
    await expect(course(b, '')).rejects.toThrow(/enter the course name/)
  })

  it('gives a course units, enrols learners, and bills and reports work as they do for a class', async () => {
    const b = await fresh('online')
    const id = (await course(b, 'Data Analysis', null, '6 weeks'))[0].id as string
    const unit = (await as(owner, () => q(`select public.school_save_subject($1,null,'Spreadsheets',null,'{online}',null) as id`, [b])))[0].id as string
    await as(owner, () => q('select public.school_set_class_subjects($1,$2,$3)', [b, id, [unit]]))
    const reg = await as(owner, () => q<{ r: { student_id: string } }>('select public.school_register_student($1,$2::jsonb,null,$3) as r', [b, JSON.stringify({ first: 'Ada', last: 'Obi', class_id: id }), key()]))
    expect(reg[0].r.student_id).toBeTruthy()
    expect(await names(b, 'school_subjects', 'and levels = array[\'online\']::text[]')).toEqual(['Spreadsheets'])
  })

  it('keeps the physical stages out, and the online stage out of "all"', async () => {
    const b = await fresh('online')
    await expect(as(owner, () => q(`select public.school_save_class($1,null,'Primary 1',3,null,true,'primary')`, [b]))).rejects.toThrow(/cannot have primary classes/)
    const all = await fresh('combined')
    await expect(course(all, 'Stray Course')).rejects.toThrow(/cannot have online courses/)
    expect(await names(all, 'school_classes')).toHaveLength(20)
  })

  it('is reshaped to and from an online school', async () => {
    const b = await fresh('secondary')
    const set = (type: string) => as(owner, () => q('select public.school_save_settings($1,$2,null,null,null,40,60,false,$3)', [b, type, '{1,2,3,4,5}']))
    await set('online')
    expect(await names(b, 'school_classes')).toEqual([]); expect(await names(b, 'school_departments')).toEqual([]); expect(await names(b, 'school_subjects')).toEqual([])
    await course(b, 'Cybersecurity Basics', null, '10 weeks')
    await set('primary')
    expect(await names(b, 'school_classes', 'and active')).toEqual(['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'])
    expect(await names(b, 'school_classes')).not.toContain('Cybersecurity Basics')
  })

  it('is for school managers only', async () => {
    const b = await fresh('online')
    await expect(course(b, 'Hacked', null, null, teacher)).rejects.toThrow(/permission denied/)
  })
})

describe('the same in the demo', () => {
  const create = async () => {
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
    const id = demoCreateBusiness('Online Academy', 'school')
    await getIndustry('school').afterCreate!(id, { school_type: 'online', session_name: '2026/2027' })
    return id
  }
  it('starts empty, takes courses with details, and refuses physical classes', async () => {
    const id = await create()
    const st0 = sc.demoStructure(id)
    expect(st0.classes).toEqual([]); expect(st0.subjects).toEqual([]); expect(st0.departments).toEqual([])
    expect(sc.demoSaveClass(id, { id: null, name: 'UX Design', levelOrder: 1, arm: '', active: true, stage: 'online', description: 'Research to prototype', duration: '10 weeks' })).toBeNull()
    const c = sc.demoStructure(id).classes[0]
    expect(c).toMatchObject({ name: 'UX Design', stage: 'online', description: 'Research to prototype', duration: '10 weeks' })
    expect(sc.demoSaveClass(id, { id: null, name: 'UX Design', levelOrder: 1, arm: '', active: true, stage: 'online' })).toMatch(/a course with this name already exists/)
    expect(sc.demoSaveClass(id, { id: null, name: 'Primary 1', levelOrder: 3, arm: '', active: true, stage: 'primary' })).toMatch(/cannot have primary classes/)
    expect(sc.demoSaveSubject(id, { id: null, name: 'Wireframing', code: '', levels: ['online'] })).toBeNull()
  })
  it('reshapes from secondary to online and back', async () => {
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
    const id = demoCreateBusiness('Switcher', 'school')
    await getIndustry('school').afterCreate!(id, { school_type: 'secondary', session_name: '2026/2027' })
    const save = (type: sc.SSettings['schoolType']) => sc.demoSaveSettings(id, { schoolType: type, address: '', phone: '', email: '', caMax: 40, examMax: 60, showPosition: false, workingDays: [1, 2, 3, 4, 5] })
    expect(save('online')).toBeNull()
    const st = sc.demoStructure(id)
    expect(st.classes).toEqual([]); expect(st.departments).toEqual([]); expect(st.subjects).toEqual([])
    expect(save('nursery')).toBeNull()
    expect(sc.demoStructure(id).classes.map((c) => c.name)).toEqual(['Nursery 1', 'Nursery 2'])
  })
})

describe('cohorts instead of terms', () => {
  const cohort = (b: string, id: string | null, name: string, starts = '2027-01-11', ends = '2027-04-30', current = false, u = owner) =>
    as(u, () => q('select public.school_save_cohort($1,$2,$3,$4::date,$5::date,$6) as id', [b, id, name, starts, ends, current]))

  it('creates a cohort as a session with one term of the same name, and keeps them together when edited', async () => {
    const b = await fresh('online')
    const id = (await cohort(b, null, 'January 2027 intake', '2027-01-11', '2027-04-30', true))[0].id as string
    expect(await names(b, 'school_sessions')).toEqual(['2026/2027', 'January 2027 intake'])
    expect(await names(b, 'school_terms')).toEqual(['2026/2027', 'January 2027 intake'])
    expect((await q('select 1 from public.school_terms where business_id=$1 and name=$2 and is_current', [b, 'January 2027 intake'])).length).toBe(1)
    await cohort(b, id, 'January 2027 cohort', '2027-01-11', '2027-05-14', true)
    expect(await names(b, 'school_terms')).toEqual(['2026/2027', 'January 2027 cohort'])
    await expect(cohort(b, null, 'January 2027 cohort')).rejects.toThrow(/already exists/)
    await expect(cohort(b, null, 'Bad dates', '2027-05-01', '2027-04-01')).rejects.toThrow(/enter the cohort name/)
    await expect(cohort(b, null, 'Hacked', '2027-01-01', '2027-02-01', false, teacher)).rejects.toThrow(/permission denied/)
  })

  it('lets unused sessions and terms be deleted, and refuses ones in use', async () => {
    const b = await fresh('online')
    const del = (fn: string, id: string) => as(owner, () => q(`select public.${fn}($1,$2)`, [b, id]))
    const extra = (await cohort(b, null, 'Spare cohort'))[0].id as string
    await del('school_delete_session', extra)
    expect(await names(b, 'school_sessions')).toEqual(['2026/2027'])
    const course = (await course_(b))
    const reg = await as(owner, () => q<{ r: { student_id: string } }>('select public.school_register_student($1,$2::jsonb,null,$3) as r', [b, JSON.stringify({ first: 'Ada', last: 'Obi', class_id: course }), key()]))
    expect(reg[0].r.student_id).toBeTruthy()
    const used = (await q<{ id: string }>('select id from public.school_sessions where business_id=$1', [b]))[0].id
    await expect(del('school_delete_session', used)).rejects.toThrow(/cannot be deleted/)
    const term = (await q<{ id: string }>('select id from public.school_terms where business_id=$1', [b]))[0].id
    await del('school_delete_term', term) // nothing recorded against it yet
    expect(await names(b, 'school_terms')).toEqual([])
  })

  const course_ = async (b: string) => (await course(b, 'Any Course'))[0].id as string
})

describe('cohorts in the demo', () => {
  it('starts with one cohort, saves cohorts as a pair, and deletes unused ones', async () => {
    demoSignOut(); demoSignIn('owner@demo.test', 'demo1234')
    const id = demoCreateBusiness('Cohort Academy', 'school')
    await getIndustry('school').afterCreate!(id, { school_type: 'online', session_name: 'Cohort 1' })
    let st = sc.demoStructure(id)
    expect(st.sessions.map((x) => x.name)).toEqual(['Cohort 1']); expect(st.terms.map((x) => x.name)).toEqual(['Cohort 1'])
    expect(sc.demoSaveCohort(id, { id: null, name: 'Cohort 2', startsOn: '2027-02-01', endsOn: '2027-05-30', current: true })).toBeNull()
    st = sc.demoStructure(id)
    expect(st.sessions.map((x) => x.name).sort()).toEqual(['Cohort 1', 'Cohort 2']); expect(st.terms.map((x) => x.name).sort()).toEqual(['Cohort 1', 'Cohort 2'])
    expect(st.terms.find((x) => x.name === 'Cohort 2')!.current).toBe(true)
    expect(sc.demoSaveCohort(id, { id: null, name: 'Cohort 2', startsOn: '2027-02-01', endsOn: '2027-05-30', current: false })).toMatch(/already exists/)
    const c2 = st.sessions.find((x) => x.name === 'Cohort 2')!
    expect(sc.demoDeleteSession(id, c2.id)).toBeNull()
    expect(sc.demoStructure(id).sessions.map((x) => x.name)).toEqual(['Cohort 1'])
    expect(sc.demoDeleteTerm(id, sc.demoStructure(id).terms[0].id)).toBeNull()
  })
})
