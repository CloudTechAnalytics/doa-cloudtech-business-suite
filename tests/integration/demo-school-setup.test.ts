import { beforeAll, describe, expect, it } from 'vitest'
import { getIndustry } from '@/core/industry-registry'
import * as sc from '@/demo/demoSchool'
import { demoCreateBusiness, demoSignIn, demoSignOut } from '@/demo/demoStore'

const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
const names = (biz: string) => sc.demoStructure(biz).classes.map((c) => c.name)
const create = async (name: string, type: string) => {
  const id = demoCreateBusiness(name, 'school')
  expect(await getIndustry('school').afterCreate!(id, { school_type: type, session_name: '2026/2027' })).toBeNull()
  return id
}

beforeAll(() => { as('owner@demo.test') })

describe('a school set up for the kind of school chosen when it is registered', () => {
  it('starts empty: no sample students, staff or fees', async () => {
    const id = await create('Fresh School', 'combined')
    expect(sc.demoStudents(id)).toEqual([]); expect(sc.demoFeeItems(id)).toEqual([]); expect(sc.demoStaff(id)).toEqual([])
    expect(sc.demoStructure(id).terms.map((t) => t.name)).toEqual(['First Term', 'Second Term', 'Third Term'])
  })

  it('builds nursery, primary, junior and senior secondary classes with departments for "all"', async () => {
    const id = await create('All Levels', 'combined')
    expect(names(id)).toHaveLength(20)
    expect(sc.demoStructure(id).departments.map((d) => d.name)).toEqual(['Art', 'Commercial', 'Science'])
    const ss = sc.demoStructure(id).classes.filter((c) => c.name.startsWith('SS '))
    expect(ss).toHaveLength(9); expect(ss.every((c) => c.departmentId)).toBe(true)
  })

  it('builds only secondary classes, departments and subjects for a secondary school', async () => {
    const id = await create('Secondary Only', 'secondary')
    expect(names(id).some((n) => n.startsWith('Nursery') || n.startsWith('Primary'))).toBe(false)
    expect(names(id)).toHaveLength(12)
    const subjects = sc.demoStructure(id).subjects.map((x) => x.name)
    expect(subjects).toEqual(expect.arrayContaining(['Physics', 'Economics', 'Literature in English'])); expect(subjects).not.toContain('Literacy')
  })

  it('builds only primary classes and subjects, and no departments, for a primary school', async () => {
    const id = await create('Primary Only', 'primary')
    expect(names(id)).toEqual(['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'])
    expect(sc.demoStructure(id).departments).toEqual([])
    expect(sc.demoStructure(id).subjects.map((x) => x.name)).not.toContain('Physics')
  })

  it('builds only nursery classes and early-years subjects for a nursery school', async () => {
    const id = await create('Nursery Only', 'nursery')
    expect(names(id)).toEqual(['Nursery 1', 'Nursery 2'])
    expect(sc.demoStructure(id).subjects.map((x) => x.name).sort()).toEqual(['Creative Arts', 'Literacy', 'Numeracy', 'Rhymes and Music', 'Social and Health Habits'])
  })

  it('gives each senior secondary class its own department\'s subjects, which the school then adjusts', async () => {
    const id = await create('Departments', 'combined')
    const st = sc.demoStructure(id)
    const subjectsOf = (cls: string) => st.classSubjects.filter((x) => x.classId === st.classes.find((c) => c.name === cls)!.id).map((x) => st.subjects.find((s) => s.id === x.subjectId)!.name)
    expect(subjectsOf('SS 2 Science')).toEqual(expect.arrayContaining(['Physics', 'Chemistry'])); expect(subjectsOf('SS 2 Science')).not.toContain('Economics')
    expect(subjectsOf('SS 2 Commercial')).toEqual(expect.arrayContaining(['Economics', 'Financial Accounting'])); expect(subjectsOf('SS 2 Commercial')).not.toContain('Physics')
    const art = st.classes.find((c) => c.name === 'SS 1 Art')!; const physics = st.subjects.find((x) => x.name === 'Physics')!
    expect(sc.demoSetClassSubjects(id, art.id, [...st.classSubjects.filter((x) => x.classId === art.id).map((x) => x.subjectId), physics.id])).toBeNull() // picking is allowed
  })

  it('can create, rename and delete departments, but only unused ones', async () => {
    const id = await create('Dept School', 'combined')
    expect(sc.demoSaveDepartment(id, { id: null, name: 'Science' })).toMatch(/duplicate key/)
    expect(sc.demoSaveDepartment(id, { id: null, name: 'Technical' })).toBeNull()
    const tech = sc.demoStructure(id).departments.find((d) => d.name === 'Technical')!
    expect(sc.demoSaveClass(id, { id: null, name: 'SS 4 Technical', levelOrder: 15, arm: '', active: true, stage: 'secondary', departmentId: tech.id })).toBeNull()
    expect(sc.demoDeleteDepartment(id, tech.id)).toMatch(/still has classes or subjects/)
    expect(sc.demoSaveClass(id, { id: null, name: 'Primary 9', levelOrder: 9, arm: '', active: true, stage: 'primary', departmentId: tech.id })).toMatch(/only secondary classes/)
    const sci = sc.demoStructure(id).departments.find((d) => d.name === 'Science')!
    expect(sc.demoDeleteDepartment(id, sci.id)).toMatch(/still has classes or subjects/)
  })
})

