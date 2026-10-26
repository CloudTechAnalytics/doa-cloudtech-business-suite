import { addDays, r2, today } from '@/demo/demoBakery'
import { newId } from '@/demo/demoInventory'
import { demoCancelInvite, demoCreateLoginUser, demoDeleteMember, demoInviteUnchecked, getDemoState } from '@/demo/demoStore'
import { demoAllowed, demoCanTrade } from '@/demo/demoTrade'

/**
 * Browser-only school records for demo mode. Mirrors supabase/migrations/20261021000019_school.sql: the same rules (teachers only reach their own
 * classes and subjects, parents only their own children and only published results, scores are checked against the school's maximum marks,
 * payments are capped at the balance and reversed rather than edited), with every operation applied all-or-nothing.
 */
export type StudentStatus = 'active' | 'transferred' | 'withdrawn' | 'graduated'
export type ScoreStatus = 'draft' | 'submitted' | 'approved' | 'published'
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused'
export const PAY_METHODS = ['cash', 'bank_transfer', 'card', 'pos', 'other'] as const

export interface SSettings { schoolType: 'nursery' | 'primary' | 'secondary' | 'combined'; address: string | null; phone: string | null; email: string | null; caMax: number; examMax: number; showPosition: boolean; workingDays: number[] }
export interface SBand { min: number; grade: string; remark: string | null }
export interface SSession { id: string; businessId: string; name: string; startsOn: string; endsOn: string; current: boolean }
export interface STerm { id: string; businessId: string; sessionId: string; name: string; startsOn: string; endsOn: string; current: boolean }
export type Stage = 'nursery' | 'primary' | 'secondary'
export const STAGES: Stage[] = ['nursery', 'primary', 'secondary']
/** A nursery school has nursery classes only, and so on; a combined school has all three. */
export const stageOk = (type: string | null | undefined, stage: Stage) => !type || type === 'combined' || type === stage
export interface SClass { id: string; businessId: string; name: string; levelOrder: number; arm: string | null; active: boolean; stage: Stage; departmentId: string | null }
export type SubjectLevel = 'nursery' | 'primary' | 'jss' | 'sss'
export const SUBJECT_LEVELS: SubjectLevel[] = ['nursery', 'primary', 'jss', 'sss']
export interface SSubject { id: string; businessId: string; name: string; code: string | null; levels: SubjectLevel[]; departmentId: string | null }
export interface SDepartment { id: string; businessId: string; name: string }
export interface SStudent { id: string; businessId: string; admissionNo: string; first: string; middle: string | null; last: string; dob: string | null; gender: string | null; admittedOn: string; sessionId: string | null; classId: string | null; status: StudentStatus; statusReason: string | null; statusOn: string | null; emergencyName: string | null; emergencyPhone: string | null; notes: string | null }
export interface SEnrollment { id: string; businessId: string; studentId: string; classId: string; sessionId: string | null; startedOn: string; endedOn: string | null; reason: string | null }
export interface SGuardian { id: string; businessId: string; name: string; phone: string | null; email: string | null; address: string | null; userId: string | null }
export interface SLink { businessId: string; studentId: string; guardianId: string; relationship: string; isPrimary: boolean }
export interface SAdmission { id: string; businessId: string; first: string; last: string; dob: string | null; gender: string | null; classId: string | null; guardianName: string; guardianPhone: string | null; guardianEmail: string | null; relationship: string; status: 'pending' | 'accepted' | 'rejected'; decidedOn: string | null; decisionNote: string | null; studentId: string | null; createdAt: string }
export interface SStaff { id: string; businessId: string; staffNo: string; name: string; phone: string | null; email: string | null; jobTitle: string | null; department: string | null; status: 'active' | 'inactive'; userId: string | null }
export interface SAssignment { id: string; businessId: string; staffId: string; classId: string; subjectId: string | null; classTeacher: boolean }
export interface SAttendance { id: string; businessId: string; studentId: string; classId: string; on: string; status: AttendanceStatus; note: string | null; by: string | null; at: string }
export interface SScore { id: string; businessId: string; studentId: string; classId: string; subjectId: string; termId: string; ca: number | null; exam: number | null; remark: string | null; status: ScoreStatus; reviewNote: string | null }
export interface SRemark { id: string; businessId: string; studentId: string; termId: string; teacherRemark: string | null; principalRemark: string | null; promotion: 'promoted' | 'repeat' | 'graduate' | null }
export interface SFeeItem { id: string; businessId: string; name: string; amount: number; classId: string | null; termId: string | null; onAdmission: boolean; active: boolean }
export interface SBill { id: string; businessId: string; number: string; studentId: string; termId: string; total: number; discount: number; discountReason: string | null; dueOn: string | null; createdAt: string; items: { name: string; amount: number }[] }
export interface SPayment { id: string; businessId: string; receipt: string; billId: string; studentId: string; amount: number; method: string; reference: string | null; paidOn: string; by: string | null; status: 'posted' | 'reversed'; reversalReason: string | null; createdAt: string }
export interface SAnnouncement { id: string; businessId: string; title: string; body: string; audience: 'everyone' | 'parents' | 'teachers' | 'staff' | 'class'; classId: string | null; publishOn: string; createdAt: string }
export interface SHoliday { businessId: string; on: string; name: string }

export interface SPeriod { id: string; businessId: string; label: string; startsAt: string; endsAt: string; isBreak: boolean; position: number }
export interface SSlot { id: string; businessId: string; classId: string; day: number; periodId: string; subjectId: string; staffId: string | null; room: string | null }

interface School {
  periods: SPeriod[]; timetable: SSlot[]; ttSeeded: string[]; departments: SDepartment[]
  settings: Record<string, SSettings>; bands: Record<string, SBand[]>; sessions: SSession[]; terms: STerm[]; classes: SClass[]; subjects: SSubject[]; classSubjects: { classId: string; subjectId: string }[]
  students: SStudent[]; enrollments: SEnrollment[]; guardians: SGuardian[]; links: SLink[]; admissions: SAdmission[]; staff: SStaff[]; assignments: SAssignment[]; holidays: SHoliday[]
  attendance: SAttendance[]; scores: SScore[]; remarks: SRemark[]; feeItems: SFeeItem[]; bills: SBill[]; payments: SPayment[]; announcements: SAnnouncement[]
  audit: { at: string; action: string; entity: string; detail: string }[]; seq: Record<string, number>; keys: Record<string, string>; seeded: string[]
}

const KEY = 'doa.demo.school.v1'
const empty = (): School => ({ departments: [], periods: [], timetable: [], ttSeeded: [], settings: {}, bands: {}, sessions: [], terms: [], classes: [], subjects: [], classSubjects: [], students: [], enrollments: [], guardians: [], links: [], admissions: [], staff: [], assignments: [], holidays: [], attendance: [], scores: [], remarks: [], feeItems: [], bills: [], payments: [], announcements: [], audit: [], seq: {}, keys: {}, seeded: [] })
function load(): School {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = { ...empty(), ...(JSON.parse(raw) as School) }
      for (const c of saved.classes) { c.stage ??= c.levelOrder <= 2 ? 'nursery' : c.levelOrder <= 8 ? 'primary' : 'secondary'; c.departmentId ??= null }
      for (const x of saved.subjects) { x.levels ??= []; x.departmentId ??= null }
      return saved
    }
  } catch { /* fresh */ }
  return empty()
}
let state = load()
function commit(next: School) { state = next; try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ } }
export const getSchool = () => state
export const resetDemoSchool = () => commit(empty())

const me = () => getDemoState().userId
const myEmail = () => getDemoState().users.find((u) => u.id === me())?.email.toLowerCase() ?? null
const can = (biz: string, perm: string) => demoCanTrade(biz, perm)
const guard = (biz: string, module: string, perm: string) => { if (!demoAllowed(biz, module, perm)) throw new Error('permission denied') }
const nextNumber = (s: School, biz: string, kind: string, prefix: string) => { const k = `${biz}|${kind}`; s.seq[k] = (s.seq[k] ?? 0) + 1; return `${prefix}-${String(s.seq[k]).padStart(6, '0')}` }
const trim = (v: string | null | undefined) => (v ?? '').trim()
const nul = (v: string | null | undefined) => trim(v) || null
const isoDow = (d: string) => { const n = new Date(`${d}T12:00:00Z`).getUTCDay(); return n === 0 ? 7 : n }

type Out<R> = { error: string | null; result?: R }
/** Applies an operation to a copy of the records and commits it only if every step succeeds. */
function run<R>(biz: string, op: string, key: string | null, fn: (s: School) => R): Out<R> {
  try {
    if (key !== null) {
      if (key.length < 8) return { error: 'an idempotency key of at least 8 characters is required' }
      const prev = state.keys[`${biz}|${key}`]
      if (prev) { const i = prev.indexOf('|'); return prev.slice(0, i) === op ? { error: null, result: JSON.parse(prev.slice(i + 1)) as R } : { error: 'idempotency key already used for another operation' } }
    }
    const s: School = JSON.parse(JSON.stringify(state)) as School
    const result = fn(s)
    if (key !== null) s.keys[`${biz}|${key}`] = `${op}|${JSON.stringify(result ?? null)}`
    commit(s)
    return { error: null, result }
  } catch (e) { return { error: (e as Error).message } }
}

// ------------------------------------------------------------------ who may see what
const staffOf = (s: School, biz: string) => s.staff.find((x) => x.businessId === biz && x.userId === me() && x.status === 'active')
const teachesClass = (s: School, biz: string, classId: string | null) => { const st = staffOf(s, biz); return !!st && !!classId && s.assignments.some((a) => a.staffId === st.id && a.classId === classId) }
const teachesSubject = (s: School, biz: string, classId: string, subjectId: string) => { const st = staffOf(s, biz); return !!st && s.assignments.some((a) => a.staffId === st.id && a.classId === classId && a.subjectId === subjectId) }
const isGuardianOf = (s: School, biz: string, studentId: string) => s.links.some((l) => l.businessId === biz && l.studentId === studentId && s.guardians.some((g) => g.id === l.guardianId && g.userId === me() && me() !== null))
function canSee(s: School, biz: string, st: SStudent): boolean {
  if (can(biz, 'school.read')) return true
  if (can(biz, 'school.teach') && teachesClass(s, biz, st.classId)) return true
  return can(biz, 'school.portal') && isGuardianOf(s, biz, st.id)
}
const studentName = (st: SStudent) => `${st.first} ${st.middle ? `${st.middle} ` : ''}${st.last}`

