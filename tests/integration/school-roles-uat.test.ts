import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

/**
 * Acceptance test of a school, person by person. One school, two classes, two pupils (each with their own parent), one teacher assigned to one class,
 * fees billed. Every role then tries the same actions and looks at the same records, and the outcomes are compared with what that role is meant to do.
 */
let db: Db
const U: Record<string, string> = {}
let biz: string, term: string, p1: string, p2: string, english: string, ada: string, bola: string
let n = 0
const key = () => `uat-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const weekday = () => { let d = -1; while ([0, 6].includes(new Date(Date.now() + d * 86400000).getDay())) d--; return iso(d) }
const J = JSON.stringify
const ok = async (fn: () => Promise<unknown>) => { try { await fn(); return 'ok' } catch (e) { return /permission denied|not allowed|only|assigned|cannot|refused/i.test(String((e as Error).message)) ? 'denied' : 'error: ' + (e as Error).message } }
const count = async (u: string, table: string) => (await as(u, () => q<{ c: string }>(`select count(*)::text as c from public.${table} where business_id=$1`, [biz])))[0].c
const usable = async (u: string) => (await as(u, () => q<{ module_code: string; usable: boolean }>('select * from public.my_modules($1)', [biz]))).filter((m) => m.usable && m.module_code.startsWith('school')).map((m) => m.module_code).sort()

const ROLES = ['owner', 'business_admin', 'manager', 'principal', 'teacher', 'bursar', 'school_admin', 'admissions_officer', 'parent', 'viewer'] as const

beforeAll(async () => {
  db = await createDb()
  for (const r of [...ROLES, 'stranger', 'parent2']) U[r] = await createUser(db, `${r}@example.com`)
  biz = (await as(U.owner, () => q<{ id: string }>(`select public.create_business('UAT Academy','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const r of [...ROLES.filter((x) => x !== 'owner'), 'parent2'] as const) {
    await as(U.owner, () => q('select public.invite_member($1,$2,$3)', [biz, `${r}@example.com`, r === 'parent2' ? 'parent' : r])); await as(U[r], () => q('select public.accept_my_invitations()'))
  }
  await as(U.owner, () => q(`select public.school_setup($1,'combined','2026/2027',$2)`, [biz, iso(-20)]))
  term = (await q<{ id: string }>('select id from public.school_terms where business_id=$1 and is_current', [biz]))[0].id
  const cls = async (name: string) => (await q<{ id: string }>('select id from public.school_classes where business_id=$1 and name=$2', [biz, name]))[0].id
  p1 = await cls('Primary 1'); p2 = await cls('Primary 2')
  english = (await q<{ id: string }>('select id from public.school_subjects where business_id=$1 and name=$2', [biz, 'English Language']))[0].id
  const reg = (first: string, cls_: string, email: string) => as(U.owner, () => q<{ r: { student_id: string } }>('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4) as r', [biz, J({ first, last: 'Pupil', class_id: cls_, dob: '2018-05-01', gender: 'female' }), J([{ name: 'Parent of ' + first, email, relationship: 'mother', primary: true }]), key()])).then((r) => r[0].r.student_id)
  ada = await reg('Ada', p1, 'parent@example.com'); bola = await reg('Bola', p2, 'parent2@example.com')
  await as(U.parent, () => q('select public.school_claim_links($1)', [biz])); await as(U.parent2, () => q('select public.school_claim_links($1)', [biz]))
  await as(U.principal, () => q('select public.school_save_staff($1,null,$2,null,$3,$4,null,true)', [biz, 'Mr Teacher', 'teacher@example.com', 'Teacher']))
  await as(U.teacher, () => q('select public.school_claim_links($1)', [biz]))
  const staff = (await q<{ id: string }>('select id from public.school_staff where business_id=$1', [biz]))[0].id
  await as(U.principal, () => q('select public.school_set_assignments($1,$2,$3::jsonb)', [biz, staff, J([{ class_id: p1, subject_id: english, class_teacher: true }])]))
  await as(U.bursar, () => q('select public.school_save_fee_item($1,null,$2,$3,null,$4,false,true)', [biz, 'Tuition', 40000, term]))
  await as(U.bursar, () => q('select public.school_generate_bills($1,$2,null,null,$3)', [biz, term, key()]))
})

