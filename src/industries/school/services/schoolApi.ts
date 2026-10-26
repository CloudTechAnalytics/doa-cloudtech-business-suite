import * as sc from '@/demo/demoSchool'
import type { ApplicationInput, AttendanceStatus, SPeriod, SSlot, BillRow, GuardianInput, ReportCard, SAdmission, SAnnouncement, SAssignment, SAttendance, SBand, SClass, Stage, SEnrollment, SFeeItem, SGuardian, SHoliday, SLink, SPayment, SRemark, SScore, SSession, SSettings, SStaff, SStudent, SSubject, STerm, SchoolOverviewData, StudentInput, StudentStatus } from '@/demo/demoSchool'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** School data access. Live mode reads row-level-secured tables and calls database functions; demo mode runs the browser mirror.
 *  Mutations return an error message or null. */
export type { SPeriod, SSlot, ApplicationInput, AttendanceStatus, BillRow, GuardianInput, ReportCard, SAdmission, SAnnouncement, SAssignment, SAttendance, SBand, SClass, Stage, SEnrollment, SFeeItem, SGuardian, SHoliday, SLink, SPayment, SRemark, SScore, SSession, SSettings, SStaff, SStudent, SSubject, STerm, SchoolOverviewData, StudentInput, StudentStatus }
export { PAY_METHODS, STAGES, stageOk } from '@/demo/demoSchool'

const n = (v: unknown) => Number(v ?? 0)
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const d = (v: unknown) => (v ? String(v).slice(0, 10) : null)
const db = () => supabase!
const msg = (e: { message: string } | null) => e?.message ?? null
const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return (r.data ?? []) as T }
type Row = Record<string, unknown>

/** A teacher or parent is matched to their record by email the first time they open the school; every read waits for that once per business. */
const claims = new Map<string, Promise<void>>()
function ready(b: string): Promise<void> {
  if (isDemoMode) { sc.demoClaimLinks(b); return Promise.resolve() }
  if (!claims.has(b)) claims.set(b, claimLinks(b).catch(() => undefined))
  return claims.get(b)!
}

export interface Structure { settings: SSettings | null; bands: SBand[]; sessions: SSession[]; terms: STerm[]; classes: SClass[]; subjects: SSubject[]; classSubjects: { classId: string; subjectId: string }[]; holidays: SHoliday[] }