// ------------------------------------------------------------------------- reads
export function demoStructure(biz: string) {
  ensureDemoSchool(biz)
  return {
    settings: state.settings[biz] ?? null, bands: state.bands[biz] ?? [], sessions: state.sessions.filter((x) => x.businessId === biz), terms: state.terms.filter((x) => x.businessId === biz),
    classes: state.classes.filter((x) => x.businessId === biz).sort((a, b) => a.levelOrder - b.levelOrder || a.name.localeCompare(b.name)), subjects: state.subjects.filter((x) => x.businessId === biz).sort((a, b) => a.name.localeCompare(b.name)),
    classSubjects: state.classSubjects.filter((x) => state.classes.some((c) => c.id === x.classId && c.businessId === biz)), holidays: state.holidays.filter((x) => x.businessId === biz), departments: state.departments.filter((x) => x.businessId === biz).sort((a, b) => a.name.localeCompare(b.name)),
  }
}
export const demoStudents = (biz: string) => { ensureDemoSchool(biz); return state.students.filter((x) => x.businessId === biz && canSee(state, biz, x)).sort((a, b) => a.admissionNo.localeCompare(b.admissionNo)) }
export const demoEnrollments = (biz: string, studentId: string) => { const st = state.students.find((x) => x.id === studentId && x.businessId === biz); return st && canSee(state, biz, st) ? state.enrollments.filter((e) => e.studentId === studentId) : [] }
export function demoGuardians(biz: string) {
  ensureDemoSchool(biz)
  return state.guardians.filter((g) => g.businessId === biz && (can(biz, 'school.read') || g.userId === me() || state.links.some((l) => l.guardianId === g.id && state.students.some((st) => st.id === l.studentId && canSee(state, biz, st)))))
}
export const demoLinks = (biz: string) => state.links.filter((l) => l.businessId === biz && state.students.some((st) => st.id === l.studentId && canSee(state, biz, st)))
export const demoAdmissions = (biz: string) => { ensureDemoSchool(biz); return can(biz, 'school.students') ? state.admissions.filter((x) => x.businessId === biz).slice().reverse() : [] }
export const demoStaff = (biz: string) => { ensureDemoSchool(biz); return can(biz, 'school.manage') ? state.staff.filter((x) => x.businessId === biz) : state.staff.filter((x) => x.businessId === biz && x.userId === me()) }
export const demoAssignments = (biz: string) => state.assignments.filter((a) => a.businessId === biz && (can(biz, 'school.manage') || staffOf(state, biz)?.id === a.staffId))
export function demoAttendance(biz: string, classId?: string) {
  ensureDemoSchool(biz)
  return state.attendance.filter((a) => a.businessId === biz && (!classId || a.classId === classId) && state.students.some((st) => st.id === a.studentId && canSee(state, biz, st)))
}
export function demoScores(biz: string) {
  ensureDemoSchool(biz)
  return state.scores.filter((x) => x.businessId === biz && state.students.some((st) => st.id === x.studentId && canSee(state, biz, st)) && (x.status === 'published' || can(biz, 'school.read') || can(biz, 'school.teach')))
}
export const demoRemarks = (biz: string) => state.remarks.filter((x) => x.businessId === biz && state.students.some((st) => st.id === x.studentId && canSee(state, biz, st)))
export const demoFeeItems = (biz: string) => { ensureDemoSchool(biz); return can(biz, 'school.fees.read') || can(biz, 'school.portal') ? state.feeItems.filter((x) => x.businessId === biz) : [] }
export interface BillRow extends SBill { payable: number; paid: number; balance: number; status: 'paid' | 'overdue' | 'partially_paid' | 'unpaid'; studentName: string; className: string | null; admissionNo: string }
export function demoBills(biz: string): BillRow[] {
  ensureDemoSchool(biz)
  return state.bills.filter((b) => b.businessId === biz && (can(biz, 'school.fees.read') || (can(biz, 'school.portal') && isGuardianOf(state, biz, b.studentId)))).map((b) => {
    const st = state.students.find((x) => x.id === b.studentId)!
    const paid = r2(state.payments.filter((p) => p.billId === b.id && p.status === 'posted').reduce((a, p) => a + p.amount, 0))
    const payable = r2(b.total - b.discount); const balance = r2(payable - paid)
    const status = balance <= 0 ? 'paid' as const : b.dueOn && b.dueOn < today() ? 'overdue' as const : paid > 0 ? 'partially_paid' as const : 'unpaid' as const
    return { ...b, payable, paid, balance, status, studentName: studentName(st), className: state.classes.find((c) => c.id === st.classId)?.name ?? null, admissionNo: st.admissionNo }
  }).sort((a, b) => b.number.localeCompare(a.number))
}
export function demoPayments(biz: string): (SPayment & { studentName: string; billNumber: string })[] {
  ensureDemoSchool(biz)
  return state.payments.filter((p) => p.businessId === biz && (can(biz, 'school.fees.read') || (can(biz, 'school.portal') && isGuardianOf(state, biz, p.studentId)))).map((p) => ({ ...p, studentName: studentName(state.students.find((x) => x.id === p.studentId)!), billNumber: state.bills.find((b) => b.id === p.billId)?.number ?? '' })).sort((a, b) => b.receipt.localeCompare(a.receipt))
}
export function demoAnnouncements(biz: string): SAnnouncement[] {
  ensureDemoSchool(biz)
  return state.announcements.filter((a) => {
    if (a.businessId !== biz) return false
    if (can(biz, 'school.manage')) return true
    if (a.publishOn > today()) return false
    if (a.audience === 'everyone') return true
    if (a.audience === 'teachers') return can(biz, 'school.teach')
    if (a.audience === 'staff') return can(biz, 'school.read') || can(biz, 'school.teach')
    if (a.audience === 'parents') return can(biz, 'school.portal')
    return can(biz, 'school.read') || teachesClass(state, biz, a.classId) || (can(biz, 'school.portal') && state.students.some((st) => st.classId === a.classId && isGuardianOf(state, biz, st.id)))
  }).sort((a, b) => b.publishOn.localeCompare(a.publishOn))
}

// ------------------------------------------------------------------------- setup
export function demoSaveSettings(biz: string, v: { schoolType: SSettings['schoolType']; address: string; phone: string; email: string; caMax: number; examMax: number; showPosition: boolean; workingDays: number[] }): string | null {
  return run(biz, 'school_settings', null, (s) => {
    guard(biz, 'school-settings', 'school.manage')
    if (!['nursery', 'primary', 'secondary', 'combined'].includes(v.schoolType)) throw new Error('choose the type of school')
    if (!(v.caMax >= 0) || !(v.examMax >= 0) || v.caMax + v.examMax <= 0 || v.caMax + v.examMax > 1000) throw new Error('the continuous assessment and exam marks must be zero or more and add up to more than zero')
    if (!v.workingDays.length || v.workingDays.some((d) => d < 1 || d > 7)) throw new Error('choose the days the school is open (1 = Monday ... 7 = Sunday)')
    const full = s.classes.filter((c) => c.businessId === biz && c.active && !stageOk(v.schoolType, c.stage) && s.students.some((x) => x.classId === c.id && x.status === 'active'))
    if (full.length) throw new Error(`these classes still have active students: ${full.map((c) => c.name).join(', ')}. Move or withdraw them before changing the kind of school`)
    const old = s.settings[biz]?.schoolType ?? null
    s.settings[biz] = { schoolType: v.schoolType, address: nul(v.address), phone: nul(v.phone), email: nul(v.email), caMax: v.caMax, examMax: v.examMax, showPosition: v.showPosition, workingDays: v.workingDays }
    if (old && old !== v.schoolType && s.classes.some((c) => c.businessId === biz)) reshape(s, biz, old, v.schoolType)
    else for (const c of s.classes) if (c.businessId === biz && c.active && !stageOk(v.schoolType, c.stage)) c.active = false
    return null
  }).error
}
export function demoSaveGrades(biz: string, bands: SBand[]): string | null {
  return run(biz, 'school_grades', null, (s) => {
    guard(biz, 'school-settings', 'school.manage')
    if (bands.length < 2 || bands.length > 12) throw new Error('a grading system needs 2 to 12 grades')
    if (bands.some((b) => !trim(b.grade) || !(b.min >= 0))) throw new Error('every grade needs a name and a minimum score of 0 or more')
    if (!bands.some((b) => b.min === 0)) throw new Error('the lowest grade must start at 0 so every score has a grade')
    if (new Set(bands.map((b) => trim(b.grade))).size !== bands.length || new Set(bands.map((b) => b.min)).size !== bands.length) throw new Error('two grades share the same name or minimum score')
    s.bands[biz] = bands.map((b) => ({ min: b.min, grade: trim(b.grade), remark: nul(b.remark) })).sort((a, b) => b.min - a.min)
    return null
  }).error
}
export function demoSaveSession(biz: string, v: { id: string | null; name: string; startsOn: string; endsOn: string; current: boolean }): string | null {
  return run(biz, 'school_session', null, (s) => {
    guard(biz, 'school-classes', 'school.manage')
    if (!trim(v.name) || !v.startsOn || !v.endsOn || v.endsOn < v.startsOn) throw new Error('enter the session name and its dates (it must end after it starts)')
    if (s.sessions.some((x) => x.businessId === biz && x.id !== v.id && x.name === trim(v.name))) throw new Error('duplicate key: a session with this name already exists')
    if (v.current) s.sessions.filter((x) => x.businessId === biz).forEach((x) => { x.current = false })
    if (v.id === null) s.sessions.push({ id: newId('ses'), businessId: biz, name: trim(v.name), startsOn: v.startsOn, endsOn: v.endsOn, current: v.current })
    else { const x = s.sessions.find((y) => y.id === v.id && y.businessId === biz); if (!x) throw new Error('session not found'); Object.assign(x, { name: trim(v.name), startsOn: v.startsOn, endsOn: v.endsOn, current: v.current }) }
    return null
  }).error
}
export function demoSaveTerm(biz: string, v: { id: string | null; sessionId: string; name: string; startsOn: string; endsOn: string; current: boolean }): string | null {
  return run(biz, 'school_term', null, (s) => {
    guard(biz, 'school-classes', 'school.manage')
    if (!s.sessions.some((x) => x.id === v.sessionId && x.businessId === biz)) throw new Error('choose the academic session')
    if (!trim(v.name) || !v.startsOn || !v.endsOn || v.endsOn < v.startsOn) throw new Error('enter the term name and its dates (it must end after it starts)')
    if (s.terms.some((x) => x.businessId === biz && x.id !== v.id && x.sessionId === v.sessionId && x.name === trim(v.name))) throw new Error('duplicate key: this session already has a term with that name')
    if (v.current) s.terms.filter((x) => x.businessId === biz).forEach((x) => { x.current = false })
    if (v.id === null) s.terms.push({ id: newId('trm'), businessId: biz, sessionId: v.sessionId, name: trim(v.name), startsOn: v.startsOn, endsOn: v.endsOn, current: v.current })
    else { const x = s.terms.find((y) => y.id === v.id && y.businessId === biz); if (!x) throw new Error('term not found'); Object.assign(x, { sessionId: v.sessionId, name: trim(v.name), startsOn: v.startsOn, endsOn: v.endsOn, current: v.current }) }
    return null
  }).error
}
export function demoSaveClass(biz: string, v: { id: string | null; name: string; levelOrder: number; arm: string; active: boolean; stage: Stage; departmentId?: string | null }): string | null {
  return run(biz, 'school_class', null, (s) => {
    guard(biz, 'school-classes', 'school.manage')
    if (!trim(v.name)) throw new Error('enter the class name')
    if (!STAGES.includes(v.stage)) throw new Error('choose the stage of the class (nursery, primary or secondary)')
    const type = s.settings[biz]?.schoolType
    if (v.active && !stageOk(type, v.stage)) throw new Error(`this is a ${type} school, so it cannot have ${v.stage} classes. Change the kind of school in Settings first`)
    const dept = v.departmentId ?? null
    if (dept) {
      if (v.stage !== 'secondary') throw new Error('only secondary classes can sit in a department')
      if (!s.departments.some((d) => d.id === dept && d.businessId === biz)) throw new Error('department not found')
    }
    if (s.classes.some((x) => x.businessId === biz && x.id !== v.id && x.name === trim(v.name))) throw new Error('duplicate key: a class with this name already exists')
    if (v.id === null) s.classes.push({ id: newId('cls'), businessId: biz, name: trim(v.name), levelOrder: v.levelOrder, arm: nul(v.arm), active: v.active, stage: v.stage, departmentId: dept })
    else { const x = s.classes.find((y) => y.id === v.id && y.businessId === biz); if (!x) throw new Error('class not found'); Object.assign(x, { name: trim(v.name), levelOrder: v.levelOrder, arm: nul(v.arm), active: v.active, stage: v.stage, departmentId: dept }) }
    return null
  }).error
}
export function demoSaveDepartment(biz: string, v: { id: string | null; name: string }): string | null {
  return run(biz, 'school_department', null, (s) => {
    guard(biz, 'school-classes', 'school.manage')
    if (trim(v.name).length < 2) throw new Error('enter the department name')
    if (s.departments.some((d) => d.businessId === biz && d.id !== v.id && d.name === trim(v.name))) throw new Error('duplicate key: a department with this name already exists')
    if (v.id === null) s.departments.push({ id: newId('dep'), businessId: biz, name: trim(v.name) })
    else { const d = s.departments.find((x) => x.id === v.id && x.businessId === biz); if (!d) throw new Error('department not found'); d.name = trim(v.name) }
    return null
  }).error
}
export function demoDeleteDepartment(biz: string, id: string): string | null {
  return run(biz, 'school_department_delete', null, (s) => {
    guard(biz, 'school-classes', 'school.manage')
    if (!s.departments.some((d) => d.id === id && d.businessId === biz)) throw new Error('department not found')
    if (s.classes.some((c) => c.departmentId === id) || s.subjects.some((x) => x.departmentId === id)) throw new Error('this department still has classes or subjects; move them first')
    s.departments = s.departments.filter((d) => d.id !== id)
    return null
  }).error
}
export function demoSaveSubject(biz: string, v: { id: string | null; name: string; code: string; levels?: SubjectLevel[]; departmentId?: string | null }): string | null {
  return run(biz, 'school_subject', null, (s) => {
    guard(biz, 'school-classes', 'school.manage')
    if (!trim(v.name)) throw new Error('enter the subject name')
    if (s.subjects.some((x) => x.businessId === biz && x.id !== v.id && x.name === trim(v.name))) throw new Error('duplicate key: a subject with this name already exists')
    const levels = v.levels ?? []; const dept = v.departmentId ?? null
    if (levels.some((l) => !SUBJECT_LEVELS.includes(l))) throw new Error('choose levels from nursery, primary, junior secondary and senior secondary')
    if (dept && !s.departments.some((d) => d.id === dept && d.businessId === biz)) throw new Error('department not found')
    if (v.id === null) s.subjects.push({ id: newId('sub'), businessId: biz, name: trim(v.name), code: nul(v.code), levels, departmentId: dept })
    else { const x = s.subjects.find((y) => y.id === v.id && y.businessId === biz); if (!x) throw new Error('subject not found'); Object.assign(x, { name: trim(v.name), code: nul(v.code), levels, departmentId: dept }) }
    return null
  }).error
}
export function demoDeleteClass(biz: string, id: string): string | null {
  return run(biz, 'school_class_delete', null, (s) => {
    guard(biz, 'school-classes', 'school.manage')
    if (!s.classes.some((c) => c.id === id && c.businessId === biz)) throw new Error('class not found')
    if (s.students.some((x) => x.businessId === biz && x.classId === id && x.status === 'active')) throw new Error('this class still has students; move them to another class first')
    const used = s.students.some((x) => x.classId === id) || s.enrollments.some((x) => x.classId === id) || s.attendance.some((x) => x.classId === id) || s.scores.some((x) => x.classId === id)
      || s.feeItems.some((x) => x.classId === id) || s.admissions.some((x) => x.classId === id) || s.announcements.some((x) => x.classId === id)
    if (used) throw new Error('this class has records (past students, attendance, results or fees), so it cannot be deleted; mark it as not in use instead')
    s.timetable = s.timetable.filter((x) => x.classId !== id); s.assignments = s.assignments.filter((x) => x.classId !== id)
    s.classSubjects = s.classSubjects.filter((x) => x.classId !== id); s.classes = s.classes.filter((c) => c.id !== id)
    return null
  }).error
}
export function demoDeleteSubject(biz: string, id: string): string | null {
  return run(biz, 'school_subject_delete', null, (s) => {
    guard(biz, 'school-classes', 'school.manage')
    if (!s.subjects.some((x) => x.id === id && x.businessId === biz)) throw new Error('subject not found')
    if (s.scores.some((x) => x.subjectId === id)) throw new Error('this subject already has results recorded, so it cannot be deleted; take it off the classes that no longer study it instead')
    s.timetable = s.timetable.filter((x) => x.subjectId !== id); s.assignments = s.assignments.filter((x) => x.subjectId !== id)
    s.classSubjects = s.classSubjects.filter((x) => x.subjectId !== id); s.subjects = s.subjects.filter((x) => x.id !== id)
    return null
  }).error
}
export function demoSetClassSubjects(biz: string, classId: string, subjectIds: string[]): string | null {
  return run(biz, 'school_class_subjects', null, (s) => {
    guard(biz, 'school-classes', 'school.manage')
    if (!s.classes.some((x) => x.id === classId && x.businessId === biz)) throw new Error('class not found')
    if (subjectIds.some((id) => !s.subjects.some((x) => x.id === id && x.businessId === biz))) throw new Error('unknown subject')
    s.classSubjects = s.classSubjects.filter((x) => x.classId !== classId).concat(subjectIds.map((subjectId) => ({ classId, subjectId })))
    return null
  }).error
}
export function demoSaveHoliday(biz: string, on: string, name: string, remove = false): string | null {
  return run(biz, 'school_holiday', null, (s) => {
    guard(biz, 'school-classes', 'school.manage')
    if (remove) { s.holidays = s.holidays.filter((h) => !(h.businessId === biz && h.on === on)); return null }
    if (!on || !trim(name)) throw new Error('enter the date and the name of the holiday')
    s.holidays = s.holidays.filter((h) => !(h.businessId === biz && h.on === on)).concat({ businessId: biz, on, name: trim(name) })
    return null
  }).error
}

