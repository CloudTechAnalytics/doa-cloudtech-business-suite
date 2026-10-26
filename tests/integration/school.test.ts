import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, principal: string, teacher: string, teacher2: string, bursar: string, parent: string, parent2: string, officer: string, outsider: string
let biz: string, bizB: string, term: string, session: string
let p1: string, p2: string, jss1: string, english: string, maths: string
let ada: string, bola: string, chidi: string
let n = 0
const key = () => `sc-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string | null, fn: () => Promise<T>) => asUser(db, u, fn)
const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const weekday = (offset: number) => { let d = offset; while ([0, 6].includes(new Date(Date.now() + d * 86400000).getDay())) d--; return iso(d) }
const num = async (sql: string, params: unknown[] = []) => Number((await q<{ v: string }>(sql, params))[0].v)

const register = (u: string, first: string, last: string, cls: string, guardians: object[] = [], b = biz) =>
  as(u, () => q<{ r: { student_id: string; admission_no: string } }>('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4) as r', [b, JSON.stringify({ first, last, class_id: cls, dob: '2018-05-01', gender: 'female' }), JSON.stringify(guardians), key()])).then((r) => r[0].r)
const mark = (u: string, cls: string, date: string, rowsIn: { student_id: string; status: string }[]) => as(u, () => q('select public.school_mark_attendance($1,$2,$3,$4::jsonb)', [biz, cls, date, JSON.stringify(rowsIn)]))
const scores = (u: string, cls: string, subject: string, rowsIn: object[], submit = false) => as(u, () => q('select public.school_save_scores($1,$2,$3,$4,$5::jsonb,$6)', [biz, cls, subject, term, JSON.stringify(rowsIn), submit]))
const review = (u: string, cls: string, subject: string, action: string, note = '') => as(u, () => q('select public.school_review_scores($1,$2,$3,$4,$5,$6)', [biz, cls, subject, term, action, note]))
const pay = (u: string, bill: string, amount: number, k = key()) => as(u, () => q<{ r: { receipt_number: string; balance: number } }>('select public.school_record_payment($1,$2,$3,$4,$5) as r', [bill, amount, 'cash', null, k])).then((r) => r[0].r)
const bill = (student: string) => q<{ id: string; total: string }>('select id, total from public.school_bills where student_id=$1 and term_id=$2', [student, term]).then((r) => r[0])

beforeAll(async () => {
  db = await createDb()
  ;[owner, principal, teacher, teacher2, bursar, parent, parent2, officer, outsider] = await Promise.all(['o', 'p', 't', 't2', 'b', 'pa', 'pb', 'ao', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright Future Academy','school') as id`)))[0].id
  bizB = (await as(outsider, () => q<{ id: string }>(`select public.create_business('Other School','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, role] of [[principal, 'principal'], [teacher, 'teacher'], [teacher2, 'teacher'], [bursar, 'bursar'], [parent, 'parent'], [parent2, 'parent'], [officer, 'admissions_officer']] as const) {
    const email = (await q<{ email: string }>('select email from auth.users where id=$1', [u]))[0].email
    await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role]))
    await as(u, () => q('select public.accept_my_invitations()'))
  }
  await as(owner, () => q(`select public.school_setup($1,'combined','2026/2027',$2)`, [biz, iso(-20)]))
  await as(outsider, () => q(`select public.school_setup($1,'primary','2026/2027',$2)`, [bizB, iso(-20)]))
  term = (await q<{ id: string }>('select id from public.school_terms where business_id=$1 and is_current', [biz]))[0].id
  session = (await q<{ id: string }>('select id from public.school_sessions where business_id=$1 and is_current', [biz]))[0].id
  const cls = async (name: string) => (await q<{ id: string }>('select id from public.school_classes where business_id=$1 and name=$2', [biz, name]))[0].id
  p1 = await cls('Primary 1'); p2 = await cls('Primary 2'); jss1 = await cls('JSS 1')
  const sub = async (name: string) => (await q<{ id: string }>('select id from public.school_subjects where business_id=$1 and name=$2', [biz, name]))[0].id
  english = await sub('English Language'); maths = await sub('Mathematics')
})

describe('school setup', () => {
  it('starts from the standard structure, with editable classes, three terms, grades and one current term', async () => {
    expect(await num('select count(*) as v from public.school_classes where business_id=$1', [biz])).toBe(14)
    expect(await num('select count(*) as v from public.school_terms where business_id=$1', [biz])).toBe(3)
    expect(await num('select count(*) as v from public.school_grade_bands where business_id=$1', [biz])).toBe(6)
    expect(await num('select count(*) as v from public.school_terms where business_id=$1 and is_current', [biz])).toBe(1)
    await expect(as(owner, () => q(`select public.school_setup($1,'combined','x',null)`, [biz]))).rejects.toThrow(/already has classes/)
    await as(owner, () => q(`select public.school_save_class($1,null,'Reception',0,null,true,'primary')`, [biz]))
    await expect(as(owner, () => q(`select public.school_save_class($1,null,'reception',0,null,true,'primary')`, [biz]))).resolves.toBeTruthy() // names compare exactly; a different spelling is a different class
    await expect(as(owner, () => q(`select public.school_save_class($1,null,'Reception',0,null,true,'primary')`, [biz]))).rejects.toThrow(/duplicate key/)
  })

  it('lets only people who manage the school change setup', async () => {
    await expect(as(teacher, () => q(`select public.school_save_subject($1,null,'Art',null)`, [biz]))).rejects.toThrow(/permission denied/)
    await expect(as(parent, () => q(`select public.school_save_class($1,null,'Hacked',0,null,true,'primary')`, [biz]))).rejects.toThrow(/permission denied/)
    await expect(as(outsider, () => q(`select public.school_save_class($1,null,'Hacked',0,null,true,'primary')`, [biz]))).rejects.toThrow(/permission denied/)
    await as(principal, () => q(`select public.school_save_subject($1,null,'Agric',null)`, [biz]))
  })

  it('validates the assessment marks and the grade bands', async () => {
    await expect(as(owner, () => q('select public.school_save_settings($1,$2,null,null,null,$3,$4,false,$5)', [biz, 'combined', 0, 0, '{1,2,3,4,5}']))).rejects.toThrow(/add up to more than zero/)
    await expect(as(owner, () => q('select public.school_save_settings($1,$2,null,null,null,$3,$4,false,$5)', [biz, 'combined', 40, 60, '{9}']))).rejects.toThrow(/days the school is open/)
    await expect(as(owner, () => q(`select public.school_save_grades($1,$2::jsonb)`, [biz, JSON.stringify([{ min: 50, grade: 'P' }, { min: 20, grade: 'F' }])]))).rejects.toThrow(/start at 0/)
    await as(owner, () => q('select public.school_save_settings($1,$2,null,null,null,$3,$4,false,$5)', [biz, 'combined', 30, 70, '{1,2,3,4,5}']))
    await as(owner, () => q('select public.school_save_settings($1,$2,null,null,null,$3,$4,false,$5)', [biz, 'combined', 40, 60, '{1,2,3,4,5}']))
  })
})

describe('students, guardians and admissions', () => {
  it('registers students with unique admission numbers and links a parent to several children', async () => {
    const a = await register(officer, 'Ada', 'Obi', p1, [{ name: 'Mrs Obi', phone: '0803', email: 'pa@example.com', relationship: 'mother', primary: true }])
    const b = await register(officer, 'Bola', 'Obi', p1, [{ name: 'Mrs Obi', phone: '0803', email: 'pa@example.com', relationship: 'mother', primary: true }])
    const c = await register(officer, 'Chidi', 'Eze', p2, [{ name: 'Mr Eze', phone: '0805', email: 'pb@example.com' }])
    ada = a.student_id; bola = b.student_id; chidi = c.student_id
    expect(new Set([a.admission_no, b.admission_no, c.admission_no]).size).toBe(3)
    expect(await num('select count(*) as v from public.school_guardians where business_id=$1 and phone=$2', [biz, '0803'])).toBe(1) // one parent, two children
    expect(await num('select count(*) as v from public.school_student_guardians where guardian_id=(select id from public.school_guardians where phone=$1 and business_id=$2)', ['0803', biz])).toBe(2)
    expect(await num('select count(*) as v from public.school_enrollments where student_id=$1 and ended_on is null', [ada])).toBe(1)
  })

  it('repeats a registration safely and refuses bad input', async () => {
    const k = key()
    const run = () => as(officer, () => q<{ r: { student_id: string } }>('select public.school_register_student($1,$2::jsonb,null,$3) as r', [biz, JSON.stringify({ first: 'Dayo', last: 'Ade', class_id: p1 }), k])).then((r) => r[0].r.student_id)
    expect(await run()).toBe(await run())
    await expect(register(officer, '', 'Ade', p1)).rejects.toThrow(/first and last name/)
    await expect(as(officer, () => q('select public.school_register_student($1,$2::jsonb,null,$3)', [biz, JSON.stringify({ first: 'Fut', last: 'Ure', dob: iso(5), class_id: p1 }), key()]))).rejects.toThrow(/future/)
    await expect(register(teacher, 'Nope', 'Nope', p1)).rejects.toThrow(/permission denied/)
    await expect(register(parent, 'Nope', 'Nope', p1)).rejects.toThrow(/permission denied/)
  })

  it('lets a parent see only their own children after claiming the link, and no one else', async () => {
    expect(await as(parent, () => q<{ r: number }>('select public.school_claim_links($1) as r', [biz]))).toBeTruthy()
    await as(parent2, () => q('select public.school_claim_links($1)', [biz]))
    const mine = await as(parent, () => q<{ id: string }>('select id from public.school_students where business_id=$1', [biz]))
    expect(mine.map((s) => s.id).sort()).toEqual([ada, bola].sort())
    expect((await as(parent2, () => q<{ id: string }>('select id from public.school_students where business_id=$1', [biz]))).map((s) => s.id)).toEqual([chidi])
    expect(await as(parent, () => q('select * from public.school_students where id=$1', [chidi]))).toHaveLength(0)
    expect(await as(outsider, () => q('select * from public.school_students where business_id=$1', [biz]))).toHaveLength(0)
    expect(await as(parent, () => q('select * from public.school_guardians where business_id=$1 and phone=$2', [biz, '0805']))).toHaveLength(0)
  })

  it('accepts an application into a class with a number and an admission bill, and records a rejection with its reason', async () => {
    await as(bursar, () => q('select public.school_save_fee_item($1,null,$2,$3,null,null,true,true)', [biz, 'Registration', 5000]))
    const a = (await as(officer, () => q<{ r: { admission_id: string } }>('select public.school_apply($1,$2::jsonb,$3) as r', [biz, JSON.stringify({ first: 'Emeka', last: 'Nwosu', class_id: p2, guardian_name: 'Mr Nwosu', guardian_phone: '0807' }), key()])))[0].r.admission_id
    const r = (await as(officer, () => q<{ r: { status: string; student_id: string; admission_no: string } }>('select public.school_decide_admission($1,$2,null,null) as r', [a, 'accept'])))[0].r
    expect(r.status).toBe('accepted')
    expect(r.admission_no).toMatch(/^ADM-/)
    expect(await num('select total as v from public.school_bills where student_id=$1', [r.student_id])).toBe(5000)
    await expect(as(officer, () => q('select public.school_decide_admission($1,$2,null,null)', [a, 'accept']))).rejects.toThrow(/already been accepted/)
    const b = (await as(officer, () => q<{ r: { admission_id: string } }>('select public.school_apply($1,$2::jsonb,$3) as r', [biz, JSON.stringify({ first: 'Late', last: 'Comer', guardian_name: 'Mr Comer' }), key()])))[0].r.admission_id
    await expect(as(officer, () => q('select public.school_decide_admission($1,$2,null,null)', [b, 'reject']))).rejects.toThrow(/why/)
    await as(officer, () => q('select public.school_decide_admission($1,$2,null,$3)', [b, 'reject', 'No space in the class']))
    expect((await q<{ status: string }>('select status from public.school_admissions where id=$1', [b]))[0].status).toBe('rejected')
    await expect(as(teacher, () => q('select * from public.school_admissions where business_id=$1', [biz]))).resolves.toHaveLength(0)
  })
})

describe('attendance', () => {
  beforeAll(async () => {
    const staff = (await as(owner, () => q<{ id: string }>(`select public.school_save_staff($1,null,'Mr Teacher',null,'t@example.com','Teacher',null,true) as id`, [biz])))[0].id
    await as(owner, () => q('select public.school_set_assignments($1,$2,$3::jsonb)', [biz, staff, JSON.stringify([{ class_id: p1, subject_id: null, class_teacher: true }, { class_id: p1, subject_id: english }, { class_id: p1, subject_id: maths }])]))
    await as(teacher, () => q('select public.school_claim_links($1)', [biz]))
    const staff2 = (await as(owner, () => q<{ id: string }>(`select public.school_save_staff($1,null,'Mrs Other',null,'t2@example.com','Teacher',null,true) as id`, [biz])))[0].id
    await as(owner, () => q('select public.school_set_assignments($1,$2,$3::jsonb)', [biz, staff2, JSON.stringify([{ class_id: p2, subject_id: english }])]))
    await as(teacher2, () => q('select public.school_claim_links($1)', [biz]))
  })

  it('lets a teacher mark their own class, and rejects duplicates by updating the same record', async () => {
    const day = weekday(-1)
    await mark(teacher, p1, day, [{ student_id: ada, status: 'present' }, { student_id: bola, status: 'absent' }])
    expect(await num('select count(*) as v from public.school_attendance where on_date=$1 and class_id=$2', [day, p1])).toBe(2)
    // marking the same student and day again is not a second record: it is refused to the teacher (a correction needs a manager) and never duplicates
    await expect(mark(teacher, p1, day, [{ student_id: ada, status: 'present' }, { student_id: bola, status: 'present' }])).rejects.toThrow(/can only be corrected/)
    expect(await num('select count(*) as v from public.school_attendance where student_id=$1 and on_date=$2', [ada, day])).toBe(1)
  })

  it('refuses a class the teacher is not assigned to, future dates, weekends and holidays', async () => {
    await expect(mark(teacher, p2, weekday(-1), [{ student_id: chidi, status: 'present' }])).rejects.toThrow(/assigned to you/)
    await expect(mark(owner, p1, iso(2), [{ student_id: ada, status: 'present' }])).rejects.toThrow(/future/)
    const sunday = iso(-((new Date().getDay() + 7) % 7 || 7))
    await expect(mark(owner, p1, sunday, [{ student_id: ada, status: 'present' }])).rejects.toThrow(/not open/)
    const hol = weekday(-10)
    await as(owner, () => q(`select public.school_save_holiday($1,$2,'Founders Day')`, [biz, hol]))
    await expect(mark(owner, p1, hol, [{ student_id: ada, status: 'present' }])).rejects.toThrow(/holiday/)
    await expect(mark(owner, p1, weekday(-1), [{ student_id: chidi, status: 'present' }])).rejects.toThrow(/member of this class/)
    await expect(mark(parent, p1, weekday(-1), [{ student_id: ada, status: 'present' }])).rejects.toThrow(/permission denied/)
  })

  it('lets someone who manages the school correct a saved mark, and keeps the change in the audit log', async () => {
    const day = weekday(-1)
    await mark(owner, p1, day, [{ student_id: bola, status: 'excused' }])
    expect((await q<{ status: string }>('select status from public.school_attendance where student_id=$1 and on_date=$2', [bola, day]))[0].status).toBe('excused')
    expect(await num(`select count(*) as v from public.audit_logs where action='school_attendance.update'`)).toBeGreaterThan(0)
  })

  it('shows teachers only their classes and parents only their children', async () => {
    expect(await as(teacher, () => q('select 1 from public.school_students where class_id=$1', [p2]))).toHaveLength(0)
    expect((await as(teacher, () => q('select 1 from public.school_students where class_id=$1', [p1]))).length).toBeGreaterThan(0)
    expect((await as(parent, () => q<{ student_id: string }>('select student_id from public.school_attendance where business_id=$1', [biz]))).every((r) => [ada, bola].includes(r.student_id))).toBe(true)
  })
})

describe('results and report cards', () => {
  it('validates scores against the configured maximums', async () => {
    await expect(scores(teacher, p1, english, [{ student_id: ada, ca: 41, exam: 50 }])).rejects.toThrow(/between 0 and 40/)
    await expect(scores(teacher, p1, english, [{ student_id: ada, ca: 30, exam: 61 }])).rejects.toThrow(/between 0 and 60/)
    await expect(scores(teacher, p1, english, [{ student_id: ada, ca: 30, exam: null }], true)).rejects.toThrow(/before submitting/)
  })

  it('lets a teacher save drafts and submit only for their own subject and class', async () => {
    await scores(teacher, p1, english, [{ student_id: ada, ca: 30, exam: 50 }, { student_id: bola, ca: 20, exam: 28 }])
    await expect(scores(teacher2, p1, english, [{ student_id: ada, ca: 1, exam: 1 }])).rejects.toThrow(/subjects you teach/)
    await expect(scores(teacher, p2, english, [{ student_id: chidi, ca: 1, exam: 1 }])).rejects.toThrow(/subjects you teach/)
    await scores(teacher, p1, english, [{ student_id: ada, ca: 32, exam: 50 }, { student_id: bola, ca: 20, exam: 28 }], true)
    await expect(scores(teacher, p1, english, [{ student_id: ada, ca: 40, exam: 60 }])).rejects.toThrow(/already submitted/)
  })

  it('needs an approver to approve and publish, and keeps parents from seeing anything before publication', async () => {
    await expect(review(teacher, p1, english, 'approve')).rejects.toThrow(/permission denied/)
    await expect(review(bursar, p1, english, 'approve')).rejects.toThrow(/permission denied/)
    await expect(review(principal, p1, english, 'publish')).rejects.toThrow(/no approved results/)
    expect(await as(parent, () => q('select * from public.school_scores where student_id=$1', [ada]))).toHaveLength(0)
    await review(principal, p1, english, 'approve')
    expect(await as(parent, () => q('select * from public.school_scores where student_id=$1', [ada]))).toHaveLength(0)
    await review(principal, p1, english, 'publish')
    expect(await as(parent, () => q('select * from public.school_scores where student_id=$1', [ada]))).toHaveLength(1)
    expect(await as(parent, () => q('select * from public.school_scores where student_id=$1', [chidi]))).toHaveLength(0)
  })

  it('gives a report card using the school grading rules, and parents see only published subjects', async () => {
    await scores(teacher, p1, maths, [{ student_id: ada, ca: 10, exam: 20 }], true)
    const card = (await as(principal, () => q<{ r: { subjects: { subject: string; total: number; grade: string }[]; average: number; attendance: { marked: number } } }>('select public.school_report_card($1,$2) as r', [ada, term])))[0].r
    expect(card.subjects.find((s) => s.subject === 'English Language')).toMatchObject({ total: 82, grade: 'A' })
    expect(card.subjects.find((s) => s.subject === 'Mathematics')).toMatchObject({ total: 30, grade: 'F' })
    expect(card.average).toBe(56)
    expect(card.attendance.marked).toBeGreaterThan(0)
    const parentCard = (await as(parent, () => q<{ r: { subjects: { subject: string }[] } }>('select public.school_report_card($1,$2) as r', [ada, term])))[0].r
    expect(parentCard.subjects.map((s) => s.subject)).toEqual(['English Language'])
    await expect(as(parent, () => q('select public.school_report_card($1,$2)', [chidi, term]))).rejects.toThrow(/permission denied/)
    await expect(as(outsider, () => q('select public.school_report_card($1,$2)', [ada, term]))).rejects.toThrow(/permission denied/)
  })

  it('records a correction of a published result with permission and an audit trail', async () => {
    await expect(scores(teacher, p1, english, [{ student_id: ada, ca: 40, exam: 60 }])).rejects.toThrow(/permission|already/)
    await scores(principal, p1, english, [{ student_id: ada, ca: 33, exam: 50 }])
    expect((await q<{ ca: string; status: string }>('select ca, status from public.school_scores where student_id=$1 and subject_id=$2', [ada, english]))[0]).toMatchObject({ ca: '33.00', status: 'published' })
    expect(await num(`select count(*) as v from public.audit_logs where action='school_scores.update' and metadata::text like '%33%'`)).toBeGreaterThan(0)
  })

  it('takes remarks, with the principal remark and promotion decision reserved to approvers', async () => {
    await as(teacher, () => q('select public.school_save_remarks($1,$2,$3,$4,$5,$6)', [biz, ada, term, 'Works hard', 'Hacked remark', 'promoted']))
    let r = (await q<{ teacher_remark: string; principal_remark: string | null; promotion: string | null }>('select * from public.school_remarks where student_id=$1', [ada]))[0]
    expect(r).toMatchObject({ teacher_remark: 'Works hard', principal_remark: null, promotion: null })
    await as(principal, () => q('select public.school_save_remarks($1,$2,$3,$4,$5,$6)', [biz, ada, term, 'Works hard', 'Keep it up', 'promoted']))
    r = (await q<{ teacher_remark: string; principal_remark: string | null; promotion: string | null }>('select * from public.school_remarks where student_id=$1', [ada]))[0]
    expect(r).toMatchObject({ principal_remark: 'Keep it up', promotion: 'promoted' })
  })
})

describe('promotion and leaving keep history', () => {
  it('moves a student to the next class, closing the old enrollment and keeping their results', async () => {
    expect(await as(officer, () => q<{ r: number }>('select public.school_promote($1,$2::jsonb,$3) as r', [biz, JSON.stringify([{ student_id: ada, class_id: p2 }]), 'Promoted'])).then((r) => r[0].r)).toBe(1)
    expect((await q<{ class_id: string }>('select class_id from public.school_students where id=$1', [ada]))[0].class_id).toBe(p2)
    expect(await num('select count(*) as v from public.school_enrollments where student_id=$1', [ada])).toBe(2)
    expect(await num('select count(*) as v from public.school_enrollments where student_id=$1 and ended_on is null', [ada])).toBe(1)
    expect((await q<{ class_id: string }>('select class_id from public.school_scores where student_id=$1 and subject_id=$2', [ada, english]))[0].class_id).toBe(p1) // the result stays with the class it was earned in
    await expect(as(teacher, () => q('select public.school_promote($1,$2::jsonb,null)', [biz, JSON.stringify([{ student_id: ada, class_id: jss1 }])]))).rejects.toThrow(/permission denied/)
  })

  it('marks a leaver as withdrawn instead of deleting them, and refuses to move them afterwards', async () => {
    await expect(as(officer, () => q('select public.school_set_student_status($1,$2,$3)', [bola, 'withdrawn', '']))).rejects.toThrow(/why/)
    await as(officer, () => q('select public.school_set_student_status($1,$2,$3)', [bola, 'withdrawn', 'Family moved']))
    expect((await q<{ status: string }>('select status from public.school_students where id=$1', [bola]))[0].status).toBe('withdrawn')
    expect(await num('select count(*) as v from public.school_attendance where student_id=$1', [bola])).toBeGreaterThan(0) // history is kept
    await expect(as(officer, () => q('select public.school_promote($1,$2::jsonb,null)', [biz, JSON.stringify([{ student_id: bola, class_id: p2 }])]))).rejects.toThrow(/only active students/)
    await expect(mark(owner, p1, weekday(-2), [{ student_id: bola, status: 'present' }])).rejects.toThrow(/active member/)
    await as(officer, () => q('select public.school_set_student_status($1,$2,null)', [bola, 'active']))
  })
})

describe('fees and payments', () => {
  beforeAll(async () => {
    await as(bursar, () => q('select public.school_save_fee_item($1,null,$2,$3,null,$4,false,true)', [biz, 'Tuition', 40000, term]))
    await as(bursar, () => q('select public.school_save_fee_item($1,null,$2,$3,$4,$5,false,true)', [biz, 'Textbooks', 8000, p2, term]))
  })

  it('refuses fee setup from people without the fees permission', async () => {
    await expect(as(teacher, () => q('select public.school_save_fee_item($1,null,$2,$3,null,null,false,true)', [biz, 'Hack', 1]))).rejects.toThrow(/permission denied/)
    await expect(as(officer, () => q('select public.school_generate_bills($1,$2,null,null,$3)', [biz, term, key()]))).rejects.toThrow(/permission denied/)
    await expect(as(bursar, () => q('select public.school_save_fee_item($1,null,$2,$3,null,null,false,true)', [biz, 'Bad', -5]))).rejects.toThrow(/zero or more/)
  })

  it('bills each active student once per term using the fees for their class, and skips ones already billed', async () => {
    const r = (await as(bursar, () => q<{ r: { created: number; skipped: number } }>('select public.school_generate_bills($1,$2,null,$3,$4) as r', [biz, term, iso(14), key()])))[0].r
    expect(r.created).toBeGreaterThanOrEqual(3)
    expect(Number((await bill(ada)).total)).toBe(48000) // Primary 2 now: tuition + textbooks
    expect(Number((await bill(chidi)).total)).toBe(48000)
    expect(Number((await bill(bola)).total)).toBe(40000)
    const again = (await as(bursar, () => q<{ r: { created: number } }>('select public.school_generate_bills($1,$2,null,null,$3) as r', [biz, term, key()])))[0].r
    expect(again.created).toBe(0)
  })

  it('records partial payments with receipts, updates the balance, and refuses more than is owed', async () => {
    const b = (await bill(chidi)).id
    const first = await pay(bursar, b, 20000)
    expect(first.receipt_number).toMatch(/^RCT-/)
    expect(first.balance).toBe(28000)
    const sum = () => q<{ paid: string; balance: string; status: string }>('select paid, balance, status from public.school_bill_summary where id=$1', [b]).then((r) => r[0])
    expect(await sum()).toMatchObject({ paid: '20000.00', balance: '28000.00', status: 'partially_paid' })
    await expect(pay(bursar, b, 28001)).rejects.toThrow(/more than the balance/)
    await expect(pay(bursar, b, 0)).rejects.toThrow(/more than zero/)
    const second = await pay(bursar, b, 28000)
    expect(second.receipt_number).not.toBe(first.receipt_number)
    expect(await sum()).toMatchObject({ balance: '0.00', status: 'paid' })
  })

  it('does not record a repeated submission twice', async () => {
    const b = (await bill(bola)).id
    const k = key()
    const a = await pay(bursar, b, 5000, k); const c = await pay(bursar, b, 5000, k)
    expect(a.receipt_number).toBe(c.receipt_number)
    expect(await num(`select count(*) as v from public.school_payments where bill_id=$1 and status='posted'`, [b])).toBe(1)
  })

  it('reverses a payment with a reason instead of deleting it, and the balance comes back', async () => {
    const b = (await bill(bola)).id
    const p = (await q<{ id: string }>(`select id from public.school_payments where bill_id=$1`, [b]))[0].id
    await expect(as(officer, () => q('select public.school_reverse_payment($1,$2)', [p, 'mistake']))).rejects.toThrow(/permission denied/)
    await expect(as(bursar, () => q('select public.school_reverse_payment($1,$2)', [p, '']))).rejects.toThrow(/why/)
    await as(bursar, () => q('select public.school_reverse_payment($1,$2)', [p, 'Cheque bounced']))
    expect((await q<{ balance: string }>('select balance from public.school_bill_summary where id=$1', [b]))[0].balance).toBe('40000.00')
    expect(await num('select count(*) as v from public.school_payments where id=$1', [p])).toBe(1)
    await expect(as(bursar, () => q('select public.school_reverse_payment($1,$2)', [p, 'again']))).rejects.toThrow(/already reversed/)
  })

  it('applies a discount with a reason, and shows overdue balances', async () => {
    const b = (await bill(ada)).id
    await expect(as(bursar, () => q('select public.school_adjust_bill($1,$2,$3,null,null)', [b, 5000, '']))).rejects.toThrow(/why/)
    await as(bursar, () => q('select public.school_adjust_bill($1,$2,$3,null,null)', [b, 8000, 'Staff child']))
    expect((await q<{ payable: string }>('select payable from public.school_bill_summary where id=$1', [b]))[0].payable).toBe('40000.00')
    await db.exec(`update public.school_bills set due_on = '${iso(-1)}' where id = '${b}'`)
    expect((await q<{ status: string }>('select status from public.school_bill_summary where id=$1', [b]))[0].status).toBe('overdue')
  })

  it('shows parents only their own children bills and payments, and keeps teachers away from fees', async () => {
    expect((await as(parent2, () => q<{ student_id: string }>('select student_id from public.school_bills where business_id=$1', [biz]))).map((r) => r.student_id)).toEqual([chidi])
    expect((await as(parent, () => q<{ student_id: string }>('select student_id from public.school_bills where business_id=$1', [biz]))).every((r) => [ada, bola].includes(r.student_id))).toBe(true)
    expect(await as(teacher, () => q('select * from public.school_bills where business_id=$1', [biz]))).toHaveLength(0)
    expect(await as(teacher, () => q('select * from public.school_payments where business_id=$1', [biz]))).toHaveLength(0)
    await expect(pay(teacher, (await bill(ada)).id, 100)).rejects.toThrow(/permission denied/)
    await expect(pay(parent, (await bill(ada)).id, 100)).rejects.toThrow(/permission denied/)
  })
})

describe('announcements, dashboard and isolation', () => {
  it('shows each announcement only to its audience', async () => {
    await as(principal, () => q(`select public.school_publish_announcement($1,'Fees due','Pay before the 30th','parents',null,null)`, [biz]))
    await as(principal, () => q(`select public.school_publish_announcement($1,'Staff meeting','Friday 2pm','teachers',null,null)`, [biz]))
    await as(principal, () => q(`select public.school_publish_announcement($1,'Primary 1 trip','Bring lunch','class',$2,null)`, [biz, p1]))
    await as(principal, () => q(`select public.school_publish_announcement($1,'Later','Not yet','everyone',null,$2)`, [biz, iso(5)]))
    const titles = (u: string) => as(u, () => q<{ title: string }>('select title from public.school_announcements where business_id=$1', [biz])).then((r) => r.map((x) => x.title).sort())
    expect(await titles(parent)).toEqual(['Fees due', 'Primary 1 trip']) // parent has a child in Primary 1 (Bola); Ada moved up
    expect(await titles(parent2)).toEqual(['Fees due'])
    expect(await titles(teacher)).toEqual(['Primary 1 trip', 'Staff meeting'])
    expect(await titles(outsider)).toEqual([])
    await expect(as(teacher, () => q(`select public.school_publish_announcement($1,'Hack','x','everyone',null,null)`, [biz]))).rejects.toThrow(/permission denied/)
  })

  it('reconciles the dashboard with the underlying records, with money only for fee readers', async () => {
    const o = (await as(principal, () => q<{ r: Record<string, number | null> }>('select public.school_overview($1,null) as r', [biz])))[0].r
    expect(Number(o.students)).toBe(await num(`select count(*) as v from public.school_students where business_id=$1 and status='active'`, [biz]))
    expect(Number(o.classes)).toBe(await num('select count(*) as v from public.school_classes where business_id=$1 and active', [biz]))
    expect(Number(o.billed)).toBe(await num('select coalesce(sum(payable),0) as v from public.school_bill_summary where business_id=$1 and term_id=$2', [biz, term]))
    expect(Number(o.collected)).toBe(await num(`select coalesce(sum(amount),0) as v from public.school_payments where business_id=$1 and status='posted'`, [biz]))
    expect(Number(o.outstanding)).toBe(await num('select coalesce(sum(greatest(balance,0)),0) as v from public.school_bill_summary where business_id=$1 and term_id=$2', [biz, term]))
    const bursarView = (await as(bursar, () => q<{ r: Record<string, unknown> }>('select public.school_overview($1,null) as r', [biz])))[0].r
    expect(bursarView.billed).not.toBeNull()
    const officerView = (await as(officer, () => q<{ r: Record<string, unknown> }>('select public.school_overview($1,null) as r', [biz])))[0].r
    expect(officerView.billed).toBeNull()
    await expect(as(teacher, () => q('select public.school_overview($1,null)', [biz]))).rejects.toThrow(/permission denied/)
  })

  it('keeps one school out of another', async () => {
    expect(await as(outsider, () => q('select * from public.school_students where business_id=$1', [biz]))).toHaveLength(0)
    expect(await as(outsider, () => q('select * from public.school_bills where business_id=$1', [biz]))).toHaveLength(0)
    expect(await as(outsider, () => q('select * from public.school_payments where business_id=$1', [biz]))).toHaveLength(0)
    const adaBill = (await bill(ada)).id
    await expect(as(outsider, () => q('select public.school_record_payment($1,$2,$3,null,$4)', [adaBill, 100, 'cash', key()]))).rejects.toThrow(/permission denied/)
    await expect(register(outsider, 'Spy', 'Kid', p1, [], biz)).rejects.toThrow(/permission denied/)
    const own = await register(outsider, 'Local', 'Kid', (await q<{ id: string }>('select id from public.school_classes where business_id=$1 limit 1', [bizB]))[0].id, [], bizB)
    expect(own.admission_no).toMatch(/^ADM-/)
    expect(session).toBeTruthy()
  })
})

describe('the kind of school decides what exists', () => {
  const names = async (b: string, where = 'true') => (await q<{ name: string }>(`select name from public.school_classes where business_id=$1 and ${where} order by level_order`, [b])).map((r) => r.name)
  const subjectNames = async (b: string) => (await q<{ name: string }>('select name from public.school_subjects where business_id=$1', [b])).map((r) => r.name)
  const make = async (type: string, name: string) => {
    const id = (await as(outsider, () => q<{ id: string }>(`select public.create_business($1,'school') as id`, [name])))[0].id
    await as(outsider, () => q(`select public.school_setup($1,$2,'2026/2027',$3)`, [id, type, iso(-20)]))
    return id
  }

  it('a primary school has primary classes and subjects only', async () => {
    expect(await names(bizB)).toEqual(['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'])
    const subjects = await subjectNames(bizB)
    expect(subjects).toContain('Basic Science')
    expect(subjects).not.toContain('Physics')
    expect(subjects).not.toContain('Literacy')
  })

  it('a secondary school has JSS and SS only, with senior subjects only for SS classes', async () => {
    const b = await make('secondary', 'Secondary Only')
    expect(await names(b)).toEqual(['JSS 1', 'JSS 2', 'JSS 3', 'SS 1', 'SS 2', 'SS 3'])
    expect(await subjectNames(b)).toEqual(expect.arrayContaining(['Physics', 'Business Studies']))
    const physicsIn = await names(b, `id in (select class_id from public.school_class_subjects cs join public.school_subjects s on s.id = cs.subject_id where s.name = 'Physics')`)
    expect(physicsIn).toEqual(['SS 1', 'SS 2', 'SS 3'])
  })

  it('a nursery school has nursery classes only', async () => {
    const b = await make('nursery', 'Nursery Only')
    expect(await names(b)).toEqual(['Nursery 1', 'Nursery 2'])
    expect(await subjectNames(b)).toEqual(expect.arrayContaining(['Literacy', 'Numeracy']))
    expect(await subjectNames(b)).not.toContain('Mathematics')
  })

  it('refuses a class from another stage', async () => {
    const b = await make('secondary', 'Secondary Two')
    await expect(as(outsider, () => q(`select public.school_save_class($1,null,'Primary 1',3,null,true,'primary')`, [b]))).rejects.toThrow(/cannot have primary classes/)
    await expect(as(outsider, () => q(`select public.school_save_class($1,null,'Sixth',15,null,true,null)`, [b]))).rejects.toThrow(/choose the stage/)
    await expect(as(outsider, () => q(`select public.school_save_class($1,null,'SS 4',15,null,true,'secondary')`, [b]))).resolves.toBeTruthy()
  })

  it('narrowing retires the other stages, but never while students are in them', async () => {
    const b = await make('combined', 'Everything School')
    const first = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='JSS 1'`, [b]))[0].id
    await register(outsider, 'Tolu', 'Ade', first, [], b)
    await expect(as(outsider, () => q('select public.school_save_settings($1,$2,null,null,null,40,60,false,$3)', [b, 'primary', '{1,2,3,4,5}']))).rejects.toThrow(/JSS 1/)
    expect(await names(b, 'active')).toHaveLength(14)
    const nursery = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='Nursery 1'`, [b]))[0].id
    expect(nursery).toBeTruthy()
    // JSS 1 holds a student, so secondary keeps it and retires the other stages.
    await as(outsider, () => q('select public.school_save_settings($1,$2,null,null,null,40,60,false,$3)', [b, 'secondary', '{1,2,3,4,5}']))
    expect(await names(b, 'active')).toEqual(['JSS 1', 'JSS 2', 'JSS 3', 'SS 1', 'SS 2', 'SS 3'])
    await expect(as(outsider, () => q(`select public.school_save_class($1,$2,'Nursery 1',1,null,true,'nursery')`, [b, nursery]))).rejects.toThrow(/cannot have nursery classes/)
    await as(outsider, () => q('select public.school_save_settings($1,$2,null,null,null,40,60,false,$3)', [b, 'combined', '{1,2,3,4,5}']))
    await expect(as(outsider, () => q(`select public.school_save_class($1,$2,'Nursery 1',1,null,true,'nursery')`, [b, nursery]))).resolves.toBeTruthy()
  })
})
