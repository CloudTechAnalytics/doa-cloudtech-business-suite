/**
 * What a teacher's dashboard shows, worked out from the records they are allowed to read: today's lessons from the timetable, and for each of their classes the
 * pupils, whether today's register was taken, and how far the results have got. Kept apart from the screen so it can be tested.
 */
export interface Period { id: string; label: string; startsAt: string; endsAt: string; isBreak: boolean; position: number }
export interface Slot { classId: string; day: number; periodId: string; subjectId: string; staffId: string | null; room: string | null }
export interface Assignment { staffId: string; classId: string; subjectId: string | null; classTeacher: boolean }
export interface Pupil { id: string; classId: string | null; status: string }
export interface Mark { classId: string; on: string }
export interface Score { studentId: string; classId: string; subjectId: string; termId: string; ca: number | null; exam: number | null; status: 'draft' | 'submitted' | 'approved' | 'published' }

const TITLES = /^(mr|mrs|miss|ms|dr|prof|engr|chief|pastor|rev|alhaji|alhaja|sir|madam|barr|hon)\.?$/i

/** How to address a teacher: "Mr. Ibrahim" from "Mr. Ibrahim Musa", "Ada" from "Ada Obi". */
export function callName(full: string | null | undefined): string {
  const t = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (!t.length || t[0].includes('@')) return ''
  return t.length > 1 && TITLES.test(t[0]) ? `${t[0]} ${t[1]}` : t[0]
}

/** Monday is 1 and Sunday is 7, as the timetable counts. */
export const timetableDay = (d: Date) => ((d.getDay() + 6) % 7) + 1

export interface Lesson { period: Period; classId: string; subjectId: string; room: string | null }

/** This teacher's lessons on a day, in the order of the school day. Breaks are not lessons. */
export function lessonsOn(day: number, periods: Period[], slots: Slot[], staffId: string): Lesson[] {
  return slots
    .filter((s) => s.day === day && s.staffId === staffId)
    .map((s) => ({ period: periods.find((p) => p.id === s.periodId)!, classId: s.classId, subjectId: s.subjectId, room: s.room }))
    .filter((l) => l.period && !l.period.isBreak)
    .sort((a, b) => a.period.position - b.period.position)
}

/** Where a lesson is relative to the clock: it already finished, is on now, or comes later. Times are "HH:MM". */
export function lessonState(l: Pick<Lesson, 'period'>, nowHHMM: string): 'done' | 'now' | 'later' {
  if (nowHHMM >= l.period.endsAt) return 'done'
  return nowHHMM >= l.period.startsAt ? 'now' : 'later'
}

export interface SubjectProgress { subjectId: string; pupils: number; entered: number; draft: number; submitted: number; approved: number; published: number }
export interface ClassCard { classId: string; pupils: number; classTeacher: boolean; registerMarked: number; subjects: SubjectProgress[] }

/** One card per class the teacher is assigned to, with today's register and the progress of each of their subjects' results this term. */
export function classCards(mine: Assignment[], pupils: Pupil[], marks: Mark[], scores: Score[], termId: string, todayIso: string): ClassCard[] {
  const classIds = [...new Set(mine.map((a) => a.classId))]
  return classIds.map((classId) => {
    const roster = pupils.filter((p) => p.classId === classId && p.status === 'active')
    const ids = new Set(roster.map((p) => p.id))
    const subjects = [...new Set(mine.filter((a) => a.classId === classId && a.subjectId).map((a) => a.subjectId!))].map((subjectId) => {
      const rows = scores.filter((s) => s.classId === classId && s.subjectId === subjectId && s.termId === termId && ids.has(s.studentId))
      const entered = rows.filter((s) => s.ca !== null || s.exam !== null)
      const count = (st: Score['status']) => rows.filter((s) => s.status === st).length
      return { subjectId, pupils: roster.length, entered: entered.length, draft: count('draft'), submitted: count('submitted'), approved: count('approved'), published: count('published') }
    })
    return { classId, pupils: roster.length, classTeacher: mine.some((a) => a.classId === classId && a.classTeacher), registerMarked: marks.filter((m) => m.classId === classId && m.on === todayIso).length, subjects }
  })
}

export interface Attention { kind: 'register' | 'results'; classId: string; subjectId?: string; text: string; to: string }

/** What needs doing today, most urgent first: registers not yet taken, then subjects where some pupils have no score yet. Nothing when all is done. */
export function attentionItems(cards: ClassCard[], className: (id: string) => string, subjectName: (id: string) => string, isSchoolDay: boolean): Attention[] {
  const out: Attention[] = []
  if (isSchoolDay) for (const c of cards) if (c.pupils > 0 && c.registerMarked === 0) out.push({ kind: 'register', classId: c.classId, text: `Take today's register for ${className(c.classId)} (${c.pupils} pupil${c.pupils === 1 ? '' : 's'})`, to: '/app/school/attendance' })
  for (const c of cards) for (const s of c.subjects) {
    const left = s.pupils - s.entered
    if (s.pupils > 0 && left > 0) out.push({ kind: 'results', classId: c.classId, subjectId: s.subjectId, text: `${subjectName(s.subjectId)}, ${className(c.classId)}: ${left} of ${s.pupils} pupil${s.pupils === 1 ? '' : 's'} still need a score`, to: '/app/school/results' })
  }
  return out
}
