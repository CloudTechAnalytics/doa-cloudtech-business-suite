import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, rows } from '../helpers/harness'
import type { Db } from '../helpers/harness'

let db: Db
let owner: string, principal: string, teacher: string, teacher2: string, parent: string, outsider: string
let biz: string, p1: string, p2: string, ada: string, bola: string, cyril: string, term1: string, term2: string, session: string
let n = 0
const key = () => `rd-${Date.now()}-${n++}-abcdefgh`
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => rows<T>(db, sql, params)
const as = <T>(u: string, fn: () => Promise<T>) => asUser(db, u, fn)
const J = (v: unknown) => JSON.stringify(v)
const reg = async (first: string, cls: string, guardians: unknown[] = []) => (await as(owner, () => q<{ r: { student_id: string } }>('select public.school_register_student($1,$2::jsonb,$3::jsonb,$4) as r', [biz, J({ first, last: 'Pupil', class_id: cls }), J(guardians), key()])))[0].r.student_id
const subjectId = async (name: string) => (await q<{ id: string }>('select id from public.school_subjects where business_id=$1 and name=$2', [biz, name]))[0].id
const tiny = 'data:image/jpeg;base64,' + 'A'.repeat(200)

beforeAll(async () => {
  db = await createDb()
  ;[owner, principal, teacher, teacher2, parent, outsider] = await Promise.all(['o', 'p', 't', 't2', 'pa', 'x'].map((p) => createUser(db, `${p}@example.com`)))
  biz = (await as(owner, () => q<{ id: string }>(`select public.create_business('Bright School','school') as id`)))[0].id
  await db.exec(`update public.subscriptions set plan_id=(select id from public.subscription_plans where code='growth')`)
  for (const [u, e, r] of [[principal, 'p@example.com', 'principal'], [teacher, 't@example.com', 'teacher'], [teacher2, 't2@example.com', 'teacher'], [parent, 'pa@example.com', 'parent']] as const) { await as(owner, () => q('select public.invite_member($1,$2,$3)', [biz, e, r])); await as(u, () => q('select public.accept_my_invitations()')) }
  await as(owner, () => q(`select public.school_setup($1,'primary','2026/2027',current_date - 100)`, [biz]))
  await as(owner, () => q(`select public.school_save_settings($1,'primary',null,null,null,40,60,true,'{1,2,3,4,5}')`, [biz]))
  p1 = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='Primary 1'`, [biz]))[0].id
  p2 = (await q<{ id: string }>(`select id from public.school_classes where business_id=$1 and name='Primary 2'`, [biz]))[0].id
  ada = await reg('Ada', p1, [{ name: 'Mrs Pupil', email: 'pa@example.com', relationship: 'mother', primary: true }]); bola = await reg('Bola', p1); cyril = await reg('Cyril', p2)
  ;[term1, term2] = (await q<{ id: string }>(`select id from public.school_terms where business_id=$1 order by starts_on limit 2`, [biz])).map((r) => r.id)
  session = (await q<{ id: string }>('select id from public.school_sessions where business_id=$1', [biz]))[0].id
  await as(parent, () => q('select public.school_claim_links($1)', [biz]))
  await as(owner, () => q('select public.school_save_staff($1,null,$2,null,$3,$4,null,true)', [biz, 'Mr T', 't@example.com', 'Teacher'])); await as(teacher, () => q('select public.school_claim_links($1)', [biz]))
  const st = (await q<{ id: string }>('select id from public.school_staff where business_id=$1', [biz]))[0].id
  await as(owner, () => q('select public.school_set_assignments($1,$2,$3::jsonb)', [biz, st, J([{ class_id: p1, subject_id: null, class_teacher: true }])]))
})

describe('skills ratings and comment templates', () => {
  it('seeds the standard skills and comments, and lets managers change them', async () => {
    const traits = await q<{ domain: string; name: string }>('select domain, name from public.school_skill_traits where business_id=$1 order by domain, position', [biz])
    expect(traits.filter((t) => t.domain === 'affective').map((t) => t.name)).toEqual(['Punctuality', 'Neatness', 'Honesty', 'Politeness', 'Attentiveness', 'Self control', 'Relationship with others'])
    expect(traits.filter((t) => t.domain === 'psychomotor')).toHaveLength(5)
    expect((await q('select 1 from public.school_remark_templates where business_id=$1', [biz])).length).toBeGreaterThan(5)
    await expect(as(teacher, () => q('select public.school_save_traits($1,$2::jsonb)', [biz, J([{ domain: 'affective', name: 'X' }])]))).rejects.toThrow(/permission denied/)
    await as(owner, () => q('select public.school_save_traits($1,$2::jsonb)', [biz, J([{ domain: 'affective', name: 'Punctuality' }, { domain: 'affective', name: 'Leadership' }, { domain: 'psychomotor', name: 'Sports and games' }])]))
    expect((await q<{ name: string }>('select name from public.school_skill_traits where business_id=$1 order by domain, position', [biz])).map((t) => t.name)).toEqual(['Punctuality', 'Leadership', 'Sports and games'])
    await as(owner, () => q('select public.school_save_remark_templates($1,$2::jsonb)', [biz, J([{ kind: 'teacher', text: 'Good effort.' }, { kind: 'principal', text: 'Promoted.' }])]))
    expect(await q('select 1 from public.school_remark_templates where business_id=$1', [biz])).toHaveLength(2)
  })

  it('lets the class teacher rate their own pupils, and nobody else\'s', async () => {
    const trait = (await q<{ id: string }>(`select id from public.school_skill_traits where business_id=$1 and name='Punctuality'`, [biz]))[0].id
    await as(teacher, () => q('select public.school_save_ratings($1,$2,$3,$4::jsonb)', [biz, ada, term1, J([{ trait_id: trait, rating: 5 }])]))
    await expect(as(teacher, () => q('select public.school_save_ratings($1,$2,$3,$4::jsonb)', [biz, cyril, term1, J([{ trait_id: trait, rating: 5 }])]))).rejects.toThrow(/permission denied/)
    await expect(as(teacher2, () => q('select public.school_save_ratings($1,$2,$3,$4::jsonb)', [biz, ada, term1, J([{ trait_id: trait, rating: 3 }])]))).rejects.toThrow(/permission denied/)
    await expect(as(parent, () => q('select public.school_save_ratings($1,$2,$3,$4::jsonb)', [biz, ada, term1, J([{ trait_id: trait, rating: 1 }])]))).rejects.toThrow(/permission denied/)
    await expect(as(principal, () => q('select public.school_save_ratings($1,$2,$3,$4::jsonb)', [biz, ada, term1, J([{ trait_id: trait, rating: 6 }])]))).rejects.toThrow(/1 to 5/)
    await as(principal, () => q('select public.school_save_ratings($1,$2,$3,$4::jsonb)', [biz, ada, term1, J([{ trait_id: trait, rating: 4 }])]))
    expect((await q<{ rating: number }>('select rating from public.school_skill_ratings where student_id=$1', [ada]))[0].rating).toBe(4)
    await as(principal, () => q('select public.school_save_ratings($1,$2,$3,$4::jsonb)', [biz, ada, term1, J([{ trait_id: trait, rating: null }])]))
    expect(await q('select 1 from public.school_skill_ratings where student_id=$1', [ada])).toHaveLength(0)
  })
})

describe('report card positions and the annual card', () => {
  const score = async (cls: string, subject: string, term: string, marks: [string, number, number][]) => {
    await as(owner, () => q('select public.school_save_scores($1,$2,$3,$4,$5::jsonb,true)', [biz, cls, subject, term, J(marks.map(([s, ca, exam]) => ({ student_id: s, ca, exam })))]))
    for (const act of ['approve', 'publish']) await as(owner, () => q('select public.school_review_scores($1,$2,$3,$4,$5,null)', [biz, cls, subject, term, act]))
  }
  beforeAll(async () => {
    const eng = await subjectId('English Language'), mth = await subjectId('Mathematics')
    await score(p1, eng, term1, [[ada, 30, 50], [bola, 20, 40]]); await score(p1, mth, term1, [[ada, 20, 30], [bola, 35, 55]])
    await score(p1, eng, term2, [[ada, 35, 55], [bola, 25, 35]]); await score(p1, mth, term2, [[ada, 30, 50], [bola, 20, 30]])
  })

  it('shows the position in each subject on the report card, with the skills that were rated', async () => {
    const trait = (await q<{ id: string }>(`select id from public.school_skill_traits where business_id=$1 and name='Leadership'`, [biz]))[0].id
    await as(teacher, () => q('select public.school_save_ratings($1,$2,$3,$4::jsonb)', [biz, ada, term1, J([{ trait_id: trait, rating: 5 }])]))
    const card = (await as(owner, () => q<{ c: { subjects: { subject: string; total: number; position: number }[]; skills: { domain: string; name: string; rating: number }[] } }>('select public.school_report_card($1,$2) as c', [biz === '' ? ada : ada, term1])))[0].c
    expect(card.subjects.find((x) => x.subject === 'English Language')).toMatchObject({ total: 80, position: 1 })
    expect(card.subjects.find((x) => x.subject === 'Mathematics')).toMatchObject({ total: 50, position: 2 })
    expect(card.skills).toEqual([{ domain: 'affective', name: 'Leadership', rating: 5 }])
    const bolaCard = (await as(owner, () => q<{ c: { subjects: { subject: string; position: number }[] } }>('select public.school_report_card($1,$2) as c', [bola, term1])))[0].c
    expect(bolaCard.subjects.find((x) => x.subject === 'English Language')!.position).toBe(2)
  })

  it('adds the terms up into an annual card with an average, grade and position', async () => {
    const card = (await as(owner, () => q<{ c: { session: string; terms: { name: string }[]; subjects: { subject: string; terms: (number | null)[]; average: number; grade: string }[]; average: number; position: number; class_size: number } }>('select public.school_annual_card($1,$2) as c', [ada, session])))[0].c
    expect(card.session).toBe('2026/2027'); expect(card.terms.map((t) => t.name)).toEqual(['First Term', 'Second Term', 'Third Term'])
    const eng = card.subjects.find((x) => x.subject === 'English Language')!
    expect(eng.terms).toEqual([80, 90, null]); expect(eng.average).toBe(85); expect(eng.grade).toBe('A')
    expect(card.average).toBe(75) // (85 + 65) / 2
    expect(card).toMatchObject({ position: 1, class_size: 2 })
    const b = (await as(owner, () => q<{ c: { average: number; position: number } }>('select public.school_annual_card($1,$2) as c', [bola, session])))[0].c
    expect(b.position).toBe(2)
  })

  it('is seen by the parent for their own child only', async () => {
    expect((await as(parent, () => q('select public.school_annual_card($1,$2) as c', [ada, session]))).length).toBe(1)
    await expect(as(parent, () => q('select public.school_annual_card($1,$2)', [bola, session]))).rejects.toThrow(/permission denied/)
    await expect(as(outsider, () => q('select public.school_annual_card($1,$2)', [ada, session]))).rejects.toThrow(/permission denied/)
  })
})

describe('graduating a group at once', () => {
  it('needs permission, only graduates active students, and ends their enrolment', async () => {
    const g1 = await reg('Grad One', p2), g2 = await reg('Grad Two', p2)
    await expect(as(teacher, () => q('select public.school_graduate($1,$2,$3)', [biz, [g1], 'done']))).rejects.toThrow(/permission denied/)
    await expect(as(principal, () => q('select public.school_graduate($1,$2,$3)', [biz, [], 'done']))).rejects.toThrow(/choose the students/)
    const r = await as(principal, () => q<{ n: number }>('select public.school_graduate($1,$2,$3) as n', [biz, [g1, g2, g1], 'Completed Primary 6']))
    expect(r[0].n).toBe(2)
    expect((await q<{ status: string; status_reason: string }>('select status, status_reason from public.school_students where id=$1', [g1]))[0]).toEqual({ status: 'graduated', status_reason: 'Completed Primary 6' })
    expect(await q('select 1 from public.school_enrollments where student_id=$1 and ended_on is null', [g1])).toHaveLength(0)
  })
})

describe('photos and documents', () => {
  it('lets people who manage students set and clear a photo, and teachers and parents see it for their own pupils only', async () => {
    await expect(as(teacher, () => q('select public.school_set_student_photo($1,$2)', [ada, tiny]))).rejects.toThrow(/permission denied/)
    await expect(as(principal, () => q('select public.school_set_student_photo($1,$2)', [ada, 'not a picture']))).rejects.toThrow(/JPEG, PNG or WebP/)
    await expect(as(principal, () => q('select public.school_set_student_photo($1,$2)', [ada, 'data:image/jpeg;base64,' + 'A'.repeat(130000)]))).rejects.toThrow(/too large/)
    await as(principal, () => q('select public.school_set_student_photo($1,$2)', [ada, tiny])); await as(principal, () => q('select public.school_set_student_photo($1,$2)', [cyril, tiny]))
    expect((await as(teacher, () => q('select student_id from public.school_student_photos'))).map((r) => (r as { student_id: string }).student_id)).toEqual([ada]) // Cyril is not in their class
    expect((await as(parent, () => q('select student_id from public.school_student_photos'))).length).toBe(1)
    expect(await as(outsider, () => q('select 1 from public.school_student_photos'))).toHaveLength(0)
    await as(principal, () => q('select public.school_set_student_photo($1,null)', [cyril]))
    expect(await q('select 1 from public.school_student_photos where student_id=$1', [cyril])).toHaveLength(0)
  })

  it('stores documents for people who manage students only, with limits and an audit trail', async () => {
    const data = 'data:application/pdf;base64,' + 'JVBERi0x'.repeat(20)
    await expect(as(teacher, () => q('select public.school_add_document($1,$2,$3,$4,$5)', [ada, 'birth_certificate', 'Birth cert.pdf', 'application/pdf', data]))).rejects.toThrow(/permission denied/)
    await expect(as(principal, () => q('select public.school_add_document($1,$2,$3,$4,$5)', [ada, 'secret', 'x.pdf', 'application/pdf', data]))).rejects.toThrow(/what kind/)
    await expect(as(principal, () => q('select public.school_add_document($1,$2,$3,$4,$5)', [ada, 'other', 'x.exe', 'application/x-msdownload', data]))).rejects.toThrow(/PDF/)
    await expect(as(principal, () => q('select public.school_add_document($1,$2,$3,$4,$5)', [ada, 'other', 'big.pdf', 'application/pdf', 'data:application/pdf;base64,' + 'A'.repeat(2200000)]))).rejects.toThrow(/too large/)
    const id = (await as(principal, () => q<{ id: string }>('select public.school_add_document($1,$2,$3,$4,$5) as id', [ada, 'birth_certificate', 'Birth cert.pdf', 'application/pdf', data])))[0].id
    expect((await as(principal, () => q('select id from public.school_documents where student_id=$1', [ada]))).length).toBe(1)
    expect(await as(teacher, () => q('select 1 from public.school_documents'))).toHaveLength(0) // not for teachers
    expect(await as(parent, () => q('select 1 from public.school_documents'))).toHaveLength(0)
    expect((await q<{ metadata: { name: string } }>(`select metadata from public.audit_logs where business_id=$1 and action='school_document.add'`, [biz]))[0].metadata.name).toBe('Birth cert.pdf')
    await expect(as(teacher, () => q('select public.school_delete_document($1)', [id]))).rejects.toThrow(/permission denied/)
    await as(principal, () => q('select public.school_delete_document($1)', [id]))
    expect(await q('select 1 from public.school_documents where id=$1', [id])).toHaveLength(0)
  })

  it('goes with the student when the student is deleted', async () => {
    const x = await reg('Gone Soon', p2)
    await as(principal, () => q('select public.school_set_student_photo($1,$2)', [x, tiny]))
    await as(owner, () => q('select public.school_delete_student($1,$2)', [x, 'Entered twice by mistake']))
    expect(await q('select 1 from public.school_student_photos where student_id=$1', [x])).toHaveLength(0)
  })
})
