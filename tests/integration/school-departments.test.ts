import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, admin: string, manager: string, principal: string, teacher: string, outsider: string
let biz: string, bizP: string
let n = 0
const key = () => `sd-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = (v: unknown) => JSON.stringify(v)
const cls = async (b: string, name: string) => (await q<{ id: string }>('select id from public.school_classes where business_id=$1 and name=$2', [b, name]))[0].id
const subjectsOf = async (b: string, className: string) => (await q<{ name: string }>(`select s.name from public.school_class_subjects cs join public.school_subjects s on s.id = cs.subject_id join public.school_classes c on c.id = cs.class_id where cs.business_id=$1 and c.name=$2 order by 1`, [b, className])).map((r) => r.name)
const join = async (u: string, email: string, role: string) => { await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, email, role])); await as(u, () => q('select public.accept_my_invitations()')) }

beforeAll(async () => {
  db = await createDb()
  ;[owner, admin, manager, principal, teacher, outsider] = await Promise.all(['o', 'a', 'm', 'p', 't', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
  bizP = (await as(outsider, () => q<{ id: string }>(`select public.create_business('Primary Only','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  await join(admin, 'a@example.com', 'business_admin'); await join(manager, 'm@example.com', 'manager'); await join(principal, 'p@example.com', 'principal'); await join(teacher, 't@example.com', 'teacher')
  await as(owner, () => q(`select public.school_setup($1,'combined','2026/2027',current_date - 20)`, [biz]))
  await as(outsider, () => q(`select public.school_setup($1,'primary','2026/2027',current_date - 20)`, [bizP]))
})

describe('senior secondary departments', () => {
  it('are created with a school that has senior secondary, and not with one that does not', async () => {
    expect((await q<{ name: string }>('select name from public.school_departments where business_id=$1 order by name', [biz])).map((d) => d.name)).toEqual(['Art', 'Commercial', 'Science'])
    expect(await q('select 1 from public.school_departments where business_id=$1', [bizP])).toHaveLength(0)
  })

  it('put every senior secondary class in one, and only senior secondary classes', async () => {
    const rowsOut = await q<{ name: string; dept: string | null }>(`select c.name, d.name as dept from public.school_classes c left join public.school_departments d on d.id = c.department_id where c.business_id=$1 order by c.level_order, c.name`, [biz])
    expect(rowsOut.filter((r) => r.dept).map((r) => r.name)).toEqual(['SS 1 Art', 'SS 1 Commercial', 'SS 1 Science', 'SS 2 Art', 'SS 2 Commercial', 'SS 2 Science', 'SS 3 Art', 'SS 3 Commercial', 'SS 3 Science'])
    expect(rowsOut.find((r) => r.name === 'Primary 1')!.dept).toBeNull()
  })

  it('can be added, renamed and deleted by school managers, but not while in use', async () => {
    const save = (u: string, id: string | null, name: string) => as(u, () => q<{ r: string }>('select public.school_save_department($1,$2,$3) as r', [biz, id, name]))
    await expect(save(teacher, null, 'Technical')).rejects.toThrow(/permission denied/)
    await expect(save(owner, null, 'A')).rejects.toThrow(/department name/)
    await expect(save(owner, null, 'Science')).rejects.toThrow(/duplicate key/)
    const id = (await save(principal, null, 'Technical'))[0].r
    await save(principal, id, 'Technical and Vocational')
    expect((await q<{ name: string }>('select name from public.school_departments where id=$1', [id]))[0].name).toBe('Technical and Vocational')
    const sci = (await q<{ id: string }>(`select id from public.school_departments where business_id=$1 and name='Science'`, [biz]))[0].id
    await expect(as(owner, () => q('select public.school_delete_department($1,$2)', [biz, sci]))).rejects.toThrow(/still has classes or subjects/)
    await as(owner, () => q('select public.school_delete_department($1,$2)', [biz, id]))
    expect(await q('select 1 from public.school_departments where id=$1', [id])).toHaveLength(0)
    await expect(as(outsider, () => q('select public.school_delete_department($1,$2)', [biz, sci]))).rejects.toThrow(/permission denied/)
  })

  it('only apply to secondary classes', async () => {
    const dept = (await q<{ id: string }>(`select id from public.school_departments where business_id=$1 and name='Art'`, [biz]))[0].id
    await expect(as(owner, () => q(`select public.school_save_class($1,null,'Primary 7',9,null,true,'primary',$2)`, [biz, dept]))).rejects.toThrow(/only secondary classes/)
    await expect(as(owner, () => q(`select public.school_save_class($1,null,'SS 4 Art',15,null,true,'secondary',$2)`, [biz, '00000000-0000-0000-0000-000000000000']))).rejects.toThrow(/department not found/)
    await expect(as(owner, () => q(`select public.school_save_class($1,null,'SS 4 Art',15,null,true,'secondary',$2)`, [biz, dept]))).resolves.toBeTruthy()
  })
})