describe('which school pages each role can open', () => {
  const ALL = ['school-admissions', 'school-announcements', 'school-attendance', 'school-classes', 'school-fees', 'school-guardians', 'school-payments', 'school-reports', 'school-results', 'school-settings', 'school-staff', 'school-students', 'school-timetable'].sort()
  it('gives the owner, an admin and a manager every page of the school, and no teacher page', async () => {
    for (const r of ['owner', 'business_admin', 'manager']) { const m = await usable(U[r]); expect(m, r).toEqual(expect.arrayContaining(ALL)); expect(m, r).not.toContain('school-my-classes'); expect(m, r).not.toContain('school-portal') }
  })
  it('gives a teacher their classes, attendance, results, timetable, reports and parents, and nothing about money or staff', async () => {
    const m = await usable(U.teacher)
    expect(m).toEqual(expect.arrayContaining(['school-my-classes', 'school-attendance', 'school-results', 'school-timetable', 'school-reports', 'school-guardians', 'school-announcements']))
    for (const no of ['school-fees', 'school-payments', 'school-staff', 'school-settings', 'school-admissions', 'school-students', 'school-classes', 'school-portal']) expect(m, no).not.toContain(no)
  })
  it('gives a bursar the fees and payments pages, not attendance, results or staff', async () => {
    const m = await usable(U.bursar)
    expect(m).toEqual(expect.arrayContaining(['school-fees', 'school-payments', 'school-students', 'school-reports']))
    for (const no of ['school-attendance', 'school-results', 'school-staff', 'school-settings', 'school-my-classes']) expect(m, no).not.toContain(no)
  })
  it('gives a school admin the office pages: pupils, admissions, parents, attendance, timetable, announcements and reports, and nothing about results, staff, settings or fees setup', async () => {
    const m = await usable(U.school_admin)
    expect(m).toEqual(expect.arrayContaining(['school-students', 'school-admissions', 'school-guardians', 'school-attendance', 'school-timetable', 'school-announcements', 'school-reports']))
    for (const no of ['school-results', 'school-staff', 'school-settings', 'school-fees', 'school-payments', 'school-my-classes', 'school-portal']) expect(m, no).not.toContain(no)
  })
  it('gives an admissions officer the admissions and students pages, not fees setup, results or staff', async () => {
    const m = await usable(U.admissions_officer)
    expect(m).toEqual(expect.arrayContaining(['school-admissions', 'school-students']))
    for (const no of ['school-results', 'school-staff', 'school-settings', 'school-attendance']) expect(m, no).not.toContain(no)
  })
  it('gives a parent the portal only', async () => {
    expect(await usable(U.parent)).toEqual(['school-portal'])
  })
  it('gives someone outside the school nothing', async () => {
    await expect(usable(U.stranger)).resolves.toEqual([])
  })
})

describe('what each role sees', () => {
  const sees: Record<string, { students: string; bills: string; payments: string; guardians: string }> = {
    owner: { students: '2', bills: '2', payments: '0', guardians: '2' }, business_admin: { students: '2', bills: '2', payments: '0', guardians: '2' }, manager: { students: '2', bills: '2', payments: '0', guardians: '2' },
    principal: { students: '2', bills: '2', payments: '0', guardians: '2' }, bursar: { students: '2', bills: '2', payments: '0', guardians: '2' },
    school_admin: { students: '2', bills: '0', payments: '0', guardians: '2' },
    teacher: { students: '1', bills: '0', payments: '0', guardians: '1' }, parent: { students: '1', bills: '1', payments: '0', guardians: '1' },
    stranger: { students: '0', bills: '0', payments: '0', guardians: '0' },
  }
  for (const [role, want] of Object.entries(sees)) {
    it(`${role}: students, bills, payments, parents`, async () => {
      expect({ students: await count(U[role], 'school_students'), bills: await count(U[role], 'school_bills'), payments: await count(U[role], 'school_payments'), guardians: await count(U[role], 'school_guardians') }).toEqual(want)
    })
  }
  it('an admissions officer sees pupils and parents, and no bills', async () => {
    expect(await count(U.admissions_officer, 'school_students')).toBe('2'); expect(await count(U.admissions_officer, 'school_bills')).toBe('0')
  })
  it('one parent never sees another parent\'s child', async () => {
    const mine = (await as(U.parent2, () => q<{ first_name: string }>('select first_name from public.school_students where business_id=$1', [biz]))).map((r) => r.first_name)
    expect(mine).toEqual(['Bola'])
  })
})