const DEFAULT_BANDS: SBand[] = [{ min: 70, grade: 'A', remark: 'Excellent' }, { min: 60, grade: 'B', remark: 'Very good' }, { min: 50, grade: 'C', remark: 'Good' }, { min: 45, grade: 'D', remark: 'Fair' }, { min: 40, grade: 'E', remark: 'Pass' }, { min: 0, grade: 'F', remark: 'Fail' }]
const STRUCTURE: [string, number, 'nursery' | 'primary' | 'secondary'][] = [['Nursery 1', 1, 'nursery'], ['Nursery 2', 2, 'nursery'], ['Primary 1', 3, 'primary'], ['Primary 2', 4, 'primary'], ['Primary 3', 5, 'primary'], ['Primary 4', 6, 'primary'], ['Primary 5', 7, 'primary'], ['Primary 6', 8, 'primary'], ['JSS 1', 9, 'secondary'], ['JSS 2', 10, 'secondary'], ['JSS 3', 11, 'secondary']]
type Group = 'nursery' | 'primary' | 'jss' | 'sss'
const groupOf = (stage: Stage, order: number): Group => (stage === 'nursery' ? 'nursery' : stage === 'primary' ? 'primary' : order <= 11 ? 'jss' : 'sss')
/** The standard subjects by level, and for senior secondary by department (null = every department). The same as the database's catalogue. */
const CATALOGUE: [string, string, Group, string | null][] = [
  ['Literacy', 'LIT', 'nursery', null], ['Numeracy', 'NUM', 'nursery', null], ['Social and Health Habits', 'SHH', 'nursery', null], ['Creative Arts', 'ART', 'nursery', null], ['Rhymes and Music', 'MUS', 'nursery', null],
  ['English Language', 'ENG', 'primary', null], ['Mathematics', 'MTH', 'primary', null], ['Basic Science', 'SCI', 'primary', null], ['Social Studies', 'SOS', 'primary', null], ['Civic Education', 'CVE', 'primary', null],
  ['Computer Studies', 'ICT', 'primary', null], ['Christian/Islamic Studies', 'CRS', 'primary', null], ['Physical and Health Education', 'PHE', 'primary', null],
  ['English Language', 'ENG', 'jss', null], ['Mathematics', 'MTH', 'jss', null], ['Basic Science', 'SCI', 'jss', null], ['Basic Technology', 'BTE', 'jss', null], ['Social Studies', 'SOS', 'jss', null], ['Civic Education', 'CVE', 'jss', null],
  ['Computer Studies', 'ICT', 'jss', null], ['Christian/Islamic Studies', 'CRS', 'jss', null], ['Business Studies', 'BUS', 'jss', null], ['Agricultural Science', 'AGR', 'jss', null], ['Physical and Health Education', 'PHE', 'jss', null],
  ['English Language', 'ENG', 'sss', null], ['Mathematics', 'MTH', 'sss', null], ['Civic Education', 'CVE', 'sss', null], ['Computer Studies', 'ICT', 'sss', null], ['Agricultural Science', 'AGR', 'sss', null],
  ['Biology', 'BIO', 'sss', 'Science'], ['Chemistry', 'CHM', 'sss', 'Science'], ['Physics', 'PHY', 'sss', 'Science'], ['Further Mathematics', 'FMT', 'sss', 'Science'], ['Geography', 'GEO', 'sss', 'Science'],
  ['Literature in English', 'LIT', 'sss', 'Art'], ['Government', 'GOV', 'sss', 'Art'], ['History', 'HIS', 'sss', 'Art'], ['Visual Art', 'VAR', 'sss', 'Art'],
  ['Economics', 'ECO', 'sss', 'Commercial'], ['Financial Accounting', 'ACC', 'sss', 'Commercial'], ['Commerce', 'COM', 'sss', 'Commercial'], ['Marketing', 'MKT', 'sss', 'Commercial'],
]
function buildStructure(s: School, biz: string, type: SSettings['schoolType'], sessionName: string, start: string) {
  s.settings[biz] = { schoolType: type, address: null, phone: null, email: null, caMax: 40, examMax: 60, showPosition: false, workingDays: [1, 2, 3, 4, 5] }
  if (stageOk(type, 'secondary')) for (const name of ['Science', 'Art', 'Commercial']) s.departments.push({ id: newId('dep'), businessId: biz, name })
  for (const [name, order, kind] of STRUCTURE) if (stageOk(type, kind)) s.classes.push({ id: newId('cls'), businessId: biz, name, levelOrder: order, arm: null, active: true, stage: kind, departmentId: null })
  if (stageOk(type, 'secondary')) for (let year = 1; year <= 3; year++) for (const d of s.departments.filter((x) => x.businessId === biz).sort((a, b) => a.name.localeCompare(b.name))) s.classes.push({ id: newId('cls'), businessId: biz, name: `SS ${year} ${d.name}`, levelOrder: 11 + year, arm: null, active: true, stage: 'secondary', departmentId: d.id })
  const classes = s.classes.filter((x) => x.businessId === biz)
  const used = new Set(classes.map((c) => groupOf(c.stage, c.levelOrder)))
  // The subjects that exist for this kind of school (with their levels and department)...
  for (const name of [...new Set(CATALOGUE.filter((x) => used.has(x[2])).map((x) => x[0]))]) {
    const rows = CATALOGUE.filter((x) => x[0] === name && used.has(x[2]))
    const dept = rows.find((x) => x[3])?.[3] ?? null
    s.subjects.push({ id: newId('sub'), businessId: biz, name, code: rows[0][1], levels: [...new Set(rows.map((x) => x[2]))].sort() as SubjectLevel[], departmentId: dept ? s.departments.find((d) => d.businessId === biz && d.name === dept)?.id ?? null : null })
  }
  // ...and a starting pick for every class, to be adjusted class by class.
  for (const c of classes) {
    const deptName = s.departments.find((d) => d.id === c.departmentId)?.name ?? null
    for (const [name, , grp, dept] of CATALOGUE) {
      if (grp !== groupOf(c.stage, c.levelOrder) || (dept && dept !== deptName)) continue
      const sub = s.subjects.find((x) => x.businessId === biz && x.name === name); if (sub) s.classSubjects.push({ classId: c.id, subjectId: sub.id })
    }
  }
  s.bands[biz] = DEFAULT_BANDS.map((b) => ({ ...b }))
  const sess: SSession = { id: newId('ses'), businessId: biz, name: trim(sessionName) || 'Session', startsOn: start, endsOn: addDays(start, 330), current: true }
  s.sessions.push(sess)
  for (let i = 0; i < 3; i++) s.terms.push({ id: newId('trm'), businessId: biz, sessionId: sess.id, name: ['First Term', 'Second Term', 'Third Term'][i], startsOn: addDays(start, i * 110), endsOn: addDays(start, i * 110 + 95), current: i === 0 })
}
/**
 * Mirrors _school_reshape(): changing the kind of school removes the classes (when unused), departments and subjects of the levels it no longer has, and adds
 * the classes and subjects of the levels it now has, with the standard subjects ticked for every class that takes none.
 */
