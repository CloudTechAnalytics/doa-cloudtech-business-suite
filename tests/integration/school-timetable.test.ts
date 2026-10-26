import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, teacher: string, teacher2: string, parent: string, parentB: string, outsider: string
let biz: string
let p1: string, p2: string, jss1: string, english: string, maths: string, physics: string
let staff1: string, staff2: string
let per: string[] = []
let n = 0
const key = () => `tt-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = (v: unknown) => JSON.stringify(v)
const slot = (u: string, cls: string, day: number, period: string, subject: string | null, staff: string | null, room: string | null = null) =>
  as(u, () => q('select public.school_set_slot($1,$2,$3,$4,$5,$6,$7)', [biz, cls, day, period, subject, staff, room]))
const lessonsSeenBy = async (u: string) => (await as(u, () => q<{ class_id: string; day: number }>('select class_id, day from public.school_timetable where business_id = $1', [biz])))

beforeAll(async () => {
  db = await createDb()
  ;[owner, teacher, teacher2, parent, parentB, outsider] = await Promise.all(['o', 't1', 't2', 'p1', 'p2', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, email, role] of [[teacher, 't1@example.com', 'teacher'], [teacher2, 't2@example.com', 'teacher'], [parent, 'p1@example.com', 'parent'], [parentB, 'p2@example.com', 'parent']] as const) {
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  await as(owner, () => q(`select public.school_setup($1,'combined','2026/2027',current_date - 20)`, [biz]))
  const cls = async (name: string) => (await q<{ id: string }>('select id from public.school_classes where business_id=$1 and name=$2', [biz, name]))[0].id
  const sub = async (name: string) => (await q<{ id: string }>('select id from public.school_subjects where business_id=$1 and name=$2', [biz, name]))[0].id
  ;[p1, p2, jss1] = [await cls('Primary 1'), await cls('Primary 2'), await cls('JSS 1')]
  ;[english, maths, physics] = [await sub('English Language'), await sub('Mathematics'), await sub('Physics')]
  staff1 = (await as(owner, () => q<{ id: string }>(`select public.school_save_staff($1,null,'Mr One',null,'t1@example.com','Teacher',null,true) as id`, [biz])))[0].id
  staff2 = (await as(owner, () => q<{ id: string }>(`select public.school_save_staff($1,null,'Mrs Two',null,'t2@example.com','Teacher',null,true) as id`, [biz])))[0].id
  await as(owner, () => q('select public.school_set_assignments($1,$2,$3::jsonb)', [biz, staff1, J([{ class_id: p1, subject_id: english }, { class_id: p2, subject_id: english }])]))
  await as(owner, () => q('select public.school_set_assignments($1,$2,$3::jsonb)', [biz, staff2, J([{ class_id: p2, subject_id: maths }])]))
  await as(teacher, () => q('select public.school_claim_links($1)', [biz]))
  await as(teacher2, () => q('select public.school_claim_links($1)', [biz]))
  await as(owner, () => q('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4)', [biz, J({ first: 'Ada', last: 'Obi', class_id: p1 }), J([{ name: 'Mrs Obi', email: 'p1@example.com', relationship: 'mother', primary: true }]), key()]))
  await as(owner, () => q('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4)', [biz, J({ first: 'Bayo', last: 'Ade', class_id: p2 }), J([{ name: 'Mr Ade', email: 'p2@example.com', relationship: 'father', primary: true }]), key()]))
  await as(parent, () => q('select public.school_claim_links($1)', [biz]))
  await as(parentB, () => q('select public.school_claim_links($1)', [biz]))
})

describe('the periods of the school day', () => {
  const day = [
    { label: 'Period 1', starts: '08:00', ends: '08:40' }, { label: 'Period 2', starts: '08:40', ends: '09:20' },
    { label: 'Break', starts: '09:20', ends: '09:40', is_break: true }, { label: 'Period 3', starts: '09:40', ends: '10:20' },
  ]
  it('can only be set by people who manage the school', async () => {
    await expect(as(teacher, () => q('select public.school_save_periods($1,$2::jsonb)', [biz, J(day)]))).rejects.toThrow(/permission denied/)
    await expect(as(parent, () => q('select public.school_save_periods($1,$2::jsonb)', [biz, J(day)]))).rejects.toThrow(/permission denied/)
    await expect(as(outsider, () => q('select public.school_save_periods($1,$2::jsonb)', [biz, J(day)]))).rejects.toThrow(/permission denied/)
  })

  it('must make sense: named, ending after they start, and not overlapping', async () => {
    const bad = (periods: object[]) => as(owner, () => q('select public.school_save_periods($1,$2::jsonb)', [biz, J(periods)]))
    await expect(bad([])).rejects.toThrow(/between 1 and 30/)
    await expect(bad([{ label: '', starts: '08:00', ends: '08:40' }])).rejects.toThrow(/needs a name/)
    await expect(bad([{ label: 'P1', starts: '09:00', ends: '08:00' }])).rejects.toThrow(/end after it starts/)
    await expect(bad([{ label: 'P1', starts: '08:00', ends: '09:00' }, { label: 'P2', starts: '08:30', ends: '09:30' }])).rejects.toThrow(/before the one above/)
  })

  it('are saved in order and everyone in the school can read them', async () => {
    await as(owner, () => q('select public.school_save_periods($1,$2::jsonb)', [biz, J(day)]))
    const list = await as(teacher, () => q<{ id: string; label: string; is_break: boolean }>('select id, label, is_break from public.school_periods where business_id=$1 order by position', [biz]))
    expect(list.map((x) => x.label)).toEqual(['Period 1', 'Period 2', 'Break', 'Period 3'])
    per = list.map((x) => x.id)
    expect(await as(outsider, () => q('select * from public.school_periods'))).toHaveLength(0)
  })
})

describe('putting lessons in the timetable', () => {
  it('only for school managers, in a real period of a school day', async () => {
    await expect(slot(teacher, p1, 1, per[0], english, staff1)).rejects.toThrow(/permission denied/)
    await expect(slot(owner, p1, 1, per[2], english, staff1)).rejects.toThrow(/break cannot have a lesson/)
    await expect(slot(owner, p1, 6, per[0], english, staff1)).rejects.toThrow(/not a school day/)
    await expect(slot(owner, p1, 1, '00000000-0000-0000-0000-000000000000', english, staff1)).rejects.toThrow(/period not found/)
  })

  it('only subjects the class takes, taught by a teacher assigned to them', async () => {
    await expect(slot(owner, p1, 1, per[0], physics, null)).rejects.toThrow(/does not take that subject/) // Physics is a senior secondary subject
    await expect(slot(owner, p1, 1, per[0], maths, staff1)).rejects.toThrow(/not assigned to this subject/)
    await slot(owner, p1, 1, per[0], english, staff1, 'Room 1')
    const row = (await q<{ room: string; staff_id: string }>('select room, staff_id from public.school_timetable where class_id=$1 and day=1 and period_id=$2', [p1, per[0]]))[0]
    expect(row).toMatchObject({ room: 'Room 1', staff_id: staff1 })
  })

  it('replaces what is in a slot, and empties it when no subject is given', async () => {
    await slot(owner, p1, 1, per[0], english, null, null)
    expect((await q<{ staff_id: string | null }>('select staff_id from public.school_timetable where class_id=$1 and day=1 and period_id=$2', [p1, per[0]]))[0].staff_id).toBeNull()
    await slot(owner, p1, 1, per[0], english, staff1)
    await slot(owner, p1, 1, per[0], null, null)
    expect(await q('select 1 from public.school_timetable where class_id=$1 and day=1 and period_id=$2', [p1, per[0]])).toHaveLength(0)
    await slot(owner, p1, 1, per[0], english, staff1)
  })

  it('never puts a teacher in two classes at once', async () => {
    await expect(slot(owner, p2, 1, per[0], english, staff1)).rejects.toThrow(/already has a lesson at this time/)
    await slot(owner, p2, 1, per[1], maths, staff2) // a different period is fine
    await slot(owner, p2, 2, per[0], english, staff1) // and so is a different day
  })

  it('will not let a period that is in use be removed or turned into a break', async () => {
    await expect(as(owner, () => q('select public.school_save_periods($1,$2::jsonb)', [biz, J([{ id: per[1], label: 'Period 2', starts: '08:40', ends: '09:20' }])]))).rejects.toThrow(/has lessons/)
    await expect(as(owner, () => q('select public.school_save_periods($1,$2::jsonb)', [biz, J([{ id: per[0], label: 'Period 1', starts: '08:00', ends: '08:40', is_break: true }, { id: per[1], label: 'Period 2', starts: '08:40', ends: '09:20' }, { id: per[3], label: 'Period 3', starts: '09:40', ends: '10:20' }, { id: per[2], label: 'Break', starts: '10:20', ends: '10:40', is_break: true }])]))).rejects.toThrow(/cannot become a break/)
  })
})

describe('who can see which timetable', () => {
  it('shows a manager every class', async () => {
    expect(new Set((await lessonsSeenBy(owner)).map((r) => r.class_id))).toEqual(new Set([p1, p2]))
  })

  it('shows a teacher the classes they teach and nothing else', async () => {
    expect(new Set((await lessonsSeenBy(teacher)).map((r) => r.class_id))).toEqual(new Set([p1, p2])) // Mr One teaches English in both
    expect(new Set((await lessonsSeenBy(teacher2)).map((r) => r.class_id))).toEqual(new Set([p2])) // Mrs Two teaches only Primary 2
  })

  it('shows a parent only their own child\'s class', async () => {
    expect(new Set((await lessonsSeenBy(parent)).map((r) => r.class_id))).toEqual(new Set([p1]))
    expect(new Set((await lessonsSeenBy(parentB)).map((r) => r.class_id))).toEqual(new Set([p2]))
  })

  it('shows people outside the school nothing, and nobody can change a lesson directly', async () => {
    expect(await lessonsSeenBy(outsider)).toHaveLength(0)
    await expect(as(owner, () => q(`delete from public.school_timetable where business_id = $1`, [biz]))).rejects.toThrow()
    await expect(as(teacher, () => q(`update public.school_timetable set room = 'Hacked' where business_id = $1`, [biz]))).rejects.toThrow()
    expect(jss1).toBeTruthy()
  })
})