describe('subjects by level and department', () => {
  it('record the levels they are taught at and their department', async () => {
    const sub = async (name: string) => (await q<{ levels: string[]; dept: string | null }>(`select s.levels, d.name as dept from public.school_subjects s left join public.school_departments d on d.id = s.department_id where s.business_id=$1 and s.name=$2`, [biz, name]))[0]
    expect(await sub('Physics')).toEqual({ levels: ['sss'], dept: 'Science' })
    expect(await sub('Economics')).toEqual({ levels: ['sss'], dept: 'Commercial' })
    expect((await sub('English Language')).dept).toBeNull()
    expect((await sub('English Language')).levels).toEqual(['jss', 'primary', 'sss'])
    expect((await sub('Literacy')).levels).toEqual(['nursery'])
  })

  it('give each senior secondary class its own department\'s subjects plus the core ones', async () => {
    const sci = await subjectsOf(biz, 'SS 1 Science'); const art = await subjectsOf(biz, 'SS 1 Art'); const com = await subjectsOf(biz, 'SS 1 Commercial')
    expect(sci).toEqual(expect.arrayContaining(['Physics', 'Chemistry', 'Biology', 'English Language', 'Mathematics']))
    expect(sci).not.toContain('Literature in English'); expect(sci).not.toContain('Economics')
    expect(art).toEqual(expect.arrayContaining(['Literature in English', 'Government', 'English Language']))
    expect(art).not.toContain('Physics')
    expect(com).toEqual(expect.arrayContaining(['Economics', 'Financial Accounting', 'Commerce', 'Mathematics']))
    expect(com).not.toContain('Biology')
  })

  it('exist only for the kind of school: a primary school has no senior secondary subjects', async () => {
    const all = (await q<{ name: string }>('select name from public.school_subjects where business_id=$1', [bizP])).map((r) => r.name)
    expect(all).toContain('Basic Science'); expect(all).not.toContain('Physics'); expect(all).not.toContain('Literacy')
    expect(await subjectsOf(bizP, 'Primary 1')).toContain('Mathematics')
  })

  it('can be created with levels and a department, and refuse a level that does not exist', async () => {
    const dept = (await q<{ id: string }>(`select id from public.school_departments where business_id=$1 and name='Commercial'`, [biz]))[0].id
    await as(owner, () => q(`select public.school_save_subject($1,null,'Store Keeping','STK','{sss}'::text[],$2)`, [biz, dept]))
    expect((await q<{ levels: string[] }>(`select levels from public.school_subjects where business_id=$1 and name='Store Keeping'`, [biz]))[0].levels).toEqual(['sss'])
    await expect(as(owner, () => q(`select public.school_save_subject($1,null,'Odd','ODD','{university}'::text[],null)`, [biz]))).rejects.toThrow(/choose levels/)
    await expect(as(teacher, () => q(`select public.school_save_subject($1,null,'Nope','NOP','{sss}'::text[],null)`, [biz]))).rejects.toThrow(/permission denied/)
  })
})