function reshape(s: School, biz: string, oldType: SSettings['schoolType'], type: SSettings['schoolType']) {
  const usedClass = (id: string) => s.students.some((x) => x.classId === id) || s.enrollments.some((x) => x.classId === id) || s.attendance.some((x) => x.classId === id) || s.scores.some((x) => x.classId === id)
    || s.feeItems.some((x) => x.classId === id) || s.admissions.some((x) => x.classId === id) || s.announcements.some((x) => x.classId === id)
  for (const c of s.classes.filter((x) => x.businessId === biz && !stageOk(type, x.stage))) {
    if (usedClass(c.id)) { c.active = false; c.departmentId = null; continue }
    s.timetable = s.timetable.filter((x) => x.classId !== c.id); s.assignments = s.assignments.filter((x) => x.classId !== c.id)
    s.classSubjects = s.classSubjects.filter((x) => x.classId !== c.id); s.classes = s.classes.filter((x) => x.id !== c.id)
  }
  if (stageOk(type, 'secondary')) {
    if (!s.departments.some((d) => d.businessId === biz)) for (const name of ['Science', 'Art', 'Commercial']) s.departments.push({ id: newId('dep'), businessId: biz, name })
  } else {
    for (const c of s.classes) if (c.businessId === biz) c.departmentId = null
    for (const x of s.subjects) if (x.businessId === biz) x.departmentId = null
    s.departments = s.departments.filter((d) => d.businessId !== biz)
  }
  const add = (name: string, order: number, kind: Stage, departmentId: string | null) => {
    const have = s.classes.find((c) => c.businessId === biz && c.name === name)
    if (!have) s.classes.push({ id: newId('cls'), businessId: biz, name, levelOrder: order, arm: null, active: true, stage: kind, departmentId })
    else if (!stageOk(oldType, kind)) have.active = true
  }
  for (const [name, order, kind] of STRUCTURE) if (stageOk(type, kind)) add(name, order, kind, null)
  if (stageOk(type, 'secondary')) for (let year = 1; year <= 3; year++) for (const d of s.departments.filter((x) => x.businessId === biz).sort((a, b) => a.name.localeCompare(b.name))) add(`SS ${year} ${d.name}`, 11 + year, 'secondary', d.id)
  const classes = s.classes.filter((c) => c.businessId === biz && c.active && stageOk(type, c.stage))
  const groups = new Set(classes.map((c) => groupOf(c.stage, c.levelOrder)))
  for (const x of s.subjects.filter((y) => y.businessId === biz && y.levels.length && !y.levels.some((l) => groups.has(l)))) {
    if (s.scores.some((r) => r.subjectId === x.id)) continue
    s.timetable = s.timetable.filter((t) => t.subjectId !== x.id); s.assignments = s.assignments.filter((a) => a.subjectId !== x.id)
    s.classSubjects = s.classSubjects.filter((c) => c.subjectId !== x.id); s.subjects = s.subjects.filter((y) => y.id !== x.id)
  }
  for (const name of [...new Set(CATALOGUE.filter((x) => groups.has(x[2])).map((x) => x[0]))]) {
    const rows = CATALOGUE.filter((x) => x[0] === name && groups.has(x[2]))
    const levels = [...new Set(rows.map((x) => x[2]))] as SubjectLevel[]
    const have = s.subjects.find((x) => x.businessId === biz && x.name === name)
    if (have) { if (have.levels.length) have.levels = [...new Set([...have.levels, ...levels])].sort() as SubjectLevel[]; continue }
    const dept = rows.find((x) => x[3])?.[3] ?? null
    s.subjects.push({ id: newId('sub'), businessId: biz, name, code: rows[0][1], levels: levels.sort(), departmentId: dept ? s.departments.find((d) => d.businessId === biz && d.name === dept)?.id ?? null : null })
  }
  for (const c of classes.filter((x) => !s.classSubjects.some((cs) => cs.classId === x.id))) {
    const deptName = s.departments.find((d) => d.id === c.departmentId)?.name ?? null
    for (const [name, , grp, dept] of CATALOGUE) {
      if (grp !== groupOf(c.stage, c.levelOrder) || (dept && dept !== deptName)) continue
      const sub = s.subjects.find((x) => x.businessId === biz && x.name === name); if (sub) s.classSubjects.push({ classId: c.id, subjectId: sub.id })
    }
  }
}
export function demoSchoolSetup(biz: string, type: SSettings['schoolType'], sessionName: string, start: string): string | null {
  return run(biz, 'school_setup', null, (s) => {
    guard(biz, 'school-settings', 'school.manage')
    if (s.classes.some((x) => x.businessId === biz)) throw new Error('this school already has classes; edit them instead')
    buildStructure(s, biz, type, sessionName, start || today())
    return null
  }).error
}

// ---------------------------------------------------------------------- students
export interface StudentInput { first: string; middle: string; last: string; dob: string; gender: string; classId: string | null; admittedOn: string; emergencyName: string; emergencyPhone: string; notes: string }
export interface GuardianInput { name: string; phone: string; email: string; relationship: string; primary: boolean }
const currentSession = (s: School, biz: string) => s.sessions.find((x) => x.businessId === biz && x.current)?.id ?? null
const currentTerm = (s: School, biz: string) => s.terms.find((x) => x.businessId === biz && x.current)?.id ?? null
function makeStudent(s: School, biz: string, v: StudentInput, guardians: GuardianInput[]): SStudent {
  if (!trim(v.first) || !trim(v.last)) throw new Error('enter the student\'s first and last name')
  if (v.dob && v.dob > today()) throw new Error('the date of birth cannot be in the future')
  if (v.classId && !s.classes.some((c) => c.id === v.classId && c.businessId === biz && c.active)) throw new Error('choose a class that is open')
  const st: SStudent = { id: newId('stu'), businessId: biz, admissionNo: nextNumber(s, biz, 'student', 'ADM'), first: trim(v.first), middle: nul(v.middle), last: trim(v.last), dob: v.dob || null, gender: v.gender || null, admittedOn: v.admittedOn || today(), sessionId: currentSession(s, biz), classId: v.classId, status: 'active', statusReason: null, statusOn: null, emergencyName: nul(v.emergencyName), emergencyPhone: nul(v.emergencyPhone), notes: nul(v.notes) }
  s.students.push(st)
  if (v.classId) s.enrollments.push({ id: newId('enr'), businessId: biz, studentId: st.id, classId: v.classId, sessionId: st.sessionId, startedOn: st.admittedOn, endedOn: null, reason: 'Admitted' })
  for (const g of guardians) {
    if (trim(g.name).length < 2) continue
    let gd = trim(g.phone) ? s.guardians.find((x) => x.businessId === biz && x.phone === trim(g.phone)) : undefined
    if (!gd) { gd = { id: newId('gd'), businessId: biz, name: trim(g.name), phone: nul(g.phone), email: nul(g.email), address: null, userId: null }; s.guardians.push(gd) }
    if (!s.links.some((l) => l.studentId === st.id && l.guardianId === gd!.id)) s.links.push({ businessId: biz, studentId: st.id, guardianId: gd.id, relationship: trim(g.relationship) || 'parent', isPrimary: g.primary })
  }
  return st
}
export function demoRegisterStudent(biz: string, v: StudentInput, guardians: GuardianInput[], key: string): Out<{ studentId: string; admissionNo: string }> {
  return run(biz, 'school_register', key, (s) => {
    guard(biz, 'school-students', 'school.students')
    const st = makeStudent(s, biz, v, guardians)
    return { studentId: st.id, admissionNo: st.admissionNo }
  })
}
export function demoUpdateStudent(biz: string, id: string, v: StudentInput): string | null {
  return run(biz, 'school_update_student', null, (s) => {
    const st = s.students.find((x) => x.id === id && x.businessId === biz); if (!st) throw new Error('permission denied')
    guard(biz, 'school-students', 'school.students')
    if (!trim(v.first) || !trim(v.last)) throw new Error('enter the student\'s first and last name')
    if (v.dob && v.dob > today()) throw new Error('the date of birth cannot be in the future')
    Object.assign(st, { first: trim(v.first), middle: nul(v.middle), last: trim(v.last), dob: v.dob || null, gender: v.gender || null, emergencyName: nul(v.emergencyName), emergencyPhone: nul(v.emergencyPhone), notes: nul(v.notes) })
    return null
  }).error
}
export function demoSetStudentStatus(biz: string, id: string, status: StudentStatus, reason: string): string | null {
  return run(biz, 'school_status', null, (s) => {
    const st = s.students.find((x) => x.id === id && x.businessId === biz); if (!st) throw new Error('permission denied')
    guard(biz, 'school-students', 'school.students')
    if (!['active', 'transferred', 'withdrawn', 'graduated'].includes(status)) throw new Error('choose a status')
    if (status !== 'active' && trim(reason).length < 3) throw new Error('say why the student is leaving')
    Object.assign(st, { status, statusReason: nul(reason), statusOn: today() })
    if (status !== 'active') s.enrollments.filter((e) => e.studentId === id && !e.endedOn).forEach((e) => { e.endedOn = today() })
    return null
  }).error
}
export function demoPromote(biz: string, moves: { studentId: string; classId: string }[], reason: string): Out<number> {
  return run(biz, 'school_promote', null, (s) => {
    guard(biz, 'school-students', 'school.students')
    if (!moves.length) throw new Error('choose the students to move')
    let n = 0
    for (const m of moves) {
      const st = s.students.find((x) => x.id === m.studentId && x.businessId === biz)
      if (!st || st.status !== 'active') throw new Error('only active students can be moved')
      if (!s.classes.some((c) => c.id === m.classId && c.businessId === biz && c.active)) throw new Error('choose a class that is open')
      if (st.classId === m.classId) continue
      s.enrollments.filter((e) => e.studentId === st.id && !e.endedOn).forEach((e) => { e.endedOn = today() })
      s.enrollments.push({ id: newId('enr'), businessId: biz, studentId: st.id, classId: m.classId, sessionId: currentSession(s, biz), startedOn: today(), endedOn: null, reason: trim(reason) || 'Moved' })
      st.classId = m.classId; n++
    }
    return n
  })
}

