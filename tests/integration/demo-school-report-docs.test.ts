import { beforeAll, describe, expect, it } from 'vitest'
import { getIndustry } from '@/core/industry-registry'
import * as sc from '@/demo/demoSchool'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
let biz: string, p1: string, ada: string, bola: string, term1: string, term2: string, session: string
const pic = 'data:image/jpeg;base64,' + 'A'.repeat(300)

beforeAll(async () => {
  as('owner@demo.test')
  biz = demoCreateBusiness('Report Academy', 'school')
  await getIndustry('school').afterCreate!(biz, { school_type: 'primary', session_name: '2026/2027' })
  sc.demoSaveSettings(biz, { schoolType: 'primary', address: '', phone: '', email: '', caMax: 40, examMax: 60, showPosition: true, workingDays: [1, 2, 3, 4, 5] })
  const st = sc.demoStructure(biz)
  p1 = st.classes.find((c) => c.name === 'Primary 1')!.id
  ;[term1, term2] = st.terms.map((t) => t.id); session = st.sessions[0].id
  const reg = (first: string) => { expect(sc.demoRegisterStudent(biz, { first, middle: '', last: 'Pupil', dob: '', gender: '', classId: p1, admittedOn: '2026-09-01', emergencyName: '', emergencyPhone: '', notes: '' }, [], `key-${first}-abcdefgh`).error).toBeNull(); return sc.demoStudents(biz).find((x) => x.first === first)!.id }
  ada = reg('Ada'); bola = reg('Bola')
  const sub = (n: string) => st.subjects.find((x) => x.name === n)!.id
  const score = (subject: string, term: string, marks: [string, number, number][]) => {
    expect(sc.demoSaveScores(biz, p1, subject, term, marks.map(([studentId, ca, exam]) => ({ studentId, ca, exam })), true).error).toBeNull()
    for (const a of ['approve', 'publish'] as const) expect(sc.demoReviewScores(biz, p1, subject, term, a, '').error).toBeNull()
  }
  score(sub('English Language'), term1, [[ada, 30, 50], [bola, 20, 40]]); score(sub('Mathematics'), term1, [[ada, 20, 30], [bola, 35, 55]])
  score(sub('English Language'), term2, [[ada, 35, 55], [bola, 25, 35]]); score(sub('Mathematics'), term2, [[ada, 30, 50], [bola, 20, 30]])
})

describe('skills and ready-made comments (demo)', () => {
  it('start with the standard lists, changeable by managers only', () => {
    const traits = sc.demoTraits(biz)
    expect(traits.filter((t) => t.domain === 'affective').map((t) => t.name)).toContain('Punctuality'); expect(traits.filter((t) => t.domain === 'psychomotor')).toHaveLength(5)
    expect(sc.demoTemplates(biz).length).toBeGreaterThan(5)
    as('teacher@demo.test')
    expect(sc.demoSaveTraits(biz, [{ domain: 'affective', name: 'X' }])).toMatch(/permission denied/)
    as('owner@demo.test')
    expect(sc.demoSaveTraits(biz, [{ domain: 'affective', name: 'Punctuality' }, { domain: 'affective', name: 'Leadership' }])).toBeNull()
    expect(sc.demoTraits(biz).map((t) => t.name)).toEqual(['Punctuality', 'Leadership'])
    expect(sc.demoSaveTraits(biz, [{ domain: 'affective' as const, name: ' ' }])).toMatch(/needs a name/)
    expect(sc.demoSaveTemplates(biz, [{ kind: 'teacher', text: 'Good effort.' }, { kind: 'teacher', text: 'Good effort.' }, { kind: 'principal', text: 'Promoted.' }])).toBeNull()
    expect(sc.demoTemplates(biz).map((t) => t.text)).toEqual(['Good effort.', 'Promoted.'])
  })

  it('are rated per student and term, and appear on the report card with the position in each subject', () => {
    const lead = sc.demoTraits(biz).find((t) => t.name === 'Leadership')!
    expect(sc.demoSaveRatings(biz, ada, term1, [{ traitId: lead.id, rating: 6 }])).toMatch(/1 to 5/)
    expect(sc.demoSaveRatings(biz, ada, term1, [{ traitId: lead.id, rating: 5 }])).toBeNull()
    const card = sc.demoReportCard(biz, ada, term1)
    expect(card.skills).toEqual([{ domain: 'affective', name: 'Leadership', rating: 5 }])
    expect(card.subjects.find((x) => x.subject === 'English Language')).toMatchObject({ total: 80, position: 1 })
    expect(card.subjects.find((x) => x.subject === 'Mathematics')).toMatchObject({ total: 50, position: 2 })
    expect(sc.demoSaveRatings(biz, ada, term1, [{ traitId: lead.id, rating: null }])).toBeNull()
    expect(sc.demoReportCard(biz, ada, term1).skills).toEqual([])
  })
})

