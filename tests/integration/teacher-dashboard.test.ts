import { describe, expect, it } from 'vitest'
import { attentionItems, callName, classCards, lessonState, lessonsOn, timetableDay } from '@/industries/school/teacherDashboard'
import type { Assignment, Mark, Period, Pupil, Score, Slot } from '@/industries/school/teacherDashboard'

const periods: Period[] = [
  { id: 'p1', label: 'Period 1', startsAt: '08:00', endsAt: '08:40', isBreak: false, position: 1 },
  { id: 'br', label: 'Break', startsAt: '08:40', endsAt: '09:00', isBreak: true, position: 2 },
  { id: 'p2', label: 'Period 2', startsAt: '09:00', endsAt: '09:40', isBreak: false, position: 3 },
]
const slots: Slot[] = [
  { classId: 'c1', day: 1, periodId: 'p2', subjectId: 'math', staffId: 't1', room: 'Lab' },
  { classId: 'c1', day: 1, periodId: 'p1', subjectId: 'chem', staffId: 't1', room: null },
  { classId: 'c2', day: 1, periodId: 'p1', subjectId: 'eng', staffId: 't2', room: null },
  { classId: 'c1', day: 1, periodId: 'br', subjectId: 'x', staffId: 't1', room: null },
  { classId: 'c1', day: 2, periodId: 'p1', subjectId: 'math', staffId: 't1', room: null },
]
const mine: Assignment[] = [
  { staffId: 't1', classId: 'c1', subjectId: 'chem', classTeacher: true }, { staffId: 't1', classId: 'c1', subjectId: 'math', classTeacher: false }, { staffId: 't1', classId: 'c3', subjectId: null, classTeacher: true },
]
const pupils: Pupil[] = [
  { id: 'a', classId: 'c1', status: 'active' }, { id: 'b', classId: 'c1', status: 'active' }, { id: 'c', classId: 'c1', status: 'withdrawn' }, { id: 'd', classId: 'c2', status: 'active' }, { id: 'e', classId: 'c3', status: 'active' },
]
const score = (studentId: string, subjectId: string, status: Score['status'], ca: number | null = 20, exam: number | null = 30): Score => ({ studentId, classId: 'c1', subjectId, termId: 't', ca, exam, status })

describe('how to address a teacher', () => {
  it('keeps a title with the first name, and uses the first name alone otherwise', () => {
    expect(callName('Mr. Ibrahim Musa')).toBe('Mr. Ibrahim'); expect(callName('Mrs Okafor Ada')).toBe('Mrs Okafor'); expect(callName('Ada Obi')).toBe('Ada'); expect(callName('Dr. Bello')).toBe('Dr. Bello')
    expect(callName('Mr.')).toBe('Mr.'); expect(callName('')).toBe(''); expect(callName(null)).toBe(''); expect(callName('ada@example.com')).toBe('')
  })
})

describe("today's lessons", () => {
  it('counts the week from Monday as 1 to Sunday as 7', () => { expect([new Date(2026, 9, 26), new Date(2026, 9, 28), new Date(2026, 9, 31), new Date(2026, 10, 1)].map(timetableDay)).toEqual([1, 3, 6, 7]) })
  it('lists only this teacher\'s lessons for the day, in school-day order, without breaks', () => {
    const l = lessonsOn(1, periods, slots, 't1')
    expect(l.map((x) => [x.period.label, x.subjectId, x.room])).toEqual([['Period 1', 'chem', null], ['Period 2', 'math', 'Lab']])
    expect(lessonsOn(2, periods, slots, 't1')).toHaveLength(1); expect(lessonsOn(3, periods, slots, 't1')).toEqual([]); expect(lessonsOn(1, periods, slots, 'nobody')).toEqual([])
  })
  it('says which lesson is over, which is on now and which is still to come', () => {
    const [first, second] = lessonsOn(1, periods, slots, 't1')
    expect(['07:30', '08:00', '08:39', '08:40', '09:10', '09:40'].map((t) => lessonState(first, t))).toEqual(['later', 'now', 'now', 'done', 'done', 'done'])
    expect(['08:59', '09:00', '09:39', '09:40'].map((t) => lessonState(second, t))).toEqual(['later', 'now', 'now', 'done'])
  })
})

describe('the teacher\'s classes', () => {
  const marks: Mark[] = [{ classId: 'c1', on: '2026-10-28' }, { classId: 'c1', on: '2026-10-28' }, { classId: 'c2', on: '2026-10-28' }, { classId: 'c3', on: '2026-10-27' }]
  const scores: Score[] = [score('a', 'chem', 'draft'), score('b', 'chem', 'submitted'), score('c', 'chem', 'published'), score('a', 'math', 'draft', null, null)]
  const cards = classCards(mine, pupils, marks, scores, 't', '2026-10-28')
  it('has one card per class they are assigned to, counting only pupils still at the school', () => {
    expect(cards.map((c) => [c.classId, c.pupils, c.classTeacher])).toEqual([['c1', 2, true], ['c3', 1, true]])
  })
  it('knows whether today\'s register was taken, and how many were marked', () => { expect(cards.map((c) => c.registerMarked)).toEqual([2, 0]) })
  it('follows each of their subjects: how many pupils have a score, and in which state, ignoring pupils who left and empty rows', () => {
    expect(cards[0].subjects).toEqual([
      { subjectId: 'chem', pupils: 2, entered: 2, draft: 1, submitted: 1, approved: 0, published: 0 },
      { subjectId: 'math', pupils: 2, entered: 0, draft: 1, submitted: 0, approved: 0, published: 0 },
    ])
    expect(cards[1].subjects).toEqual([])
  })
})

describe('what needs doing', () => {
  const cards = classCards(mine, pupils, [{ classId: 'c1', on: '2026-10-28' }], [score('a', 'chem', 'draft'), score('b', 'chem', 'draft')], 't', '2026-10-28')
  const name = (id: string) => ({ c1: 'SS 1 Science', c3: 'JSS 2' })[id] ?? id
  const subject = (id: string) => ({ chem: 'Chemistry', math: 'Mathematics' })[id] ?? id
  it('asks for the register of a class that has none today, and for the scores still missing', () => {
    const a = attentionItems(cards, name, subject, true)
    expect(a.map((x) => x.text)).toEqual(["Take today's register for JSS 2 (1 pupil)", 'Mathematics, SS 1 Science: 2 of 2 pupils still need a score'])
    expect(a.map((x) => x.kind)).toEqual(['register', 'results']); expect(a.every((x) => x.to.startsWith('/app/school/'))).toBe(true)
  })
  it('does not ask for a register on a day without school, and says nothing when everything is done', () => {
    expect(attentionItems(cards, name, subject, false).map((x) => x.kind)).toEqual(['results'])
    const done = classCards([{ staffId: 't1', classId: 'c1', subjectId: 'chem', classTeacher: false }], pupils, [{ classId: 'c1', on: '2026-10-28' }], [score('a', 'chem', 'draft'), score('b', 'chem', 'draft')], 't', '2026-10-28')
    expect(attentionItems(done, name, subject, true)).toEqual([])
  })
})