// --------------------------------------------------- admissions, guardians, staff
export interface ApplicationInput { first: string; last: string; dob: string; gender: string; classId: string | null; guardianName: string; guardianPhone: string; guardianEmail: string; relationship: string }
export function demoApply(biz: string, v: ApplicationInput, key: string): Out<{ admissionId: string }> {
  return run(biz, 'school_apply', key, (s) => {
    guard(biz, 'school-admissions', 'school.students')
    if (!trim(v.first) || !trim(v.last)) throw new Error('enter the applicant\'s first and last name')
    if (trim(v.guardianName).length < 2) throw new Error('enter a parent or guardian')
    const a: SAdmission = { id: newId('adm'), businessId: biz, first: trim(v.first), last: trim(v.last), dob: v.dob || null, gender: v.gender || null, classId: v.classId, guardianName: trim(v.guardianName), guardianPhone: nul(v.guardianPhone), guardianEmail: nul(v.guardianEmail), relationship: trim(v.relationship) || 'parent', status: 'pending', decidedOn: null, decisionNote: null, studentId: null, createdAt: new Date().toISOString() }
    s.admissions.push(a)
    return { admissionId: a.id }
  })
}
export function demoDecideAdmission(biz: string, id: string, decision: 'accept' | 'reject', classId: string | null, note: string): Out<{ status: string; studentId?: string; admissionNo?: string }> {
  return run(biz, 'school_decide', null, (s) => {
    const a = s.admissions.find((x) => x.id === id && x.businessId === biz); if (!a) throw new Error('permission denied')
    guard(biz, 'school-admissions', 'school.students')
    if (a.status !== 'pending') throw new Error(`this application has already been ${a.status}`)
    if (decision !== 'accept' && decision !== 'reject') throw new Error('choose accept or reject')
    if (decision === 'reject') {
      if (trim(note).length < 3) throw new Error('say why the application is rejected')
      Object.assign(a, { status: 'rejected', decidedOn: today(), decisionNote: trim(note) })
      return { status: 'rejected' }
    }
    const cls = classId ?? a.classId
    if (!cls) throw new Error('choose the class the student joins')
    const st = makeStudent(s, biz, { first: a.first, middle: '', last: a.last, dob: a.dob ?? '', gender: a.gender ?? '', classId: cls, admittedOn: '', emergencyName: '', emergencyPhone: '', notes: '' }, [{ name: a.guardianName, phone: a.guardianPhone ?? '', email: a.guardianEmail ?? '', relationship: a.relationship, primary: true }])
    Object.assign(a, { status: 'accepted', decidedOn: today(), decisionNote: nul(note), studentId: st.id })
    const term = currentTerm(s, biz)
    const items = s.feeItems.filter((f) => f.businessId === biz && f.onAdmission && f.active && (!f.classId || f.classId === cls) && (!f.termId || f.termId === term))
    const total = r2(items.reduce((x, f) => x + f.amount, 0))
    if (term && total > 0) s.bills.push({ id: newId('bill'), businessId: biz, number: nextNumber(s, biz, 'bill', 'BILL'), studentId: st.id, termId: term, total, discount: 0, discountReason: null, dueOn: null, createdAt: new Date().toISOString(), items: items.map((f) => ({ name: f.name, amount: f.amount })) })
    return { status: 'accepted', studentId: st.id, admissionNo: st.admissionNo }
  })
}
export function demoSaveGuardian(biz: string, v: { id: string | null; name: string; phone: string; email: string; address: string }): string | null {
  return run(biz, 'school_guardian', null, (s) => {
    guard(biz, 'school-guardians', 'school.students')
    if (trim(v.name).length < 2) throw new Error('enter the parent or guardian\'s name')
    if (v.id === null) s.guardians.push({ id: newId('gd'), businessId: biz, name: trim(v.name), phone: nul(v.phone), email: nul(v.email), address: nul(v.address), userId: null })
    else { const g = s.guardians.find((x) => x.id === v.id && x.businessId === biz); if (!g) throw new Error('guardian not found'); Object.assign(g, { name: trim(v.name), phone: nul(v.phone), email: nul(v.email), address: nul(v.address) }) }
    return null
  }).error
}
export function demoLinkGuardian(biz: string, studentId: string, guardianId: string, relationship: string, primary: boolean, unlink = false): string | null {
  return run(biz, 'school_link', null, (s) => {
    guard(biz, 'school-guardians', 'school.students')
    if (!s.students.some((x) => x.id === studentId && x.businessId === biz) || !s.guardians.some((x) => x.id === guardianId && x.businessId === biz)) throw new Error('unknown student or guardian')
    s.links = s.links.filter((l) => !(l.studentId === studentId && l.guardianId === guardianId))
    if (!unlink) s.links.push({ businessId: biz, studentId, guardianId, relationship: trim(relationship) || 'parent', isPrimary: primary })
    return null
  }).error
}
/** Links the signed-in parent or teacher to the guardian or staff record that carries their email address. */
/** Mirrors school_update_my_contact(): a parent changes only the contact record that belongs to their own login. */
export function demoUpdateMyContact(biz: string, phone: string, address: string): string | null {
  return run(biz, 'school_my_contact', null, (s) => {
    guard(biz, 'school-portal', 'school.portal')
    if (trim(phone).length > 40) throw new Error('the phone number is too long')
    if (trim(address).length > 300) throw new Error('the address is too long')
    const mine = s.guardians.filter((g) => g.businessId === biz && g.userId === me())
    if (!mine.length) throw new Error('no parent or guardian record is linked to your login yet')
    for (const g of mine) { g.phone = nul(phone); g.address = nul(address) }
    return null
  }).error
}
export function demoClaimLinks(biz: string): number {
  ensureDemoSchool(biz)
  const email = myEmail(); if (!email || !me()) return 0
  let n = 0
  const s: School = JSON.parse(JSON.stringify(state)) as School
  if (can(biz, 'school.portal')) for (const g of s.guardians.filter((x) => x.businessId === biz && !x.userId && x.email?.toLowerCase() === email)) { g.userId = me(); n++ }
  for (const st of s.staff.filter((x) => x.businessId === biz && !x.userId && x.email?.toLowerCase() === email)) { st.userId = me(); n++ }
  if (n) commit(s)
  return n
}
export function demoSaveStaff(biz: string, v: { id: string | null; name: string; phone: string; email: string; jobTitle: string; department: string; active: boolean }): string | null {
  return run(biz, 'school_staff', null, (s) => {
    guard(biz, 'school-staff', 'school.manage')
    if (trim(v.name).length < 2) throw new Error('enter the staff member\'s name')
    if (v.id === null) s.staff.push({ id: newId('stf'), businessId: biz, staffNo: nextNumber(s, biz, 'staff', 'STF'), name: trim(v.name), phone: nul(v.phone), email: nul(v.email), jobTitle: nul(v.jobTitle), department: nul(v.department), status: v.active ? 'active' : 'inactive', userId: null })
    else { const x = s.staff.find((y) => y.id === v.id && y.businessId === biz); if (!x) throw new Error('staff member not found'); Object.assign(x, { name: trim(v.name), phone: nul(v.phone), email: nul(v.email), jobTitle: nul(v.jobTitle), department: nul(v.department), status: v.active ? 'active' : 'inactive' }) }
    return null
  }).error
}
export type StaffAccess = { staffId: string; state: 'none' | 'invited' | 'signed_in' | 'suspended'; role: string | null }
export const LOGIN_ROLES = ['teacher', 'bursar', 'admissions_officer', 'principal'] as const
export function demoStaffAccess(biz: string): StaffAccess[] {
  ensureDemoSchool(biz)
  if (!can(biz, 'school.manage')) return []
  const g = getDemoState()
  return state.staff.filter((x) => x.businessId === biz).map((x) => {
    const e = (x.email ?? '').toLowerCase()
    const m = g.members.find((y) => y.businessId === biz && e && y.email === e && y.status !== 'revoked')
    if ((x.userId || m?.status === 'active') && (m?.status === 'suspended' || m?.status === 'revoked')) return { staffId: x.id, state: 'suspended' as const, role: m.role }
    if (x.userId || m?.status === 'active') return { staffId: x.id, state: 'signed_in' as const, role: m?.role ?? null }
    return m?.status === 'invited' ? { staffId: x.id, state: 'invited' as const, role: m.role } : { staffId: x.id, state: 'none' as const, role: null }
  })
}
export function demoGiveLogin(biz: string, staffId: string, role: string): string | null {
  try {
    guard(biz, 'school-staff', 'school.manage')
    const x = state.staff.find((y) => y.id === staffId && y.businessId === biz)
    if (!x) return 'staff member not found'
    const email = trim(x.email).toLowerCase()
    if (!email) return "add the staff member's email address first; it is how they sign in"
    if (!LOGIN_ROLES.includes(role as (typeof LOGIN_ROLES)[number])) return 'choose teacher, bursar, admissions officer or principal'
    if (role === 'principal' && !can(biz, 'staff.manage')) return 'only the owner or an admin can give the principal role'
    const g = getDemoState()
    if (g.members.some((m) => m.businessId === biz && m.email === email && m.status === 'active')) return 'this person already has a login for the school'
    demoCancelInvite(biz, email)
    return demoInviteUnchecked(biz, email, role as Parameters<typeof demoInviteUnchecked>[2])
  } catch (e) { return (e as Error).message }
}
export const loginPasswordProblem = (p: string) => (p.length < 10 || !/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p) ? 'the temporary password needs at least 10 characters with a lowercase letter, an uppercase letter and a number' : null)
export function demoCreateLogin(biz: string, staffId: string, role: string, password: string): string | null {
  try {
    guard(biz, 'school-staff', 'school.manage')
    const x = state.staff.find((y) => y.id === staffId && y.businessId === biz)
    if (!x) return 'staff member not found'
    const email = trim(x.email).toLowerCase()
    if (!email) return "add the staff member's email address first; it is how they sign in"
    if (!LOGIN_ROLES.includes(role as (typeof LOGIN_ROLES)[number])) return 'choose teacher, bursar, admissions officer or principal'
    if (role === 'principal' && !can(biz, 'staff.manage')) return 'only the owner or an admin can give the principal role'
    const bad = loginPasswordProblem(password); if (bad) return bad
    const userId = demoCreateLoginUser(biz, x.name, email, password, role as Parameters<typeof demoInviteUnchecked>[2])
    if (!userId || userId.startsWith('this email')) return userId
    x.userId = userId
    commit({ ...state })
    return null
  } catch (e) { return (e as Error).message }
}
/** Mirrors school_delete_staff(): owner or admin only, with a reason; their access to the school goes with the record. */
export function demoDeleteStaff(biz: string, staffId: string, reason: string): string | null {
  const x = state.staff.find((y) => y.id === staffId && y.businessId === biz)
  if (!demoAllowed(biz, 'school-staff', 'school.delete')) return 'permission denied'
  if (!x) return 'staff member not found'
  if (trim(reason).length < 3) return 'say why (it is kept in the audit trail)'
  const g = getDemoState()
  const member = g.members.find((m) => m.businessId === biz && (m.userId && m.userId === x.userId || (x.email && m.email === trim(x.email).toLowerCase())))
  if (member) { const err = demoDeleteMember(member.id); if (err) return err }
  return run(biz, 'school_staff_delete', null, (s) => {
    s.timetable = s.timetable.map((t) => (t.staffId === staffId ? { ...t, staffId: null } : t))
    s.assignments = s.assignments.filter((a) => a.staffId !== staffId)
    s.staff = s.staff.filter((y) => y.id !== staffId)
    return null
  }).error
}
export function demoCancelLogin(biz: string, staffId: string): string | null {
  try {
    guard(biz, 'school-staff', 'school.manage')
    const x = state.staff.find((y) => y.id === staffId && y.businessId === biz)
    if (!x) return 'staff member not found'
    demoCancelInvite(biz, trim(x.email))
    return null
  } catch (e) { return (e as Error).message }
}
export function demoSetAssignments(biz: string, staffId: string, items: { classId: string; subjectId: string | null; classTeacher: boolean }[]): string | null {
  return run(biz, 'school_assignments', null, (s) => {
    guard(biz, 'school-staff', 'school.manage')
    if (!s.staff.some((x) => x.id === staffId && x.businessId === biz)) throw new Error('staff member not found')
    s.assignments = s.assignments.filter((a) => a.staffId !== staffId)
    for (const it of items) if (!s.assignments.some((a) => a.staffId === staffId && a.classId === it.classId && a.subjectId === it.subjectId && a.classTeacher === it.classTeacher)) s.assignments.push({ id: newId('asg'), businessId: biz, staffId, classId: it.classId, subjectId: it.subjectId, classTeacher: it.classTeacher })
    return null
  }).error
}