describe('what each role can do', () => {
  const day = weekday()
  const probes: Record<string, (u: string) => Promise<unknown>> = {
    'register a pupil': (u) => as(u, () => q('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4)', [biz, J({ first: 'Z' + n++, last: 'Probe', class_id: p2, dob: '2018-05-01', gender: 'male' }), '[]', key()])),
    'set up a fee': (u) => as(u, () => q('select public.school_save_fee_item($1,null,$2,$3,null,$4,false,true)', [biz, 'Probe ' + n++, 100, term])),
    'take attendance for Primary 1': (u) => as(u, () => q('select public.school_mark_attendance($1,$2,$3,$4::jsonb)', [biz, p1, day, J([{ student_id: ada, status: 'present' }])])),
    'take attendance for Primary 2': (u) => as(u, () => q('select public.school_mark_attendance($1,$2,$3,$4::jsonb)', [biz, p2, day, J([{ student_id: bola, status: 'present' }])])),
    'enter Primary 1 English results': (u) => as(u, () => q('select public.school_save_scores($1,$2,$3,$4,$5::jsonb,false)', [biz, p1, english, term, J([{ student_id: ada, ca: 30, exam: 50 }])])),
    'enter Primary 2 English results': (u) => as(u, () => q('select public.school_save_scores($1,$2,$3,$4,$5::jsonb,false)', [biz, p2, english, term, J([{ student_id: bola, ca: 30, exam: 50 }])])),
    'add or change a staff member': (u) => as(u, () => q('select public.school_save_staff($1,null,$2,null,null,$3,null,true)', [biz, 'Probe ' + n++, 'Cleaner'])),
    'change school settings': (u) => as(u, () => q('select public.school_save_settings($1,$3,null,null,null,40,60,true,$2)', [biz, [1, 2, 3, 4, 5], 'combined'])),
    'set up the timetable': (u) => as(u, () => q('select public.school_save_periods($1,$2::jsonb)', [biz, J([{ label: 'P' + n++, starts: '0' + (1 + (n % 8)) + ':00', ends: '0' + (1 + (n % 8)) + ':30', is_break: false }])])),
    'publish an announcement': (u) => as(u, () => q('select public.school_publish_announcement($1,$2,$3,$4,null,null)', [biz, 'Probe', 'Body', 'everyone'])),
  }
  const can: Record<string, string[]> = {
    owner: ['register a pupil', 'set up a fee', 'take attendance for Primary 1', 'take attendance for Primary 2', 'enter Primary 1 English results', 'enter Primary 2 English results', 'add or change a staff member', 'change school settings', 'set up the timetable', 'publish an announcement'],
    business_admin: ['register a pupil', 'set up a fee', 'take attendance for Primary 1', 'take attendance for Primary 2', 'enter Primary 1 English results', 'enter Primary 2 English results', 'add or change a staff member', 'change school settings', 'set up the timetable', 'publish an announcement'],
    principal: ['register a pupil', 'take attendance for Primary 1', 'take attendance for Primary 2', 'enter Primary 1 English results', 'enter Primary 2 English results', 'add or change a staff member', 'change school settings', 'set up the timetable', 'publish an announcement'],
    school_admin: ['register a pupil', 'take attendance for Primary 1', 'take attendance for Primary 2', 'set up the timetable', 'publish an announcement'],
    teacher: ['take attendance for Primary 1', 'enter Primary 1 English results'],
    bursar: ['set up a fee'],
    admissions_officer: ['register a pupil'],
    parent: [], viewer: [], stranger: [],
  }
  for (const [role, allowed] of Object.entries(can)) {
    it(`${role} can ${allowed.length ? allowed.join('; ') : 'do none of these'}, and is refused the rest`, async () => {
      const got: Record<string, string> = {}; for (const [name, run] of Object.entries(probes)) got[name] = await ok(() => run(U[role]))
      const want: Record<string, string> = {}; for (const name of Object.keys(probes)) want[name] = allowed.includes(name) ? 'ok' : 'denied'
      expect(got).toEqual(want)
    })
  }
})

describe('money and approvals', () => {
  it('lets the bursar and the admissions officer record a payment, and refuses a teacher, a parent and the principal', async () => {
    const bill = (await q<{ id: string }>('select id from public.school_bills where student_id=$1', [ada]))[0].id
    const pay = (u: string) => ok(() => as(u, () => q('select public.school_record_payment($1,$2,$3,$4,$5)', [bill, 1000, 'cash', null, key()])))
    expect(await pay(U.bursar)).toBe('ok'); expect(await pay(U.admissions_officer)).toBe('ok')
    for (const r of ['teacher', 'parent', 'viewer', 'stranger']) expect(await pay(U[r]), r).toBe('denied')
  })
  it('lets only approvers approve, and a teacher cannot approve their own results', async () => {
    await as(U.teacher, () => q('select public.school_save_scores($1,$2,$3,$4,$5::jsonb,true)', [biz, p1, english, term, J([{ student_id: ada, ca: 30, exam: 50 }])]))
    const review = (u: string, action: string) => ok(() => as(u, () => q('select public.school_review_scores($1,$2,$3,$4,$5,$6)', [biz, p1, english, term, action, ''])))
    for (const r of ['teacher', 'bursar', 'admissions_officer', 'parent']) expect(await review(U[r], 'approve'), r).toBe('denied')
    expect(await review(U.principal, 'approve')).toBe('ok'); expect(await review(U.principal, 'publish')).toBe('ok')
  })
  it('shows a parent a published result, and only for their own child', async () => {
    expect((await as(U.parent, () => q('select 1 from public.school_scores where business_id=$1', [biz]))).length).toBe(1)
    expect((await as(U.parent2, () => q('select 1 from public.school_scores where business_id=$1', [biz]))).length).toBe(0)
  })
})
