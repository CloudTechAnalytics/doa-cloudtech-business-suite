import { beforeAll, describe, expect, it } from 'vitest'
import { demoSignIn, demoSignOut } from '@/demo/demoStore'
import * as sc from '@/demo/demoSchool'

const B = 'b-school'
let n = 0
const key = () => `dsc-${n++}-abcdefgh`
const as = (email: string) => { demoSignOut(); demoSignIn(email, 'demo1234') }
/** The most recent weekday that is not in the future. */
const lastWeekday = () => { const d = new Date(); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) }
const student = (first: string) => sc.demoStudents(B).find((s) => s.first === first)!
const input = (over: Partial<sc.StudentInput> = {}): sc.StudentInput => ({ first: 'Test', middle: '', last: 'Pupil', dob: '2016-05-01', gender: 'female', classId: sc.demoStructure(B).classes[0].id, admittedOn: lastWeekday(), emergencyName: '', emergencyPhone: '', notes: '', ...over })

beforeAll(() => { demoSignIn('owner@demo.test', 'demo1234'); sc.demoStructure(B) })

describe('demo school follows the database rules', () => {
  it('seeds a school with classes, terms, grades, students and fees', () => {
    const s = sc.demoStructure(B)
    expect(s.classes.length).toBeGreaterThan(3); expect(s.terms.some((t) => t.current)).toBe(true); expect(s.bands.some((b) => b.min === 0)).toBe(true)
    expect(sc.demoStudents(B).length).toBeGreaterThanOrEqual(10); expect(sc.demoFeeItems(B).length).toBeGreaterThan(0)
  })

  it('registers a student with a never-reused admission number and links the parent', () => {
    const a = sc.demoRegisterStudent(B, input(), [{ name: 'Mrs Pupil', phone: '0800', email: 'pupil@example.test', relationship: 'mother', primary: true }], key())
    expect(a.error).toBeNull()
    const again = sc.demoRegisterStudent(B, input({ first: 'Second' }), [], key())
    expect(again.result!.admissionNo).not.toBe(a.result!.admissionNo)
    expect(sc.demoLinks(B).some((l) => l.studentId === a.result!.studentId)).toBe(true)
  })

  it('refuses a duplicate submit with the same key and invalid input', () => {
    const k = key(); const before = sc.demoStudents(B).length
    sc.demoRegisterStudent(B, input({ first: 'Once' }), [], k); sc.demoRegisterStudent(B, input({ first: 'Once' }), [], k)
    expect(sc.demoStudents(B).length).toBe(before + 1)
    expect(sc.demoRegisterStudent(B, input({ first: '' }), [], key()).error).toMatch(/name/i)
  })

  it('scopes a teacher to assigned classes and rejects future or weekend attendance', () => {
    as('owner@demo.test')
    const mine = sc.demoAssignments(B).filter((a) => a.staffId === sc.demoStaff(B).find((x) => x.email === 'teacher@demo.test')?.id)
    expect(mine.length).toBeGreaterThan(0)
    as('teacher@demo.test'); sc.demoClaimLinks(B)
    const own = mine[0].classId; const other = sc.demoStructure(B).classes.find((c) => !mine.some((m) => m.classId === c.id))!.id
    const ok = sc.demoStudents(B).filter((s) => s.classId === own && s.status === 'active').map((s) => ({ studentId: s.id, status: 'present' as const }))
    expect(sc.demoMarkAttendance(B, own, lastWeekday(), ok).error).toBeNull()
    expect(sc.demoMarkAttendance(B, other, lastWeekday(), ok).error).toMatch(/permission|assigned|class/i)
    expect(sc.demoMarkAttendance(B, own, new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), ok).error).toMatch(/future/i)
    const sat = new Date(); sat.setDate(sat.getDate() - ((sat.getDay() + 1) % 7 || 7))
    expect(sc.demoMarkAttendance(B, own, sat.toISOString().slice(0, 10), ok).error).toBeTruthy()
  })

  it('validates scores, then approves and publishes so a parent sees only published results', () => {
    as('owner@demo.test')
    const s = sc.demoStructure(B)
    const cur = s.terms.find((t) => t.current)!
    expect(sc.demoSaveTerm(B, { id: null, sessionId: cur.sessionId, name: 'Test term', startsOn: cur.startsOn, endsOn: cur.endsOn, current: false })).toBeNull()
    const term = sc.demoStructure(B).terms.find((t) => t.name === 'Test term')!.id // a term with no scores yet
    const a = sc.demoAssignments(B).find((x) => x.subjectId)!
    as('teacher@demo.test'); sc.demoClaimLinks(B)
    const kids = sc.demoStudents(B).filter((x) => x.classId === a.classId && x.status === 'active')
    const over = sc.demoSaveScores(B, a.classId, a.subjectId!, term, [{ studentId: kids[0].id, ca: s.settings!.caMax + 1, exam: 10 }], false)
    expect(over.error).toMatch(/between 0 and/i)
    expect(sc.demoSaveScores(B, a.classId, a.subjectId!, term, kids.map((k) => ({ studentId: k.id, ca: 30, exam: 50 })), true).error).toBeNull()
    expect(sc.demoReviewScores(B, a.classId, a.subjectId!, term, 'approve', '').error).toMatch(/permission/i) // a teacher cannot approve
    as('principal@demo.test')
    expect(sc.demoReviewScores(B, a.classId, a.subjectId!, term, 'approve', '').error).toBeNull()
    expect(sc.demoReviewScores(B, a.classId, a.subjectId!, term, 'publish', '').error).toBeNull()
    as('teacher@demo.test')
    expect(sc.demoSaveScores(B, a.classId, a.subjectId!, term, [{ studentId: kids[0].id, ca: 1, exam: 1 }], false).error).toBeTruthy() // locked once approved
    as('principal@demo.test')
    expect(sc.demoReviewScores(B, a.classId, a.subjectId!, term, 'unpublish', 'Fixing a mark').error).toBeNull()
    as('parent@demo.test')
    expect(sc.demoClaimLinks(B)).toBeGreaterThanOrEqual(0)
    expect(sc.demoStudents(B).every((x) => ['Ada', 'Bola'].includes(x.first))).toBe(true) // only linked children
    expect(sc.demoScores(B).every((x) => x.status === 'published')).toBe(true)
  })

  it('bills, takes partial payments, refuses overpayment and reverses with the balance restored', () => {
    as('bursar@demo.test')
    const term = sc.demoStructure(B).terms.find((t) => t.current)!.id
    sc.demoGenerateBills(B, term, null, null, key())
    const again = sc.demoGenerateBills(B, term, null, null, key())
    expect(again.result!.created).toBe(0)
    const bill = sc.demoBills(B).find((b) => b.balance > 100)!
    const k = key(); const p1 = sc.demoRecordPayment(B, bill.id, 100, 'cash', '', k)
    expect(p1.error).toBeNull(); expect(sc.demoRecordPayment(B, bill.id, 100, 'cash', '', k).result!.receipt).toBe(p1.result!.receipt) // same key, one payment
    expect(sc.demoRecordPayment(B, bill.id, bill.balance * 2, 'cash', '', key()).error).toMatch(/balance|more than/i)
    const after = sc.demoBills(B).find((b) => b.id === bill.id)!
    expect(after.balance).toBe(bill.balance - 100)
    const pay = sc.demoPayments(B).find((x) => x.receipt === p1.result!.receipt)!
    expect(sc.demoReversePayment(B, pay.id, '')).toBeTruthy() // reason needed
    expect(sc.demoReversePayment(B, pay.id, 'Wrong student')).toBeNull()
    expect(sc.demoBills(B).find((b) => b.id === bill.id)!.balance).toBe(bill.balance)
    expect(sc.demoPayments(B).find((x) => x.id === pay.id)!.status).toBe('reversed')
  })

  it('keeps fees away from teachers and other families away from a parent', () => {
    as('teacher@demo.test')
    expect(sc.demoBills(B)).toEqual([])
    as('parent@demo.test')
    sc.demoClaimLinks(B)
    const mine = new Set(sc.demoStudents(B).map((x) => x.id))
    expect(sc.demoBills(B).every((b) => mine.has(b.studentId))).toBe(true)
    expect(sc.demoSaveSettings(B, { schoolType: 'primary', address: '', phone: '', email: '', caMax: 40, examMax: 60, showPosition: false, workingDays: [1, 2, 3, 4, 5] })).toMatch(/permission/i)
  })

  it('promotes students and keeps the enrolment history; leaving keeps their records', () => {
    as('owner@demo.test')
    const s = sc.demoStructure(B); const st = student('Ada'); const to = s.classes.find((c) => c.id !== st.classId)!.id
    expect(sc.demoPromote(B, [{ studentId: st.id, classId: to }], 'Promoted').error).toBeNull()
    const h = sc.demoEnrollments(B, st.id)
    expect(h.length).toBeGreaterThanOrEqual(2); expect(h.filter((e) => !e.endedOn)).toHaveLength(1)
    expect(sc.demoSetStudentStatus(B, st.id, 'withdrawn', 'Moved away')).toBeNull()
    expect(sc.demoStudents(B).find((x) => x.id === st.id)!.status).toBe('withdrawn')
    expect(sc.demoAttendance(B).some((a) => a.studentId === st.id)).toBe(true)
    expect(sc.demoSetStudentStatus(B, st.id, 'active', '')).toBeNull()
  })

  it('accepts an application into a student and rejects with a note', () => {
    as('owner@demo.test')
    const cls = sc.demoStructure(B).classes[0].id
    const a = sc.demoApply(B, { first: 'New', last: 'Applicant', dob: '2017-01-01', gender: 'male', classId: cls, guardianName: 'Mr Applicant', guardianPhone: '0801', guardianEmail: 'applicant@example.test', relationship: 'father' }, key())
    expect(a.error).toBeNull()
    const ok = sc.demoDecideAdmission(B, a.result!.admissionId, 'accept', cls, '')
    expect(ok.error).toBeNull(); expect(ok.result!.studentId).toBeTruthy()
    expect(sc.demoDecideAdmission(B, a.result!.admissionId, 'accept', cls, '').error).toBeTruthy() // already decided
    const b = sc.demoApply(B, { first: 'Other', last: 'Applicant', dob: '', gender: '', classId: cls, guardianName: 'X Parent', guardianPhone: '', guardianEmail: '', relationship: 'parent' }, key())
    expect(sc.demoDecideAdmission(B, b.result!.admissionId, 'reject', null, '').error).toBeTruthy()
    expect(sc.demoDecideAdmission(B, b.result!.admissionId, 'reject', null, 'No space').error).toBeNull()
  })

  it('reports an overview that reconciles with the records', () => {
    as('owner@demo.test')
    const o = sc.demoSchoolOverview(B, null)
    expect(o.students).toBe(sc.demoStudents(B).filter((x) => x.status === 'active').length)
    expect(o.enrolment.reduce((a, e) => a + e.students, 0)).toBe(o.students)
    const bills = sc.demoBills(B).filter((b) => b.termId === o.termId)
    expect(o.billed).toBe(bills.reduce((a, b) => a + b.payable, 0)); expect(o.outstanding).toBe(bills.reduce((a, b) => a + b.balance, 0))
    as('bursar@demo.test')
    expect(sc.demoSchoolOverview(B, null).billed).not.toBeNull()
    as('teacher@demo.test')
    expect(() => sc.demoSchoolOverview(B, null)).toThrow(/permission/i) // no school-wide figures
  })

  it('shows only the classes and subjects of the chosen kind of school', () => {
    as('owner@demo.test')
    const settings = (type: sc.SSettings['schoolType']) => sc.demoSaveSettings(B, { schoolType: type, address: '', phone: '', email: '', caMax: 40, examMax: 60, showPosition: false, workingDays: [1, 2, 3, 4, 5] })
    expect(settings('secondary')).toMatch(/still have active students/) // pupils are in nursery and primary classes
    expect(sc.demoSaveClass(B, { id: null, name: 'No stage', levelOrder: 1, arm: '', active: true, stage: undefined as unknown as sc.Stage })).toMatch(/choose the stage/)
    for (const st of sc.demoStudents(B).filter((x) => x.status === 'active')) expect(sc.demoSetStudentStatus(B, st.id, 'withdrawn', 'Test clean-up')).toBeNull()
    expect(settings('secondary')).toBeNull()
    const active = sc.demoStructure(B).classes.filter((c) => c.active)
    expect(active.map((c) => c.stage)).toEqual(Array(active.length).fill('secondary'))
    expect(sc.demoSaveClass(B, { id: null, name: 'Nursery 3', levelOrder: 1, arm: '', active: true, stage: 'nursery' })).toMatch(/cannot have nursery classes/)
    expect(sc.demoSaveClass(B, { id: null, name: 'SS 4', levelOrder: 15, arm: '', active: true, stage: 'secondary' })).toBeNull()
    expect(settings('combined')).toBeNull()
  })

  it('lets a parent update only their own contact details', () => {
    as('parent@demo.test'); sc.demoClaimLinks(B)
    expect(sc.demoUpdateMyContact(B, '0803 111 2222', '12 Palm Street')).toBeNull()
    expect(sc.demoGuardians(B).find((g) => g.email === 'parent@demo.test')).toMatchObject({ phone: '0803 111 2222', address: '12 Palm Street' })
    expect(sc.demoUpdateMyContact(B, 'x'.repeat(41), '')).toMatch(/too long/)
    as('teacher@demo.test'); sc.demoClaimLinks(B)
    expect(sc.demoUpdateMyContact(B, '1', '1')).toMatch(/permission denied/)
  })

  it('has a timetable that managers set, teachers and parents only read, and that never double-books a teacher', () => {
    as('owner@demo.test')
    const first = sc.demoTimetable(B)
    expect(first.periods.length).toBeGreaterThan(3); expect(first.slots.length).toBeGreaterThan(10)
    const { classes } = sc.demoStructure(B)
    const p1 = classes.find((c) => c.name === 'Primary 1')!; const p2 = classes.find((c) => c.name === 'Primary 2')!
    // An earlier test narrowed the school to secondary and back; widening does not reopen the classes by itself.
    for (const c of [p1, p2]) expect(sc.demoSaveClass(B, { id: c.id, name: c.name, levelOrder: c.levelOrder, arm: '', active: true, stage: c.stage })).toBeNull()
    const lesson = first.periods.find((p) => !p.isBreak)!; const brk = first.periods.find((p) => p.isBreak)!
    const eng = sc.demoStructure(B).subjects.find((x) => x.name === 'English Language')!
    const teacher = sc.demoAssignments(B).find((a) => a.classId === p1.id && a.subjectId === eng.id)!.staffId
    expect(sc.demoSetSlot(B, p1.id, 1, brk.id, eng.id, null, '')).toMatch(/break cannot have a lesson/)
    expect(sc.demoSetSlot(B, p1.id, 6, lesson.id, eng.id, null, '')).toMatch(/not a school day/)
    expect(sc.demoSetSlot(B, p2.id, 1, lesson.id, eng.id, teacher, '')).toMatch(/not assigned/) // the teacher does not teach Primary 2
    const physics = sc.demoStructure(B).subjects.find((x) => x.name === 'Physics')!
    expect(sc.demoSetSlot(B, p1.id, 1, lesson.id, physics.id, null, '')).toMatch(/does not take that subject/)
    expect(sc.demoSavePeriods(B, [{ label: 'A', starts: '09:00', ends: '08:00', isBreak: false }])).toMatch(/end after it starts/)
    expect(sc.demoSavePeriods(B, [{ id: first.periods[0].id, label: 'Only one', starts: '08:00', ends: '08:40', isBreak: false }])).toMatch(/clear them before removing/)
    as('teacher@demo.test'); sc.demoClaimLinks(B)
    expect(sc.demoSetSlot(B, p1.id, 1, lesson.id, eng.id, teacher, '')).toMatch(/permission denied/)
    const mine = sc.demoTimetable(B)
    expect(mine.slots.length).toBeGreaterThan(0); expect(mine.slots.every((x) => x.classId === p1.id)).toBe(true)
    as('parent@demo.test'); sc.demoClaimLinks(B)
    const theirs = sc.demoTimetable(B)
    expect(theirs.slots.length).toBeGreaterThan(0); expect(theirs.slots.every((x) => ['Primary 1', 'Primary 2'].includes(classes.find((c) => c.id === x.classId)!.name))).toBe(true)
  })
})