// ---------------------------------------------------------------------- attendance
export function demoMarkAttendance(biz: string, classId: string, on: string, rows: { studentId: string; status: AttendanceStatus; note?: string }[]): Out<number> {
  return run(biz, 'school_attendance', null, (s) => {
    guard(biz, 'school-attendance', 'school.attendance')
    if (!can(biz, 'school.read') && !(can(biz, 'school.teach') && teachesClass(s, biz, classId))) throw new Error('you can only take attendance for the classes assigned to you')
    if (!on || on > today()) throw new Error('attendance cannot be taken for a future date')
    if (!(s.settings[biz]?.workingDays ?? [1, 2, 3, 4, 5]).includes(isoDow(on))) throw new Error('the school is not open on that day')
    if (s.holidays.some((h) => h.businessId === biz && h.on === on)) throw new Error('that day is a school holiday')
    if (!rows.length) throw new Error('there is no attendance to save')
    let n = 0
    for (const r of rows) {
      const st = s.students.find((x) => x.id === r.studentId && x.businessId === biz)
      if (!st || st.classId !== classId || st.status !== 'active') throw new Error('every student must be an active member of this class')
      if (!['present', 'absent', 'late', 'excused'].includes(r.status)) throw new Error('choose present, absent, late or excused')
      const ex = s.attendance.find((a) => a.studentId === st.id && a.on === on)
      const note = nul(r.note)
      if (ex) {
        if (ex.status === r.status && ex.note === note) continue
        if (!(can(biz, 'school.manage') || (ex.by === me() && on === today()))) throw new Error(`attendance already saved for ${st.first} can only be corrected by someone who manages the school`)
        s.audit.push({ at: new Date().toISOString(), action: 'school_attendance.update', entity: st.id, detail: `${ex.status} to ${r.status} on ${on}` })
        Object.assign(ex, { status: r.status, note, by: me(), at: new Date().toISOString() })
      } else s.attendance.push({ id: newId('att'), businessId: biz, studentId: st.id, classId, on, status: r.status, note, by: me(), at: new Date().toISOString() })
      n++
    }
    return n
  })
}

// -------------------------------------------------------------------------- results
const gradeOf = (s: School, biz: string, total: number) => (s.bands[biz] ?? []).filter((b) => b.min <= total).sort((a, b) => b.min - a.min)[0]?.grade ?? null
export function demoSaveScores(biz: string, classId: string, subjectId: string, termId: string, rows: { studentId: string; ca: number | null; exam: number | null; remark?: string }[], submit: boolean): Out<number> {
  return run(biz, 'school_scores', null, (s) => {
    guard(biz, 'school-results', 'school.results.enter')
    const approver = can(biz, 'school.results.approve')
    if (!(can(biz, 'school.manage') || approver || (can(biz, 'school.teach') && teachesSubject(s, biz, classId, subjectId)))) throw new Error('you can only enter results for the subjects you teach in your own classes')
    const set = s.settings[biz]; if (!set) throw new Error('set the assessment marks in the school settings first')
    if (!s.terms.some((t) => t.id === termId && t.businessId === biz)) throw new Error('choose the term')
    if (!s.classSubjects.some((x) => x.classId === classId && x.subjectId === subjectId)) throw new Error('this subject is not taught in this class')
    if (!rows.length) throw new Error('there are no scores to save')
    const dec = (v: number) => Math.round(v * 100) / 100 === v
    let n = 0
    for (const r of rows) {
      const st = s.students.find((x) => x.id === r.studentId && x.businessId === biz)
      if (!st || st.classId !== classId) throw new Error('every student must be in this class')
      if (r.ca !== null && (r.ca < 0 || r.ca > set.caMax || !dec(r.ca))) throw new Error(`continuous assessment for ${st.first} must be between 0 and ${set.caMax}`)
      if (r.exam !== null && (r.exam < 0 || r.exam > set.examMax || !dec(r.exam))) throw new Error(`the exam score for ${st.first} must be between 0 and ${set.examMax}`)
      if (submit && (r.ca === null || r.exam === null)) throw new Error(`enter both scores for ${st.first} before submitting`)
      const ex = s.scores.find((x) => x.studentId === st.id && x.subjectId === subjectId && x.termId === termId)
      if (ex) {
        if (['submitted', 'approved', 'published'].includes(ex.status) && !approver) throw new Error(`results for ${st.first} are already ${ex.status}; only someone who approves results can change them`)
        if (ex.status === 'published') s.audit.push({ at: new Date().toISOString(), action: 'school_scores.update', entity: st.id, detail: `published result changed to ${r.ca}/${r.exam}` })
        Object.assign(ex, { ca: r.ca, exam: r.exam, remark: nul(r.remark), status: ['approved', 'published'].includes(ex.status) ? ex.status : submit ? 'submitted' : 'draft' })
      } else s.scores.push({ id: newId('scr'), businessId: biz, studentId: st.id, classId, subjectId, termId, ca: r.ca, exam: r.exam, remark: nul(r.remark), status: submit ? 'submitted' : 'draft', reviewNote: null })
      n++
    }
    return n
  })
}
export function demoReviewScores(biz: string, classId: string, subjectId: string, termId: string, action: 'approve' | 'publish' | 'reject' | 'unpublish', note: string): Out<number> {
  return run(biz, 'school_review', null, (s) => {
    guard(biz, 'school-results', 'school.results.approve')
    const map = { approve: ['submitted', 'approved'], publish: ['approved', 'published'], reject: ['submitted', 'draft'], unpublish: ['published', 'approved'] } as const
    const m = map[action]; if (!m) throw new Error('choose approve, publish, reject or unpublish')
    if ((action === 'reject' || action === 'unpublish') && trim(note).length < 3) throw new Error('say why')
    const hit = s.scores.filter((x) => x.businessId === biz && x.classId === classId && x.subjectId === subjectId && x.termId === termId && x.status === m[0])
    if (!hit.length) throw new Error(`there are no ${m[0]} results for this class and subject to ${action}`)
    hit.forEach((x) => { x.status = m[1]; x.reviewNote = nul(note) })
    return hit.length
  })
}
export function demoSaveRemarks(biz: string, studentId: string, termId: string, teacher: string, principal: string, promotion: SRemark['promotion']): string | null {
  return run(biz, 'school_remarks', null, (s) => {
    const st = s.students.find((x) => x.id === studentId && x.businessId === biz); if (!st) throw new Error('permission denied')
    const head = demoAllowed(biz, 'school-results', 'school.results.approve')
    const ok = demoAllowed(biz, 'school-results', 'school.results.enter') && (can(biz, 'school.read') || teachesClass(s, biz, st.classId))
    if (!(head || ok)) throw new Error('permission denied')
    if (promotion !== null && !['promoted', 'repeat', 'graduate'].includes(promotion)) throw new Error('choose promoted, repeat or graduate')
    const ex = s.remarks.find((r) => r.studentId === studentId && r.termId === termId)
    if (ex) Object.assign(ex, { teacherRemark: nul(teacher), ...(head ? { principalRemark: nul(principal), promotion } : {}) })
    else s.remarks.push({ id: newId('rmk'), businessId: biz, studentId, termId, teacherRemark: nul(teacher), principalRemark: head ? nul(principal) : null, promotion: head ? promotion : null })
    return null
  }).error
}
export interface ReportCard {
  student: { name: string; admissionNo: string; class: string | null; gender?: string | null; dob?: string | null }; term: string; session: string | null
  subjects: { subject: string; ca: number | null; exam: number | null; total: number; grade: string | null; remark: string | null; status: ScoreStatus; classAvg?: number | null; highest?: number | null; lowest?: number | null }[]
  school?: { name: string; address: string | null; phone: string | null; email: string | null; caMax: number; examMax: number }; bands?: SBand[]; nextTerm?: { name: string; startsOn: string } | null
  average: number | null; attendance: { present: number; absent: number; late: number; excused: number; marked: number }
  remarks: { teacherRemark: string | null; principalRemark: string | null; promotion: string | null } | null; position: number | null; classSize: number | null
}
export function demoReportCard(biz: string, studentId: string, termId: string): ReportCard {
  const st = state.students.find((x) => x.id === studentId && x.businessId === biz)
  if (!st || !canSee(state, biz, st)) throw new Error('permission denied')
  const t = state.terms.find((x) => x.id === termId && x.businessId === biz); if (!t) throw new Error('term not found')
  const staff = can(biz, 'school.read') || can(biz, 'school.teach')
  const mine = state.scores.filter((x) => x.studentId === studentId && x.termId === termId && (x.status === 'published' || staff))
  const figures = (subjectId: string) => state.scores.filter((y) => y.businessId === biz && y.classId === st.classId && y.subjectId === subjectId && y.termId === termId && y.status === 'published').map((y) => (y.ca ?? 0) + (y.exam ?? 0))
  const subjects = mine.map((x) => { const total = r2((x.ca ?? 0) + (x.exam ?? 0)); const fig = figures(x.subjectId); return { subject: state.subjects.find((y) => y.id === x.subjectId)?.name ?? '', ca: x.ca, exam: x.exam, total, grade: gradeOf(state, biz, total), remark: x.remark, status: x.status, classAvg: fig.length ? Math.round((fig.reduce((a, b) => a + b, 0) / fig.length) * 10) / 10 : null, highest: fig.length ? Math.max(...fig) : null, lowest: fig.length ? Math.min(...fig) : null } }).sort((a, b) => a.subject.localeCompare(b.subject))
  const average = subjects.length ? r2(subjects.reduce((a, x) => a + x.total, 0) / subjects.length) : null
  const att = state.attendance.filter((a) => a.studentId === studentId && a.on >= t.startsOn && a.on <= t.endsOn)
  const rem = state.remarks.find((r) => r.studentId === studentId && r.termId === termId)
  let position: number | null = null; let classSize: number | null = null
  if (state.settings[biz]?.showPosition && average !== null) {
    const by = new Map<string, number[]>()
    for (const x of state.scores.filter((y) => y.businessId === biz && y.classId === st.classId && y.termId === termId && y.status === 'published')) by.set(x.studentId, [...(by.get(x.studentId) ?? []), (x.ca ?? 0) + (x.exam ?? 0)])
    const avgs = [...by.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length)
    position = avgs.filter((a) => a > average).length + 1; classSize = avgs.length
  }
  const set = state.settings[biz]
  const next = state.terms.filter((x) => x.businessId === biz && x.startsOn > t.endsOn).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0]
  return { school: { name: getDemoState().businesses.find((b) => b.id === biz)?.name ?? 'School', address: set?.address ?? null, phone: set?.phone ?? null, email: set?.email ?? null, caMax: set?.caMax ?? 40, examMax: set?.examMax ?? 60 }, bands: [...(state.bands[biz] ?? [])], nextTerm: next ? { name: next.name, startsOn: next.startsOn } : null,
    student: { name: studentName(st), admissionNo: st.admissionNo, class: state.classes.find((c) => c.id === st.classId)?.name ?? null, gender: st.gender, dob: st.dob }, term: t.name, session: state.sessions.find((x) => x.id === t.sessionId)?.name ?? null, subjects, average,
    attendance: { present: att.filter((a) => a.status === 'present').length, absent: att.filter((a) => a.status === 'absent').length, late: att.filter((a) => a.status === 'late').length, excused: att.filter((a) => a.status === 'excused').length, marked: att.length },
    remarks: rem ? { teacherRemark: rem.teacherRemark, principalRemark: rem.principalRemark, promotion: rem.promotion } : null, position, classSize }
}