// --------------------------------------------------------------------- reads
export async function loadStructure(b: string): Promise<Structure> {
  await ready(b)
  if (isDemoMode) return sc.demoStructure(b)
  const [set, bands, ses, trm, cls, sub, cs, hol] = await Promise.all([
    db().from('school_settings').select('*').eq('business_id', b).maybeSingle(), db().from('school_grade_bands').select('*').eq('business_id', b).order('min_score', { ascending: false }),
    db().from('school_sessions').select('*').eq('business_id', b).order('starts_on', { ascending: false }), db().from('school_terms').select('*').eq('business_id', b).order('starts_on'),
    db().from('school_classes').select('*').eq('business_id', b).order('level_order').order('name'), db().from('school_subjects').select('*').eq('business_id', b).order('name'),
    db().from('school_class_subjects').select('class_id, subject_id').eq('business_id', b), db().from('school_holidays').select('*').eq('business_id', b).order('on_date'),
  ])
  if (set.error) throw new Error(set.error.message)
  const x = set.data as Row | null
  return {
    settings: x ? { schoolType: x.school_type as SSettings['schoolType'], address: x.address as string | null, phone: x.phone as string | null, email: x.email as string | null, caMax: n(x.ca_max), examMax: n(x.exam_max), showPosition: !!x.show_position, workingDays: (x.working_days as number[]) ?? [1, 2, 3, 4, 5] } : null,
    bands: must<Row[]>(bands).map((r) => ({ min: n(r.min_score), grade: String(r.grade), remark: r.remark as string | null })),
    sessions: must<Row[]>(ses).map((r) => ({ id: String(r.id), businessId: b, name: String(r.name), startsOn: d(r.starts_on)!, endsOn: d(r.ends_on)!, current: !!r.is_current })),
    terms: must<Row[]>(trm).map((r) => ({ id: String(r.id), businessId: b, sessionId: String(r.session_id), name: String(r.name), startsOn: d(r.starts_on)!, endsOn: d(r.ends_on)!, current: !!r.is_current })),
    classes: must<Row[]>(cls).map((r) => ({ id: String(r.id), businessId: b, name: String(r.name), levelOrder: n(r.level_order), arm: r.arm as string | null, active: !!r.active, stage: (r.stage as Stage) ?? 'primary' })),
    subjects: must<Row[]>(sub).map((r) => ({ id: String(r.id), businessId: b, name: String(r.name), code: r.code as string | null })),
    classSubjects: must<Row[]>(cs).map((r) => ({ classId: String(r.class_id), subjectId: String(r.subject_id) })),
    holidays: must<Row[]>(hol).map((r) => ({ businessId: b, on: d(r.on_date)!, name: String(r.name) })),
  }
}
const studentRow = (r: Row, b: string): SStudent => ({ id: String(r.id), businessId: b, admissionNo: String(r.admission_no), first: String(r.first_name), middle: r.middle_name as string | null, last: String(r.last_name), dob: d(r.date_of_birth), gender: r.gender as string | null, admittedOn: d(r.admitted_on)!, sessionId: r.admission_session_id as string | null, classId: r.class_id as string | null, status: r.status as StudentStatus, statusReason: r.status_reason as string | null, statusOn: d(r.status_on), emergencyName: r.emergency_name as string | null, emergencyPhone: r.emergency_phone as string | null, notes: r.notes as string | null })
export async function loadStudents(b: string): Promise<SStudent[]> {
  await ready(b)
  if (isDemoMode) return sc.demoStudents(b)
  return must<Row[]>(await db().from('school_students').select('*').eq('business_id', b).order('admission_no')).map((r) => studentRow(r, b))
}
export async function loadEnrollments(b: string, studentId: string): Promise<SEnrollment[]> {
  await ready(b)
  if (isDemoMode) return sc.demoEnrollments(b, studentId)
  return must<Row[]>(await db().from('school_enrollments').select('*').eq('student_id', studentId).order('started_on')).map((r) => ({ id: String(r.id), businessId: b, studentId, classId: String(r.class_id), sessionId: r.session_id as string | null, startedOn: d(r.started_on)!, endedOn: d(r.ended_on), reason: r.reason as string | null }))
}
export async function loadGuardians(b: string): Promise<{ guardians: SGuardian[]; links: SLink[] }> {
  await ready(b)
  if (isDemoMode) return { guardians: sc.demoGuardians(b), links: sc.demoLinks(b) }
  const [g, l] = await Promise.all([db().from('school_guardians').select('*').eq('business_id', b).order('name'), db().from('school_student_guardians').select('*').eq('business_id', b)])
  return {
    guardians: must<Row[]>(g).map((r) => ({ id: String(r.id), businessId: b, name: String(r.name), phone: r.phone as string | null, email: r.email as string | null, address: r.address as string | null, userId: r.user_id as string | null })),
    links: must<Row[]>(l).map((r) => ({ businessId: b, studentId: String(r.student_id), guardianId: String(r.guardian_id), relationship: String(r.relationship), isPrimary: !!r.is_primary })),
  }
}
export async function loadAdmissions(b: string): Promise<SAdmission[]> {
  await ready(b)
  if (isDemoMode) return sc.demoAdmissions(b)
  return must<Row[]>(await db().from('school_admissions').select('*').eq('business_id', b).order('created_at', { ascending: false })).map((r) => ({ id: String(r.id), businessId: b, first: String(r.applicant_first), last: String(r.applicant_last), dob: d(r.date_of_birth), gender: r.gender as string | null, classId: r.applying_class_id as string | null, guardianName: String(r.guardian_name), guardianPhone: r.guardian_phone as string | null, guardianEmail: r.guardian_email as string | null, relationship: String(r.guardian_relationship ?? 'parent'), status: r.status as SAdmission['status'], decidedOn: d(r.decided_on), decisionNote: r.decision_note as string | null, studentId: r.student_id as string | null, createdAt: String(r.created_at) }))
}
export async function loadStaff(b: string): Promise<{ staff: SStaff[]; assignments: SAssignment[] }> {
  await ready(b)
  if (isDemoMode) return { staff: sc.demoStaff(b), assignments: sc.demoAssignments(b) }
  const [s, a] = await Promise.all([db().from('school_staff').select('*').eq('business_id', b).order('staff_no'), db().from('school_assignments').select('*').eq('business_id', b)])
  return {
    staff: must<Row[]>(s).map((r) => ({ id: String(r.id), businessId: b, staffNo: String(r.staff_no), name: String(r.name), phone: r.phone as string | null, email: r.email as string | null, jobTitle: r.job_title as string | null, department: r.department as string | null, status: r.status as SStaff['status'], userId: r.user_id as string | null })),
    assignments: must<Row[]>(a).map((r) => ({ id: String(r.id), businessId: b, staffId: String(r.staff_id), classId: String(r.class_id), subjectId: r.subject_id as string | null, classTeacher: !!r.is_class_teacher })),
  }
}
export async function loadAttendance(b: string, classId?: string): Promise<SAttendance[]> {
  await ready(b)
  if (isDemoMode) return sc.demoAttendance(b, classId)
  let q = db().from('school_attendance').select('*').eq('business_id', b).order('on_date', { ascending: false }).limit(3000)
  if (classId) q = q.eq('class_id', classId)
  return must<Row[]>(await q).map((r) => ({ id: String(r.id), businessId: b, studentId: String(r.student_id), classId: String(r.class_id), on: d(r.on_date)!, status: r.status as AttendanceStatus, note: r.note as string | null, by: r.marked_by as string | null, at: String(r.marked_at) }))
}
export async function loadScores(b: string): Promise<SScore[]> {
  await ready(b)
  if (isDemoMode) return sc.demoScores(b)
  return must<Row[]>(await db().from('school_scores').select('*').eq('business_id', b)).map((r) => ({ id: String(r.id), businessId: b, studentId: String(r.student_id), classId: String(r.class_id), subjectId: String(r.subject_id), termId: String(r.term_id), ca: nn(r.ca), exam: nn(r.exam), remark: r.remark as string | null, status: r.status as SScore['status'], reviewNote: r.review_note as string | null }))
}
export async function loadRemarks(b: string): Promise<SRemark[]> {
  await ready(b)
  if (isDemoMode) return sc.demoRemarks(b)
  return must<Row[]>(await db().from('school_remarks').select('*').eq('business_id', b)).map((r) => ({ id: String(r.id), businessId: b, studentId: String(r.student_id), termId: String(r.term_id), teacherRemark: r.teacher_remark as string | null, principalRemark: r.principal_remark as string | null, promotion: r.promotion as SRemark['promotion'] }))
}
export async function loadFeeItems(b: string): Promise<SFeeItem[]> {
  await ready(b)
  if (isDemoMode) return sc.demoFeeItems(b)
  return must<Row[]>(await db().from('school_fee_items').select('*').eq('business_id', b).order('name')).map((r) => ({ id: String(r.id), businessId: b, name: String(r.name), amount: n(r.amount), classId: r.class_id as string | null, termId: r.term_id as string | null, onAdmission: !!r.on_admission, active: !!r.active }))
}
export async function loadBills(b: string): Promise<BillRow[]> {
  await ready(b)
  if (isDemoMode) return sc.demoBills(b)
  const [bills, items, students, classes] = await Promise.all([db().from('school_bill_summary').select('*').eq('business_id', b).order('bill_number', { ascending: false }), db().from('school_bill_items').select('*').eq('business_id', b), db().from('school_students').select('id, admission_no, first_name, middle_name, last_name, class_id').eq('business_id', b), db().from('school_classes').select('id, name').eq('business_id', b)])
  const st = new Map(must<Row[]>(students).map((r) => [String(r.id), r])); const cl = new Map(must<Row[]>(classes).map((r) => [String(r.id), String(r.name)])); const it = must<Row[]>(items)
  return must<Row[]>(bills).map((r) => {
    const s = st.get(String(r.student_id))
    return { id: String(r.id), businessId: b, number: String(r.bill_number), studentId: String(r.student_id), termId: String(r.term_id), total: n(r.total), discount: n(r.discount), discountReason: r.discount_reason as string | null, dueOn: d(r.due_on), createdAt: String(r.created_at), items: it.filter((x) => x.bill_id === r.id).map((x) => ({ name: String(x.name), amount: n(x.amount) })),
      payable: n(r.payable), paid: n(r.paid), balance: n(r.balance), status: r.status as BillRow['status'], studentName: s ? `${s.first_name} ${s.middle_name ? `${s.middle_name} ` : ''}${s.last_name}` : 'Student', className: s ? cl.get(String(s.class_id)) ?? null : null, admissionNo: s ? String(s.admission_no) : '' }
  })
}
export async function loadPayments(b: string): Promise<(SPayment & { studentName: string; billNumber: string })[]> {
  await ready(b)
  if (isDemoMode) return sc.demoPayments(b)
  const [p, students, bills] = await Promise.all([db().from('school_payments').select('*').eq('business_id', b).order('receipt_number', { ascending: false }), db().from('school_students').select('id, first_name, last_name').eq('business_id', b), db().from('school_bills').select('id, bill_number').eq('business_id', b)])
  const st = new Map(must<Row[]>(students).map((r) => [String(r.id), `${r.first_name} ${r.last_name}`])); const bl = new Map(must<Row[]>(bills).map((r) => [String(r.id), String(r.bill_number)]))
  return must<Row[]>(p).map((r) => ({ id: String(r.id), businessId: b, receipt: String(r.receipt_number), billId: String(r.bill_id), studentId: String(r.student_id), amount: n(r.amount), method: String(r.method), reference: r.reference as string | null, paidOn: d(r.paid_on)!, by: r.recorded_by as string | null, status: r.status as SPayment['status'], reversalReason: r.reversal_reason as string | null, createdAt: String(r.created_at), studentName: st.get(String(r.student_id)) ?? 'Student', billNumber: bl.get(String(r.bill_id)) ?? '' }))
}
export async function loadAnnouncements(b: string): Promise<SAnnouncement[]> {
  await ready(b)
  if (isDemoMode) return sc.demoAnnouncements(b)
  return must<Row[]>(await db().from('school_announcements').select('*').eq('business_id', b).order('publish_on', { ascending: false })).map((r) => ({ id: String(r.id), businessId: b, title: String(r.title), body: String(r.body), audience: r.audience as SAnnouncement['audience'], classId: r.class_id as string | null, publishOn: d(r.publish_on)!, createdAt: String(r.created_at) }))
}
export async function loadOverview(b: string, termId: string | null): Promise<SchoolOverviewData> {
  await ready(b)
  if (isDemoMode) return sc.demoSchoolOverview(b, termId)
  const { data, error } = await db().rpc('school_overview', { p_business: b, p_term: termId })
  if (error) throw new Error(error.message)
  const x = data as Row
  const list = <T,>(v: unknown) => (v ?? null) as T[] | null
  return {
    termId: x.term_id as string | null, term: x.term as string | null, students: n(x.students), staff: n(x.staff), classes: n(x.classes), newAdmissions: n(x.new_admissions), pendingApplications: n(x.pending_applications), markedToday: n(x.marked_today), presentToday: n(x.present_today), absentToday: n(x.absent_today), attendanceRate: nn(x.attendance_rate),
    enrolment: (list<{ class: string; students: number }>(x.enrolment) ?? []).map((e) => ({ class: e.class, students: n(e.students) })), attendanceWeek: (list<{ day: string; marked: number; present: number }>(x.attendance_week) ?? []).map((e) => ({ day: e.day, marked: n(e.marked), present: n(e.present) })), resultsAwaiting: n(x.results_awaiting),
    billed: nn(x.billed), collected: nn(x.collected), outstanding: nn(x.outstanding), recentPayments: list<{ receipt: string; student: string; amount: number; paid_on: string }>(x.recent_payments)?.map((p) => ({ receipt: p.receipt, student: p.student, amount: n(p.amount), paidOn: p.paid_on })) ?? null,
    feesByClass: list<{ class: string; billed: number; collected: number }>(x.fees_by_class)?.map((f) => ({ class: f.class, billed: n(f.billed), collected: n(f.collected) })) ?? null,
  }
}
export async function reportCard(b: string, studentId: string, termId: string): Promise<ReportCard> {
  await ready(b)
  if (isDemoMode) return sc.demoReportCard(b, studentId, termId)
  const { data, error } = await db().rpc('school_report_card', { p_student: studentId, p_term: termId })
  if (error) throw new Error(error.message)
  const x = data as { student: { name: string; admission_no: string; class: string | null }; term: string; session: string | null; subjects: { subject: string; ca: number | null; exam: number | null; total: number; grade: string | null; remark: string | null; status: SScore['status'] }[]; average: number | null; attendance: ReportCard['attendance']; remarks: { teacher_remark: string | null; principal_remark: string | null; promotion: string | null } | null; position: number | null; class_size: number | null }
  return { student: { name: x.student.name, admissionNo: x.student.admission_no, class: x.student.class }, term: x.term, session: x.session, subjects: x.subjects.map((s) => ({ ...s, ca: nn(s.ca), exam: nn(s.exam), total: n(s.total) })), average: nn(x.average), attendance: x.attendance, remarks: x.remarks ? { teacherRemark: x.remarks.teacher_remark, principalRemark: x.remarks.principal_remark, promotion: x.remarks.promotion } : null, position: x.position, classSize: x.class_size }
}
/** A parent keeping their own phone and address up to date. Returns an error message or null. */
export async function updateMyContact(b: string, phone: string, address: string) {
  if (isDemoMode) return sc.demoUpdateMyContact(b, phone, address)
  return msg((await db().rpc('school_update_my_contact', { p_business: b, p_phone: phone, p_address: address })).error)
}
export async function claimLinks(b: string): Promise<void> {
  if (isDemoMode) { sc.demoClaimLinks(b); return }
  await db().rpc('school_claim_links', { p_business: b })
}