describe('the annual card (demo)', () => {
  it('adds up the terms into subject averages, an overall average, a grade and a position', () => {
    const c = sc.demoAnnualCard(biz, ada, session)
    expect(c.terms.map((t) => t.name)).toEqual(['First Term', 'Second Term', 'Third Term'])
    expect(c.subjects.find((x) => x.subject === 'English Language')).toMatchObject({ terms: [80, 90, null], average: 85, grade: 'A' })
    expect(c.average).toBe(75); expect(c).toMatchObject({ position: 1, classSize: 2 })
    expect(sc.demoAnnualCard(biz, bola, session).position).toBe(2)
  })
})

describe('graduating a group at once (demo)', () => {
  it('needs permission, graduates only active students and ends their enrolment', () => {
    const sample = sc.demoStudents('b-school')[0].id
    as('teacher@demo.test'); expect(sc.demoGraduate('b-school', [sample], 'done').error).toMatch(/permission denied/)
    as('owner@demo.test')
    expect(sc.demoGraduate(biz, [], 'done').error).toMatch(/choose the students/)
    expect(sc.demoGraduate(biz, [ada, ada, 'nobody'], 'Completed Primary 1').result).toBe(1)
    expect(sc.demoStudents(biz).find((x) => x.id === ada)).toMatchObject({ status: 'graduated', statusReason: 'Completed Primary 1' })
    expect(sc.demoGraduate(biz, [ada], 'again').result).toBe(0)
  })
})

describe('photos and documents (demo)', () => {
  it('lets people who manage students keep a photo and papers, with limits', () => {
    const id = sc.demoStudents(biz).find((x) => x.id === bola)!.id
    const sample = sc.demoStudents('b-school')[0].id
    as('teacher@demo.test'); expect(sc.demoSetPhoto('b-school', sample, pic)).toMatch(/permission denied/)
    as('owner@demo.test')
    expect(sc.demoSetPhoto(biz, id, 'not a picture')).toMatch(/JPEG, PNG or WebP/)
    expect(sc.demoSetPhoto(biz, id, 'data:image/jpeg;base64,' + 'A'.repeat(130000))).toMatch(/too large/)
    expect(sc.demoSetPhoto(biz, id, pic)).toBeNull(); expect(sc.demoPhotos(biz, [id])).toEqual({ [id]: pic })
    expect(sc.demoSetPhoto(biz, id, null)).toBeNull(); expect(sc.demoPhotos(biz, [id])).toEqual({})

    const data = 'data:application/pdf;base64,' + 'JVBERi0x'.repeat(20)
    expect(sc.demoAddDocument(biz, id, 'secret' as sc.DocumentKind, 'x.pdf', 'application/pdf', data)).toMatch(/what kind/)
    expect(sc.demoAddDocument(biz, id, 'other', 'x.exe', 'application/x-msdownload', data)).toMatch(/PDF/)
    expect(sc.demoAddDocument(biz, id, 'other', 'big.pdf', 'application/pdf', 'data:application/pdf;base64,' + 'A'.repeat(2_200_000))).toMatch(/too large/)
    expect(sc.demoAddDocument(biz, id, 'birth_certificate', 'Birth cert.pdf', 'application/pdf', data)).toBeNull()
    const docs = sc.demoDocuments(biz, id)
    expect(docs).toHaveLength(1); expect(docs[0]).not.toHaveProperty('data'); expect(sc.demoDocumentData(biz, docs[0].id)).toBe(data)
    as('teacher@demo.test'); expect(sc.demoDocuments(biz, id)).toEqual([])
    as('owner@demo.test')
    expect(sc.demoDeleteDocument(biz, docs[0].id)).toBeNull(); expect(sc.demoDocuments(biz, id)).toEqual([])
  })

  it('go when the student is deleted', () => {
    expect(sc.demoSetPhoto(biz, bola, pic)).toBeNull()
    expect(sc.demoAddDocument(biz, bola, 'other', 'a.pdf', 'application/pdf', 'data:application/pdf;base64,QUJD')).toBeNull()
    expect(sc.demoDeleteStudent(biz, bola, 'Entered twice by mistake')).toBeNull()
    expect(sc.demoPhotos(biz, [bola])).toEqual({}); expect(sc.demoDocuments(biz, bola)).toEqual([])
  })
})

describe('registering with a passport photo', () => {
  it('returns the new student so the photo can be saved in the same step', async () => {
    const { registerStudentWithId, setPhoto, loadPhotos } = await import('@/industries/school/services/schoolApi')
    as('owner@demo.test')
    const input = { first: 'Zara', middle: '', last: 'Photo', dob: '', gender: 'female', classId: p1, admittedOn: '2026-09-01', emergencyName: '', emergencyPhone: '', notes: '' }
    const r = await registerStudentWithId(biz, input, [], 'key-zara-photo-1')
    expect(r.error).toBeNull(); expect(r.studentId).toBeTruthy()
    expect(await setPhoto(biz, r.studentId!, pic)).toBeNull()
    expect(await loadPhotos(biz, [r.studentId!])).toEqual({ [r.studentId!]: pic })
    const again = await registerStudentWithId(biz, input, [], 'key-zara-photo-1') // a retry with the same key never registers twice
    expect(again.studentId).toBe(r.studentId)
  })
})