// ---------------------------------------------------------------------------- fees
export function demoSaveFeeItem(biz: string, v: { id: string | null; name: string; amount: number; classId: string | null; termId: string | null; onAdmission: boolean; active: boolean }): string | null {
  return run(biz, 'school_fee', null, (s) => {
    guard(biz, 'school-fees', 'school.fees.manage')
    if (!trim(v.name)) throw new Error('enter the fee name')
    if (!(v.amount >= 0) || r2(v.amount) !== v.amount) throw new Error('the amount must be zero or more with at most 2 decimals')
    if (v.id === null) s.feeItems.push({ id: newId('fee'), businessId: biz, name: trim(v.name), amount: v.amount, classId: v.classId, termId: v.termId, onAdmission: v.onAdmission, active: v.active })
    else { const x = s.feeItems.find((y) => y.id === v.id && y.businessId === biz); if (!x) throw new Error('fee not found'); Object.assign(x, { name: trim(v.name), amount: v.amount, classId: v.classId, termId: v.termId, onAdmission: v.onAdmission, active: v.active }) }
    return null
  }).error
}
export function demoGenerateBills(biz: string, termId: string, classId: string | null, dueOn: string | null, key: string): Out<{ created: number; skipped: number }> {
  return run(biz, 'school_bills', key, (s) => {
    guard(biz, 'school-fees', 'school.fees.manage')
    if (!s.terms.some((t) => t.id === termId && t.businessId === biz)) throw new Error('choose the term')
    let created = 0; let skipped = 0
    for (const st of s.students.filter((x) => x.businessId === biz && x.status === 'active' && x.classId && (!classId || x.classId === classId)).sort((a, b) => a.admissionNo.localeCompare(b.admissionNo))) {
      if (s.bills.some((b) => b.studentId === st.id && b.termId === termId)) { skipped++; continue }
      const items = s.feeItems.filter((f) => f.businessId === biz && f.active && !f.onAdmission && (!f.classId || f.classId === st.classId) && (!f.termId || f.termId === termId))
      const total = r2(items.reduce((a, f) => a + f.amount, 0))
      if (total <= 0) { skipped++; continue }
      s.bills.push({ id: newId('bill'), businessId: biz, number: nextNumber(s, biz, 'bill', 'BILL'), studentId: st.id, termId, total, discount: 0, discountReason: null, dueOn, createdAt: new Date().toISOString(), items: items.map((f) => ({ name: f.name, amount: f.amount })) })
      created++
    }
    return { created, skipped }
  })
}
export function demoAdjustBill(biz: string, billId: string, v: { discount: number | null; reason: string; chargeName: string; chargeAmount: number | null }): string | null {
  return run(biz, 'school_adjust', null, (s) => {
    const b = s.bills.find((x) => x.id === billId && x.businessId === biz); if (!b) throw new Error('permission denied')
    guard(biz, 'school-fees', 'school.fees.manage')
    if (v.chargeAmount !== null && v.chargeAmount > 0) { if (!trim(v.chargeName)) throw new Error('name the extra charge'); b.items.push({ name: trim(v.chargeName), amount: v.chargeAmount }); b.total = r2(b.total + v.chargeAmount) }
    if (v.discount !== null) {
      if (v.discount < 0 || v.discount > b.total) throw new Error('a discount cannot be more than the bill total')
      if (v.discount > 0 && trim(v.reason).length < 3) throw new Error('say why the discount or waiver is given')
      b.discount = v.discount; b.discountReason = nul(v.reason)
    }
    return null
  }).error
}
export function demoRecordPayment(biz: string, billId: string, amount: number, method: string, reference: string, key: string): Out<{ paymentId: string; receipt: string; balance: number }> {
  return run(biz, 'school_payment', key, (s) => {
    const b = s.bills.find((x) => x.id === billId && x.businessId === biz); if (!b) throw new Error('permission denied')
    guard(biz, 'school-payments', 'school.fees.record')
    if (!(amount > 0) || r2(amount) !== amount) throw new Error('the amount must be more than zero with at most 2 decimals')
    if (!(PAY_METHODS as readonly string[]).includes(method)) throw new Error('choose how it was paid')
    const paid = r2(s.payments.filter((p) => p.billId === billId && p.status === 'posted').reduce((a, p) => a + p.amount, 0))
    const balance = r2(b.total - b.discount - paid)
    if (amount > balance) throw new Error(`the payment is more than the balance of ${balance}`)
    const p: SPayment = { id: newId('pay'), businessId: biz, receipt: nextNumber(s, biz, 'receipt', 'RCT'), billId, studentId: b.studentId, amount, method, reference: nul(reference), paidOn: today(), by: me(), status: 'posted', reversalReason: null, createdAt: new Date().toISOString() }
    s.payments.push(p)
    return { paymentId: p.id, receipt: p.receipt, balance: r2(balance - amount) }
  })
}
export function demoReversePayment(biz: string, paymentId: string, reason: string): string | null {
  return run(biz, 'school_reverse', null, (s) => {
    const p = s.payments.find((x) => x.id === paymentId && x.businessId === biz); if (!p) throw new Error('permission denied')
    guard(biz, 'school-payments', 'school.fees.manage')
    if (p.status !== 'posted') throw new Error('this payment is already reversed')
    if (trim(reason).length < 3) throw new Error('say why the payment is reversed')
    Object.assign(p, { status: 'reversed', reversalReason: trim(reason) })
    return null
  }).error
}

// ----------------------------------------------------------------- announcements
export function demoPublishAnnouncement(biz: string, v: { title: string; body: string; audience: SAnnouncement['audience']; classId: string | null; publishOn: string }): string | null {
  return run(biz, 'school_announce', null, (s) => {
    guard(biz, 'school-announcements', 'school.manage')
    if (!['everyone', 'parents', 'teachers', 'staff', 'class'].includes(v.audience)) throw new Error('choose who the announcement is for')
    if (v.audience === 'class' && !s.classes.some((c) => c.id === v.classId && c.businessId === biz)) throw new Error('choose the class')
    if (trim(v.title).length < 2 || trim(v.body).length < 2) throw new Error('enter a title and a message')
    s.announcements.push({ id: newId('ann'), businessId: biz, title: trim(v.title), body: trim(v.body), audience: v.audience, classId: v.audience === 'class' ? v.classId : null, publishOn: v.publishOn || today(), createdAt: new Date().toISOString() })
    return null
  }).error
}

// ---------------------------------------------------------------------- overview
export interface SchoolOverviewData {
  termId: string | null; term: string | null; students: number; staff: number; classes: number; newAdmissions: number; pendingApplications: number
  markedToday: number; presentToday: number; absentToday: number; attendanceRate: number | null; enrolment: { class: string; students: number }[]; attendanceWeek: { day: string; marked: number; present: number }[]; resultsAwaiting: number
  billed: number | null; collected: number | null; outstanding: number | null; recentPayments: { receipt: string; student: string; amount: number; paidOn: string }[] | null; feesByClass: { class: string; billed: number; collected: number }[] | null
}
export function demoSchoolOverview(biz: string, termId: string | null): SchoolOverviewData {
  ensureDemoSchool(biz)
  guard(biz, 'dashboard', 'dashboard.read')
  if (!(can(biz, 'school.read') || can(biz, 'school.manage'))) throw new Error('permission denied')
  const term = state.terms.find((t) => t.id === (termId ?? currentTerm(state, biz)) && t.businessId === biz) ?? null
  const money = can(biz, 'school.fees.read')
  const students = state.students.filter((x) => x.businessId === biz && x.status === 'active')
  const att = state.attendance.filter((a) => a.businessId === biz && a.on === today())
  const bills = money && term ? demoBills(biz).filter((b) => b.termId === term.id) : []
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6))
  return {
    termId: term?.id ?? null, term: term?.name ?? null, students: students.length, staff: state.staff.filter((x) => x.businessId === biz && x.status === 'active').length, classes: state.classes.filter((c) => c.businessId === biz && c.active).length,
    newAdmissions: state.students.filter((x) => x.businessId === biz && x.admittedOn >= (term?.startsOn ?? addDays(today(), -90))).length, pendingApplications: state.admissions.filter((a) => a.businessId === biz && a.status === 'pending').length,
    markedToday: att.length, presentToday: att.filter((a) => a.status === 'present' || a.status === 'late').length, absentToday: att.filter((a) => a.status === 'absent').length,
    attendanceRate: att.length ? Math.round((att.filter((a) => a.status === 'present' || a.status === 'late').length * 1000) / att.length) / 10 : null,
    enrolment: state.classes.filter((c) => c.businessId === biz && c.active).sort((a, b) => a.levelOrder - b.levelOrder).map((c) => ({ class: c.name, students: students.filter((x) => x.classId === c.id).length })),
    attendanceWeek: days.map((d) => { const r = state.attendance.filter((a) => a.businessId === biz && a.on === d); return { day: d, marked: r.length, present: r.filter((a) => a.status === 'present' || a.status === 'late').length } }),
    resultsAwaiting: new Set(state.scores.filter((x) => x.businessId === biz && x.status === 'submitted').map((x) => `${x.classId}|${x.subjectId}|${x.termId}`)).size,
    billed: money ? r2(bills.reduce((a, b) => a + b.payable, 0)) : null, collected: money ? r2(bills.reduce((a, b) => a + b.paid, 0)) : null, outstanding: money ? r2(bills.reduce((a, b) => a + Math.max(b.balance, 0), 0)) : null,
    recentPayments: money ? state.payments.filter((p) => p.businessId === biz && p.status === 'posted').slice(-5).reverse().map((p) => ({ receipt: p.receipt, student: studentName(state.students.find((x) => x.id === p.studentId)!), amount: p.amount, paidOn: p.paidOn })) : null,
    feesByClass: money ? state.classes.filter((c) => c.businessId === biz).sort((a, b) => a.levelOrder - b.levelOrder).map((c) => { const bb = bills.filter((b) => state.students.find((x) => x.id === b.studentId)?.classId === c.id); return { class: c.name, billed: r2(bb.reduce((a, b) => a + b.payable, 0)), collected: r2(bb.reduce((a, b) => a + b.paid, 0)) } }).filter((x) => x.billed > 0) : null,
  }
}