describe('deleting a student', () => {
  let ada: string, bola: string, guardianAda: string
  beforeAll(async () => {
    const p1 = await cls(biz, 'Primary 1')
    const reg = (first: string, email: string) => as(owner, () => q<{ r: { student_id: string } }>('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4) as r', [biz, J({ first, last: 'Obi', class_id: p1 }), J([{ name: `Parent of ${first}`, email, phone: first === 'Ada' ? '0801' : '0802', relationship: 'mother', primary: true }]), key()])).then((r) => r[0].r.student_id)
    ada = await reg('Ada', 'ada.parent@example.com'); bola = await reg('Bola', 'bola.parent@example.com')
    guardianAda = (await q<{ id: string }>(`select id from public.school_guardians where business_id=$1 and email='ada.parent@example.com'`, [biz]))[0].id
    const term = (await q<{ id: string }>('select id from public.school_terms where business_id=$1 and is_current', [biz]))[0].id
    await as(owner, () => q(`select public.school_save_fee_item($1,null,'Tuition',50000,null,null,false,true)`, [biz]))
    await as(owner, () => q('select public.school_generate_bills($1,$2,null,null,$3)', [biz, term, key()]))
    const billB = (await q<{ id: string }>('select id from public.school_bills where student_id=$1', [bola]))[0].id
    await as(owner, () => q(`select public.school_record_payment($1,10000,'cash',null,$2)`, [billB, key()]))
    const eng = (await q<{ id: string }>(`select id from public.school_subjects where business_id=$1 and name='English Language'`, [biz]))[0].id
    await as(owner, () => q('select public.school_save_scores($1,$2,$3,$4,$5::jsonb,false)', [biz, p1, eng, term, J([{ student_id: ada, ca: 30, exam: 50 }])]))
    await as(owner, () => q('select public.school_mark_attendance($1,$2,$3,$4::jsonb)', [biz, p1, (() => { const d = new Date(); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) })(), J([{ student_id: ada, status: 'present' }, { student_id: bola, status: 'absent' }])]))
  })

  it('is for owners and business admins only, with a reason', async () => {
    for (const [u, who] of [[manager, 'manager'], [principal, 'principal'], [teacher, 'teacher'], [outsider, 'outsider']] as const) await expect(as(u, () => q('select public.school_delete_student($1,$2)', [ada, 'asked to'])), who).rejects.toThrow(/permission denied/)
    await expect(as(owner, () => q('select public.school_delete_student($1,$2)', [ada, '']))).rejects.toThrow(/say why/)
  })

  it('refuses a student who has fee payments on record', async () => {
    await expect(as(owner, () => q('select public.school_delete_student($1,$2)', [bola, 'duplicate entry']))).rejects.toThrow(/fee payments on record/)
    expect(await q('select 1 from public.school_students where id=$1', [bola])).toHaveLength(1)
  })

  it('erases a student and everything of theirs, and records who did it and why', async () => {
    await as(admin, () => q('select public.school_delete_student($1,$2)', [ada, 'Entered twice by mistake']))
    for (const t of ['school_students', 'school_scores', 'school_attendance', 'school_enrollments', 'school_bills', 'school_student_guardians']) {
      const col = t === 'school_students' ? 'id' : 'student_id'
      expect(await q(`select 1 from public.${t} where ${col}=$1`, [ada]), t).toHaveLength(0)
    }
    expect(await q('select 1 from public.school_students where id=$1', [bola])).toHaveLength(1) // other pupils untouched
    const log = (await q<{ metadata: { reason: string; admission_no: string } }>(`select metadata from public.audit_logs where business_id=$1 and action='school_student.delete'`, [biz]))[0]
    expect(log.metadata.reason).toBe('Entered twice by mistake')
  })

  it('deletes a parent or guardian record and its links, but never someone else\'s', async () => {
    await expect(as(manager, () => q('select public.school_delete_guardian($1,$2)', [guardianAda, 'wrong person']))).rejects.toThrow(/permission denied/)
    await as(owner, () => q('select public.school_delete_guardian($1,$2)', [guardianAda, 'Duplicate record']))
    expect(await q('select 1 from public.school_guardians where id=$1', [guardianAda])).toHaveLength(0)
    expect(await q('select 1 from public.school_guardians where business_id=$1 and email=$2', [biz, 'bola.parent@example.com'])).toHaveLength(1)
    expect((await q<{ metadata: { reason: string } }>(`select metadata from public.audit_logs where business_id=$1 and action='school_guardian.delete'`, [biz]))[0].metadata.reason).toBe('Duplicate record')
  })
})

describe('the report card', () => {
  it('carries the school details, the grading key, the next term and each subject\'s class figures', async () => {
    const p1 = await cls(biz, 'Primary 1')
    const eng = (await q<{ id: string }>(`select id from public.school_subjects where business_id=$1 and name='English Language'`, [biz]))[0].id
    const term = (await q<{ id: string }>('select id from public.school_terms where business_id=$1 and is_current', [biz]))[0].id
    const reg = (first: string) => as(owner, () => q<{ r: { student_id: string } }>('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4) as r', [biz, J({ first, last: 'Card', class_id: p1 }), J([]), key()])).then((r) => r[0].r.student_id)
    const [x, y] = [await reg('Xola'), await reg('Yemi')]
    await as(owner, () => q('select public.school_save_scores($1,$2,$3,$4,$5::jsonb,true)', [biz, p1, eng, term, J([{ student_id: x, ca: 30, exam: 50 }, { student_id: y, ca: 20, exam: 40 }])]))
    await as(principal, () => q('select public.school_review_scores($1,$2,$3,$4,$5,$6)', [biz, p1, eng, term, 'approve', '']))
    await as(principal, () => q('select public.school_review_scores($1,$2,$3,$4,$5,$6)', [biz, p1, eng, term, 'publish', '']))
    const card = (await as(owner, () => q<{ r: Record<string, unknown> }>('select public.school_report_card($1,$2) as r', [x, term])))[0].r as { school: { name: string; ca_max: number }; bands: { grade: string }[]; next_term: { name: string } | null; subjects: { class_avg: number; highest: number; lowest: number }[]; student: { gender: string | null } }
    expect(card.school.name).toBe('Bright School'); expect(Number(card.school.ca_max)).toBe(40)
    expect(card.bands.map((b) => b.grade)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(card.next_term?.name).toBe('Second Term')
    expect(card.subjects[0]).toMatchObject({ class_avg: 70, highest: 80, lowest: 60 })
  })
})