describe('deleting a student or a parent in the demo', () => {
  const B = 'b-school'
  it('is for owners and business admins only, with a reason', () => {
    as('principal@demo.test')
    const st = sc.demoStudents(B)[0]
    expect(sc.demoDeleteStudent(B, st.id, 'asked to')).toMatch(/permission denied/)
    as('teacher@demo.test')
    expect(sc.demoDeleteStudent(B, st.id, 'asked to')).toMatch(/permission denied/)
    as('owner@demo.test')
    expect(sc.demoDeleteStudent(B, st.id, '')).toMatch(/say why/)
  })

  it('refuses a student who has fee payments on record, and erases one who has none with their records', () => {
    as('owner@demo.test')
    const withPayment = sc.demoStudents(B).find((x) => sc.demoPayments(B).some((p) => p.studentId === x.id))!
    expect(sc.demoDeleteStudent(B, withPayment.id, 'duplicate entry')).toMatch(/fee payments on record/)
    const without = sc.demoStudents(B).find((x) => !sc.demoPayments(B).some((p) => p.studentId === x.id))!
    expect(sc.demoDeleteStudent(B, without.id, 'Entered twice by mistake')).toBeNull()
    expect(sc.demoStudents(B).some((x) => x.id === without.id)).toBe(false)
    expect(sc.demoScores(B).some((x) => x.studentId === without.id)).toBe(false)
    expect(sc.demoAttendance(B).some((x) => x.studentId === without.id)).toBe(false)
    expect(sc.demoBills(B).some((x) => x.studentId === without.id)).toBe(false)
  })

  it('deletes a parent record and its links', () => {
    as('principal@demo.test')
    const g = sc.demoGuardians(B)[0]
    expect(sc.demoDeleteGuardian(B, g.id, 'wrong person')).toMatch(/permission denied/)
    as('owner@demo.test')
    expect(sc.demoDeleteGuardian(B, g.id, 'Duplicate record')).toBeNull()
    expect(sc.demoGuardians(B).some((x) => x.id === g.id)).toBe(false)
    expect(sc.demoLinks(B).some((l) => l.guardianId === g.id)).toBe(false)
  })

  it('has a report card with the school\'s details, the grading key, the next term and class figures', () => {
    as('owner@demo.test')
    const st = sc.demoStudents(B).find((x) => sc.demoScores(B).some((s) => s.studentId === x.id && s.status === 'published'))!
    const term = sc.demoScores(B).find((s) => s.studentId === st.id && s.status === 'published')!.termId
    const card = sc.demoReportCard(B, st.id, term)
    expect(card.school?.name).toBe('Bright Future Academy'); expect(card.bands?.map((b) => b.grade)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(card.subjects[0].classAvg).not.toBeNull(); expect(card.subjects[0].highest).toBeGreaterThanOrEqual(card.subjects[0].lowest ?? 0)
  })
})