// ----------------------------------------------------------------- sample data
/** Seeds a demo school once: the standard structure, a teacher, ten students with parents, a week of attendance, some results, fees and notices. Clearly demo data. */
export function ensureDemoSchool(biz: string) {
  if (state.seeded.includes(biz)) return
  // Only the built-in sample school gets sample data. A school someone creates starts empty and is set up from the kind of school they choose.
  if (biz !== 'b-school') return
  const business = getDemoState().businesses.find((x) => x.id === biz)
  if (business?.industry !== 'school') return
  const s: School = JSON.parse(JSON.stringify(state)) as School
  s.seeded.push(biz)
  buildStructure(s, biz, 'combined', '2026/2027', addDays(today(), -30))
  const cls = (n: string) => s.classes.find((c) => c.businessId === biz && c.name === n)!
  const sub = (n: string) => s.subjects.find((c) => c.businessId === biz && c.name === n)!
  const p1 = cls('Primary 1'); const p2 = cls('Primary 2'); const jss1 = cls('JSS 1')
  const eng = sub('English Language'); const mth = sub('Mathematics')
  const teacher: SStaff = { id: newId('stf'), businessId: biz, staffNo: nextNumber(s, biz, 'staff', 'STF'), name: 'Mr Teacher', phone: '0803 111 0001', email: 'teacher@demo.test', jobTitle: 'Class teacher', department: 'Primary', status: 'active', userId: null }
  s.staff.push(teacher)
  s.assignments.push({ id: newId('asg'), businessId: biz, staffId: teacher.id, classId: p1.id, subjectId: null, classTeacher: true }, { id: newId('asg'), businessId: biz, staffId: teacher.id, classId: p1.id, subjectId: eng.id, classTeacher: false }, { id: newId('asg'), businessId: biz, staffId: teacher.id, classId: p1.id, subjectId: mth.id, classTeacher: false })
  const people: [string, string, string, SClass][] = [['Ada', 'Obi', 'female', p1], ['Bola', 'Obi', 'male', p1], ['Chidi', 'Eze', 'male', p1], ['Dayo', 'Ade', 'female', p1], ['Emeka', 'Nwosu', 'male', p2], ['Funke', 'Bello', 'female', p2], ['Gina', 'Musa', 'female', p2], ['Hassan', 'Lawal', 'male', jss1], ['Ify', 'Okeke', 'female', jss1], ['Jide', 'Ojo', 'male', jss1]]
  const students = people.map(([first, last, gender, c], i) => makeStudent(s, biz, { first, middle: '', last, dob: `201${3 + (i % 5)}-0${1 + (i % 9)}-1${i % 9}`, gender, classId: c.id, admittedOn: addDays(today(), -30), emergencyName: '', emergencyPhone: '', notes: '' },
    i < 2 ? [{ name: 'Mrs Obi', phone: '0803 000 1234', email: 'parent@demo.test', relationship: 'mother', primary: true }] : [{ name: `Parent of ${first}`, phone: `0805 000 ${1000 + i}`, email: '', relationship: 'parent', primary: true }]))
  const days: string[] = []; for (let d = -1; days.length < 5 && d > -14; d--) { const date = addDays(today(), d); if (isoDow(date) <= 5) days.push(date) }
  for (const date of days) for (const [i, st] of students.entries()) s.attendance.push({ id: newId('att'), businessId: biz, studentId: st.id, classId: st.classId!, on: date, status: (i + days.indexOf(date)) % 9 === 0 ? 'absent' : (i + days.indexOf(date)) % 7 === 0 ? 'late' : 'present', note: null, by: null, at: new Date().toISOString() })
  const term = s.terms.find((t) => t.businessId === biz && t.current)!
  const mark = (st: SStudent, subject: SSubject, ca: number, exam: number, status: ScoreStatus) => s.scores.push({ id: newId('scr'), businessId: biz, studentId: st.id, classId: st.classId!, subjectId: subject.id, termId: term.id, ca, exam, remark: null, status, reviewNote: null })
  students.slice(0, 4).forEach((st, i) => { mark(st, eng, 30 - i * 3, 45 + i * 2, 'published'); mark(st, mth, 25 - i * 2, 40 + i * 3, 'submitted') })
  s.feeItems.push({ id: newId('fee'), businessId: biz, name: 'Tuition', amount: 40000, classId: null, termId: term.id, onAdmission: false, active: true }, { id: newId('fee'), businessId: biz, name: 'Textbooks', amount: 8000, classId: p2.id, termId: term.id, onAdmission: false, active: true }, { id: newId('fee'), businessId: biz, name: 'Registration', amount: 5000, classId: null, termId: null, onAdmission: true, active: true })
  for (const st of students) {
    const items = s.feeItems.filter((f) => f.active && !f.onAdmission && (!f.classId || f.classId === st.classId))
    s.bills.push({ id: newId('bill'), businessId: biz, number: nextNumber(s, biz, 'bill', 'BILL'), studentId: st.id, termId: term.id, total: r2(items.reduce((a, f) => a + f.amount, 0)), discount: 0, discountReason: null, dueOn: addDays(today(), 14), createdAt: new Date().toISOString(), items: items.map((f) => ({ name: f.name, amount: f.amount })) })
  }
  students.slice(0, 5).forEach((st, i) => { const b = s.bills.find((x) => x.studentId === st.id)!; s.payments.push({ id: newId('pay'), businessId: biz, receipt: nextNumber(s, biz, 'receipt', 'RCT'), billId: b.id, studentId: st.id, amount: i % 2 ? b.total : 20000, method: i % 2 ? 'bank_transfer' : 'cash', reference: null, paidOn: addDays(today(), -i), by: null, status: 'posted', reversalReason: null, createdAt: new Date().toISOString() }) })
  s.announcements.push({ id: newId('ann'), businessId: biz, title: 'Welcome back', body: 'The new term has started. Fees are due within two weeks.', audience: 'parents', classId: null, publishOn: addDays(today(), -3), createdAt: new Date().toISOString() },
    { id: newId('ann'), businessId: biz, title: 'Staff meeting', body: 'Friday at 2pm in the staff room.', audience: 'teachers', classId: null, publishOn: addDays(today(), -1), createdAt: new Date().toISOString() })
  commit(s)
}

// ------------------------------------------------------------------- timetable
/** The first time a demo school's timetable is looked at it gets a normal school day and a week of lessons for Primary 1, so there is something to see. */
function seedTimetable(biz: string) {
  if (biz !== 'b-school' || state.ttSeeded.includes(biz) || !state.classes.some((c) => c.businessId === biz)) return
  const s: School = JSON.parse(JSON.stringify(state)) as School
  s.ttSeeded.push(biz)
  const times: [string, string, string, boolean][] = [['Period 1', '08:00', '08:40', false], ['Period 2', '08:40', '09:20', false], ['Period 3', '09:20', '10:00', false], ['Break', '10:00', '10:20', true], ['Period 4', '10:20', '11:00', false], ['Period 5', '11:00', '11:40', false], ['Period 6', '11:40', '12:20', false]]
  times.forEach(([label, startsAt, endsAt, isBreak], i) => s.periods.push({ id: newId('per'), businessId: biz, label, startsAt, endsAt, isBreak, position: i + 1 }))
  const p1 = s.classes.find((c) => c.businessId === biz && c.name === 'Primary 1')
  if (p1) {
    const taken = s.classSubjects.filter((x) => x.classId === p1.id).map((x) => x.subjectId)
    const named = (n: string) => s.subjects.find((x) => x.businessId === biz && x.name === n)?.id
    const eng = named('English Language'); const mth = named('Mathematics')
    const others = taken.filter((id) => id !== eng && id !== mth)
    const teach = (sub: string | undefined) => s.assignments.find((a) => a.businessId === biz && a.classId === p1.id && a.subjectId === sub)?.staffId ?? null
    const lessons = s.periods.filter((p) => !p.isBreak)
    for (let day = 1; day <= 5; day++) lessons.forEach((p, i) => {
      const subject = i === 0 ? (day % 2 ? eng : mth) : i === 1 ? (day % 2 ? mth : eng) : others[(day + i) % Math.max(others.length, 1)]
      if (subject) s.timetable.push({ id: newId('slt'), businessId: biz, classId: p1.id, day, periodId: p.id, subjectId: subject, staffId: teach(subject), room: null })
    })
  }
  commit(s)
}

/** What the signed-in person may see: managers everything, a teacher their own lessons and classes, a parent their child's class. */
export function demoTimetable(biz: string): { periods: SPeriod[]; slots: SSlot[] } {
  ensureDemoSchool(biz); seedTimetable(biz)
  if (!getDemoState().members.some((m) => m.businessId === biz && m.userId === me() && m.status === 'active')) throw new Error('permission denied')
  const mineStaff = staffOf(state, biz)
  const visible = (x: SSlot) => can(biz, 'school.read') || teachesClass(state, biz, x.classId) || (!!mineStaff && x.staffId === mineStaff.id)
    || state.students.some((st) => st.businessId === biz && st.classId === x.classId && isGuardianOf(state, biz, st.id))
  return { periods: state.periods.filter((p) => p.businessId === biz).sort((a, b) => a.position - b.position), slots: state.timetable.filter((x) => x.businessId === biz && visible(x)) }
}

export function demoSavePeriods(biz: string, list: { id?: string | null; label: string; starts: string; ends: string; isBreak: boolean }[]): string | null {
  return run(biz, 'school_periods', null, (s) => {
    guard(biz, 'school-timetable', 'school.manage')
    if (list.length < 1 || list.length > 30) throw new Error('add between 1 and 30 periods')
    let prev = ''
    for (const p of list) {
      if (!trim(p.label)) throw new Error('every period needs a name')
      if (!p.starts || !p.ends || p.ends <= p.starts) throw new Error(`period "${p.label}" must end after it starts`)
      if (prev && p.starts < prev) throw new Error(`period "${p.label}" starts before the one above it ends`)
      prev = p.ends
    }
    const keep = new Set<string>()
    const next: SPeriod[] = list.map((p, i) => {
      const ex = p.id ? s.periods.find((x) => x.id === p.id && x.businessId === biz) : undefined
      if (ex && p.isBreak && s.timetable.some((t) => t.periodId === ex.id)) throw new Error(`period "${p.label}" has lessons in the timetable, so it cannot become a break`)
      const id = ex?.id ?? newId('per'); keep.add(id)
      return { id, businessId: biz, label: trim(p.label), startsAt: p.starts, endsAt: p.ends, isBreak: p.isBreak, position: i + 1 }
    })
    for (const old of s.periods.filter((x) => x.businessId === biz && !keep.has(x.id))) if (s.timetable.some((t) => t.periodId === old.id)) throw new Error(`period "${old.label}" has lessons in the timetable; clear them before removing it`)
    s.periods = s.periods.filter((x) => x.businessId !== biz).concat(next)
    return null
  }).error
}

export function demoSetSlot(biz: string, classId: string, day: number, periodId: string, subjectId: string | null, staffId: string | null, room: string): string | null {
  return run(biz, 'school_slot', null, (s) => {
    guard(biz, 'school-timetable', 'school.manage')
    if (!s.classes.some((c) => c.id === classId && c.businessId === biz && c.active)) throw new Error('choose a class that is open')
    const period = s.periods.find((p) => p.id === periodId && p.businessId === biz); if (!period) throw new Error('period not found')
    const rest = s.timetable.filter((x) => !(x.businessId === biz && x.classId === classId && x.day === day && x.periodId === periodId))
    if (subjectId === null) { s.timetable = rest; return null }
    if (!(s.settings[biz]?.workingDays ?? [1, 2, 3, 4, 5]).includes(day)) throw new Error('that day is not a school day')
    if (period.isBreak) throw new Error('a break cannot have a lesson')
    if (!s.classSubjects.some((x) => x.classId === classId && x.subjectId === subjectId)) throw new Error('this class does not take that subject')
    if (staffId !== null) {
      if (!s.assignments.some((a) => a.businessId === biz && a.classId === classId && a.subjectId === subjectId && a.staffId === staffId) || !s.staff.some((x) => x.id === staffId && x.status === 'active')) throw new Error('that teacher is not assigned to this subject in this class (assign them under Teachers & Staff first)')
      if (rest.some((x) => x.businessId === biz && x.staffId === staffId && x.day === day && x.periodId === periodId)) throw new Error('that teacher already has a lesson at this time in another class')
    }
    s.timetable = [...rest, { id: newId('slt'), businessId: biz, classId, day, periodId, subjectId, staffId, room: nul(room) }]
    return null
  }).error
}

// ---------------------------------------------------------------------- deleting
/** Mirrors school_delete_student(): owners and business admins only; a student with fee payments on record is refused. */
export function demoDeleteStudent(biz: string, studentId: string, reason: string): string | null {
  return run(biz, 'school_delete_student', null, (s) => {
    const st = s.students.find((x) => x.id === studentId && x.businessId === biz); if (!st) throw new Error('permission denied')
    guard(biz, 'school-students', 'school.delete')
    if (trim(reason).length < 3) throw new Error('say why (it is kept in the audit trail)')
    if (s.payments.some((p) => p.studentId === studentId)) throw new Error('this student has fee payments on record. Records of money are never erased; mark the student as withdrawn instead')
    s.scores = s.scores.filter((x) => x.studentId !== studentId); s.attendance = s.attendance.filter((x) => x.studentId !== studentId); s.remarks = s.remarks.filter((x) => x.studentId !== studentId)
    s.bills = s.bills.filter((x) => x.studentId !== studentId); s.enrollments = s.enrollments.filter((x) => x.studentId !== studentId); s.links = s.links.filter((x) => x.studentId !== studentId)
    s.admissions.forEach((a) => { if (a.studentId === studentId) a.studentId = null })
    s.students = s.students.filter((x) => x.id !== studentId)
    s.audit.push({ at: new Date().toISOString(), action: 'school_student.delete', entity: studentId, detail: `${studentName(st)} (${st.admissionNo}): ${trim(reason)}` })
    return null
  }).error
}
/** Mirrors school_delete_guardian(): the record and its links go; the person's login does not. */
export function demoDeleteGuardian(biz: string, guardianId: string, reason: string): string | null {
  return run(biz, 'school_delete_guardian', null, (s) => {
    const g = s.guardians.find((x) => x.id === guardianId && x.businessId === biz); if (!g) throw new Error('permission denied')
    guard(biz, 'school-guardians', 'school.delete')
    if (trim(reason).length < 3) throw new Error('say why (it is kept in the audit trail)')
    s.links = s.links.filter((x) => x.guardianId !== guardianId)
    s.guardians = s.guardians.filter((x) => x.id !== guardianId)
    s.audit.push({ at: new Date().toISOString(), action: 'school_guardian.delete', entity: guardianId, detail: `${g.name}: ${trim(reason)}` })
    return null
  }).error
}