// ----------------------------------------------------------------- mutations
const studentJson = (v: StudentInput) => ({ first: v.first, middle: v.middle, last: v.last, dob: v.dob, gender: v.gender, class_id: v.classId, admitted_on: v.admittedOn, emergency_name: v.emergencyName, emergency_phone: v.emergencyPhone, notes: v.notes })
export async function saveSettings(b: string, v: Parameters<typeof sc.demoSaveSettings>[1]) {
  if (isDemoMode) return sc.demoSaveSettings(b, v)
  return msg((await db().rpc('school_save_settings', { p_business: b, p_type: v.schoolType, p_address: v.address, p_phone: v.phone, p_email: v.email, p_ca: v.caMax, p_exam: v.examMax, p_position: v.showPosition, p_days: v.workingDays })).error)
}
export async function saveGrades(b: string, bands: SBand[]) {
  if (isDemoMode) return sc.demoSaveGrades(b, bands)
  return msg((await db().rpc('school_save_grades', { p_business: b, p_bands: bands.map((x) => ({ min: x.min, grade: x.grade, remark: x.remark })) })).error)
}
export async function saveSession(b: string, v: Parameters<typeof sc.demoSaveSession>[1]) {
  if (isDemoMode) return sc.demoSaveSession(b, v)
  return msg((await db().rpc('school_save_session', { p_business: b, p_id: v.id, p_name: v.name, p_starts: v.startsOn, p_ends: v.endsOn, p_current: v.current })).error)
}
export async function saveTerm(b: string, v: Parameters<typeof sc.demoSaveTerm>[1]) {
  if (isDemoMode) return sc.demoSaveTerm(b, v)
  return msg((await db().rpc('school_save_term', { p_business: b, p_id: v.id, p_session: v.sessionId, p_name: v.name, p_starts: v.startsOn, p_ends: v.endsOn, p_current: v.current })).error)
}
export async function saveClass(b: string, v: Parameters<typeof sc.demoSaveClass>[1]) {
  if (isDemoMode) return sc.demoSaveClass(b, v)
  return msg((await db().rpc('school_save_class', { p_business: b, p_id: v.id, p_name: v.name, p_level: v.levelOrder, p_arm: v.arm, p_active: v.active, p_stage: v.stage })).error)
}
export async function saveSubject(b: string, v: Parameters<typeof sc.demoSaveSubject>[1]) {
  if (isDemoMode) return sc.demoSaveSubject(b, v)
  return msg((await db().rpc('school_save_subject', { p_business: b, p_id: v.id, p_name: v.name, p_code: v.code })).error)
}
export async function setClassSubjects(b: string, classId: string, subjectIds: string[]) {
  if (isDemoMode) return sc.demoSetClassSubjects(b, classId, subjectIds)
  return msg((await db().rpc('school_set_class_subjects', { p_business: b, p_class: classId, p_subjects: subjectIds })).error)
}
export async function saveHoliday(b: string, on: string, name: string, remove = false) {
  if (isDemoMode) return sc.demoSaveHoliday(b, on, name, remove)
  return msg((await db().rpc('school_save_holiday', { p_business: b, p_date: on, p_name: name, p_remove: remove })).error)
}
export async function setupSchool(b: string, type: SSettings['schoolType'], session: string, start: string) {
  if (isDemoMode) return sc.demoSchoolSetup(b, type, session, start)
  return msg((await db().rpc('school_setup', { p_business: b, p_type: type, p_session: session, p_starts: start })).error)
}
export async function registerStudent(b: string, v: StudentInput, guardians: GuardianInput[], key: string) {
  if (isDemoMode) return sc.demoRegisterStudent(b, v, guardians, key).error
  return msg((await db().rpc('school_register_student', { p_business: b, v: studentJson(v), p_guardians: guardians.map((g) => ({ name: g.name, phone: g.phone, email: g.email, relationship: g.relationship, primary: g.primary })), p_key: key })).error)
}
export async function updateStudent(b: string, id: string, v: StudentInput) {
  if (isDemoMode) return sc.demoUpdateStudent(b, id, v)
  return msg((await db().rpc('school_update_student', { p_student: id, v: studentJson(v) })).error)
}
export async function setStudentStatus(b: string, id: string, status: StudentStatus, reason: string) {
  if (isDemoMode) return sc.demoSetStudentStatus(b, id, status, reason)
  return msg((await db().rpc('school_set_student_status', { p_student: id, p_status: status, p_reason: reason })).error)
}
export async function promote(b: string, moves: { studentId: string; classId: string }[], reason: string) {
  if (isDemoMode) return sc.demoPromote(b, moves, reason).error
  return msg((await db().rpc('school_promote', { p_business: b, p_moves: moves.map((m) => ({ student_id: m.studentId, class_id: m.classId })), p_reason: reason })).error)
}
export async function apply(b: string, v: ApplicationInput, key: string) {
  if (isDemoMode) return sc.demoApply(b, v, key).error
  return msg((await db().rpc('school_apply', { p_business: b, v: { first: v.first, last: v.last, dob: v.dob, gender: v.gender, class_id: v.classId, guardian_name: v.guardianName, guardian_phone: v.guardianPhone, guardian_email: v.guardianEmail, relationship: v.relationship }, p_key: key })).error)
}
export async function decideAdmission(b: string, id: string, decision: 'accept' | 'reject', classId: string | null, note: string) {
  if (isDemoMode) return sc.demoDecideAdmission(b, id, decision, classId, note).error
  return msg((await db().rpc('school_decide_admission', { p_admission: id, p_decision: decision, p_class: classId, p_note: note })).error)
}
export async function saveGuardian(b: string, v: Parameters<typeof sc.demoSaveGuardian>[1]) {
  if (isDemoMode) return sc.demoSaveGuardian(b, v)
  return msg((await db().rpc('school_save_guardian', { p_business: b, p_id: v.id, p_name: v.name, p_phone: v.phone, p_email: v.email, p_address: v.address })).error)
}
export async function linkGuardian(b: string, studentId: string, guardianId: string, relationship: string, primary: boolean, unlink = false) {
  if (isDemoMode) return sc.demoLinkGuardian(b, studentId, guardianId, relationship, primary, unlink)
  return msg((await db().rpc('school_link_guardian', { p_business: b, p_student: studentId, p_guardian: guardianId, p_relationship: relationship, p_primary: primary, p_unlink: unlink })).error)
}
export async function saveStaff(b: string, v: Parameters<typeof sc.demoSaveStaff>[1]) {
  if (isDemoMode) return sc.demoSaveStaff(b, v)
  return msg((await db().rpc('school_save_staff', { p_business: b, p_id: v.id, p_name: v.name, p_phone: v.phone, p_email: v.email, p_title: v.jobTitle, p_department: v.department, p_active: v.active })).error)
}
export async function setAssignments(b: string, staffId: string, items: { classId: string; subjectId: string | null; classTeacher: boolean }[]) {
  if (isDemoMode) return sc.demoSetAssignments(b, staffId, items)
  return msg((await db().rpc('school_set_assignments', { p_business: b, p_staff: staffId, p_items: items.map((i) => ({ class_id: i.classId, subject_id: i.subjectId, class_teacher: i.classTeacher })) })).error)
}
export async function markAttendance(b: string, classId: string, on: string, rows: { studentId: string; status: AttendanceStatus; note?: string }[]) {
  if (isDemoMode) return sc.demoMarkAttendance(b, classId, on, rows).error
  return msg((await db().rpc('school_mark_attendance', { p_business: b, p_class: classId, p_date: on, p_rows: rows.map((r) => ({ student_id: r.studentId, status: r.status, note: r.note ?? null })) })).error)
}
export async function saveScores(b: string, classId: string, subjectId: string, termId: string, rows: { studentId: string; ca: number | null; exam: number | null; remark?: string }[], submit: boolean) {
  if (isDemoMode) return sc.demoSaveScores(b, classId, subjectId, termId, rows, submit).error
  return msg((await db().rpc('school_save_scores', { p_business: b, p_class: classId, p_subject: subjectId, p_term: termId, p_rows: rows.map((r) => ({ student_id: r.studentId, ca: r.ca, exam: r.exam, remark: r.remark ?? null })), p_submit: submit })).error)
}
export async function reviewScores(b: string, classId: string, subjectId: string, termId: string, action: 'approve' | 'publish' | 'reject' | 'unpublish', note: string) {
  if (isDemoMode) return sc.demoReviewScores(b, classId, subjectId, termId, action, note).error
  return msg((await db().rpc('school_review_scores', { p_business: b, p_class: classId, p_subject: subjectId, p_term: termId, p_action: action, p_note: note })).error)
}
export async function saveRemarks(b: string, studentId: string, termId: string, teacher: string, principal: string, promotion: SRemark['promotion']) {
  if (isDemoMode) return sc.demoSaveRemarks(b, studentId, termId, teacher, principal, promotion)
  return msg((await db().rpc('school_save_remarks', { p_business: b, p_student: studentId, p_term: termId, p_teacher: teacher, p_principal: principal, p_promotion: promotion })).error)
}
export async function saveFeeItem(b: string, v: Parameters<typeof sc.demoSaveFeeItem>[1]) {
  if (isDemoMode) return sc.demoSaveFeeItem(b, v)
  return msg((await db().rpc('school_save_fee_item', { p_business: b, p_id: v.id, p_name: v.name, p_amount: v.amount, p_class: v.classId, p_term: v.termId, p_admission: v.onAdmission, p_active: v.active })).error)
}
export async function generateBills(b: string, termId: string, classId: string | null, dueOn: string | null, key: string): Promise<{ error: string | null; created?: number; skipped?: number }> {
  if (isDemoMode) { const r = sc.demoGenerateBills(b, termId, classId, dueOn, key); return { error: r.error, ...r.result } }
  const { data, error } = await db().rpc('school_generate_bills', { p_business: b, p_term: termId, p_class: classId, p_due: dueOn, p_key: key })
  return { error: error?.message ?? null, created: n((data as Row | null)?.created), skipped: n((data as Row | null)?.skipped) }
}
export async function adjustBill(b: string, billId: string, v: { discount: number | null; reason: string; chargeName: string; chargeAmount: number | null }) {
  if (isDemoMode) return sc.demoAdjustBill(b, billId, v)
  return msg((await db().rpc('school_adjust_bill', { p_bill: billId, p_discount: v.discount, p_reason: v.reason, p_charge_name: v.chargeName, p_charge_amount: v.chargeAmount })).error)
}
export async function recordPayment(b: string, billId: string, amount: number, method: string, reference: string, key: string) {
  if (isDemoMode) return sc.demoRecordPayment(b, billId, amount, method, reference, key).error
  return msg((await db().rpc('school_record_payment', { p_bill: billId, p_amount: amount, p_method: method, p_reference: reference, p_key: key })).error)
}
export async function reversePayment(b: string, paymentId: string, reason: string) {
  if (isDemoMode) return sc.demoReversePayment(b, paymentId, reason)
  return msg((await db().rpc('school_reverse_payment', { p_payment: paymentId, p_reason: reason })).error)
}
export async function publishAnnouncement(b: string, v: Parameters<typeof sc.demoPublishAnnouncement>[1]) {
  if (isDemoMode) return sc.demoPublishAnnouncement(b, v)
  return msg((await db().rpc('school_publish_announcement', { p_business: b, p_title: v.title, p_body: v.body, p_audience: v.audience, p_class: v.classId, p_date: v.publishOn })).error)
}

// ------------------------------------------------------------------ timetable
export async function loadTimetable(b: string): Promise<{ periods: SPeriod[]; slots: SSlot[] }> {
  await ready(b)
  if (isDemoMode) return sc.demoTimetable(b)
  const [p, t] = await Promise.all([db().from('school_periods').select('*').eq('business_id', b).order('position'), db().from('school_timetable').select('*').eq('business_id', b)])
  const time = (v: unknown) => String(v).slice(0, 5)
  return {
    periods: must<Row[]>(p).map((r) => ({ id: String(r.id), businessId: b, label: String(r.label), startsAt: time(r.starts_at), endsAt: time(r.ends_at), isBreak: !!r.is_break, position: n(r.position) })),
    slots: must<Row[]>(t).map((r) => ({ id: String(r.id), businessId: b, classId: String(r.class_id), day: n(r.day), periodId: String(r.period_id), subjectId: String(r.subject_id), staffId: r.staff_id as string | null, room: r.room as string | null })),
  }
}
export async function savePeriods(b: string, list: { id?: string | null; label: string; starts: string; ends: string; isBreak: boolean }[]) {
  if (isDemoMode) return sc.demoSavePeriods(b, list)
  return msg((await db().rpc('school_save_periods', { p_business: b, p_periods: list.map((p) => ({ id: p.id ?? null, label: p.label, starts: p.starts, ends: p.ends, is_break: p.isBreak })) })).error)
}
export async function setSlot(b: string, classId: string, day: number, periodId: string, subjectId: string | null, staffId: string | null, room: string) {
  if (isDemoMode) return sc.demoSetSlot(b, classId, day, periodId, subjectId, staffId, room)
  return msg((await db().rpc('school_set_slot', { p_business: b, p_class: classId, p_day: day, p_period: periodId, p_subject: subjectId, p_staff: staffId, p_room: room })).error)
}
