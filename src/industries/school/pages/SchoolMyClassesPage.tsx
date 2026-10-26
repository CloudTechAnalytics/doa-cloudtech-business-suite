import clsx from 'clsx'
import { CalendarCheck, ClipboardList, Printer } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/core/auth/AuthProvider'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { label } from '@/shared/utilities/format'
import { NoSetup, WEEKDAYS, fullName, today, useSchool } from '../components/schoolUi'
import { TimetableGrid } from '../components/TimetableGrid'
import { loadAttendance, loadGuardians, loadScores, loadStaff, loadStudents, loadTimetable } from '../services/schoolApi'
import type { SAttendance, SScore, SStudent } from '../services/schoolApi'

const MARK_TONE = { present: 'success', absent: 'danger', late: 'warning', excused: 'neutral' } as const
const SCORE_TONE = { draft: 'neutral', submitted: 'warning', approved: 'info', published: 'success' } as const

/** A teacher's own page: the classes and subjects they are responsible for, and what needs doing in each (today's register, results to enter). */
export function SchoolMyClassesPage() {
  const ctx = useSchool()
  const { businessId, s, currentTerm, className, subjectName, active } = ctx
  const { userId } = useAuth()
  const staff = useAsync(() => loadStaff(businessId), [businessId])
  const students = useAsync(() => loadStudents(businessId), [businessId])
  const attendance = useAsync(() => loadAttendance(businessId), [businessId])
  const scores = useAsync(() => loadScores(businessId), [businessId])
  const week = useAsync(() => loadTimetable(businessId).catch(() => ({ periods: [], slots: [] })), [businessId])
  const [openId, setOpenId] = useState<string | null>(null)
  const [termId, setTermId] = useState('')
  if (!active) return null

  const me = (staff.data?.staff ?? []).find((x) => x.userId === userId)
  const mine = (staff.data?.assignments ?? []).filter((a) => me && a.staffId === me.id)
  const classIds = [...new Set(mine.map((a) => a.classId))]
  const term = termId || currentTerm?.id || ''
  const loading = staff.loading || students.loading
  const error = staff.error ?? students.error ?? attendance.error ?? scores.error

  const infoFor = (classId: string) => {
    const pupils = (students.data ?? []).filter((x) => x.classId === classId && x.status === 'active')
    const todays = (attendance.data ?? []).filter((a) => a.classId === classId && a.on === today())
    const subjects = mine.filter((a) => a.classId === classId && a.subjectId).map((a) => a.subjectId!)
    const mineScores = (scores.data ?? []).filter((r) => r.classId === classId && r.termId === term && subjects.includes(r.subjectId))
    return { pupils, todays, subjects, mineScores, classTeacher: mine.some((a) => a.classId === classId && a.classTeacher) }
  }
  const open = openId ? { id: openId, ...infoFor(openId) } : null

  return (
    <>
      <PageHeader title={ctx.classWord === 'Course' ? 'My Courses' : 'My Classes'} description={me ? `Hello ${me.name}. These are your classes and subjects, and what needs doing in each.` : 'The classes and subjects you are responsible for.'} />
      {error && <ErrorState message={error} />}
      {s && !s.classes.length && <NoSetup />}
      {loading ? <Spinner /> : !classIds.length ? (
        <Card><EmptyState title={ctx.classWord === 'Course' ? 'No courses assigned to you yet' : 'No classes assigned to you yet'} description={me ? 'Ask the principal to assign you to a class or subject under Teachers & Staff.' : 'Your login is not matched to a staff record yet. Ask the principal to add you under Teachers & Staff using the same email you sign in with.'} /></Card>
      ) : (
        <>
          <div className="mb-3 max-w-xs"><SelectField label="Term" value={term} onChange={(e) => setTermId(e.target.value)}>{(s?.terms ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField></div>
          {me && week.data && week.data.periods.length > 0 && week.data.slots.some((x) => x.staffId === me.id) && (
            <Card className="mb-4 p-0">
              <h2 className="border-b border-line p-3 font-semibold">My week</h2>
              <TimetableGrid periods={week.data.periods} days={WEEKDAYS.filter(([n]) => (s?.settings?.workingDays ?? [1, 2, 3, 4, 5]).includes(n))} cell={(day, p) => { const x = week.data!.slots.find((y) => y.day === day && y.periodId === p.id && y.staffId === me.id); return x ? <div className="rounded-md bg-accent-soft px-2 py-1.5"><b className="block">{className(x.classId)}</b><span className="text-xs text-ink/70">{subjectName(x.subjectId)}</span></div> : <span className="text-ink/30">Free</span> }} />
            </Card>
          )}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {classIds.map((id) => {
              const i = infoFor(id); const taken = i.todays.length
              const counts = (['draft', 'submitted', 'approved', 'published'] as const).map((st) => [st, i.mineScores.filter((r) => r.status === st).length] as const).filter(([, c]) => c > 0)
              return (
                <li key={id}>
                  <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-raised">
                    <button type="button" onClick={() => setOpenId(id)} className="block w-full text-left" aria-label={`Open ${className(id)}`}>
                      <div className="flex items-start justify-between gap-2"><h2 className="text-lg font-bold">{className(id)}</h2>{i.classTeacher && <Badge tone="info">Class teacher</Badge>}</div>
                      <p className="mt-1 text-sm text-ink/70">{i.pupils.length} pupil{i.pupils.length === 1 ? '' : 's'}{i.subjects.length > 0 && <> · {i.subjects.map(subjectName).join(', ')}</>}</p>
                      <div className="mt-3 space-y-1.5 text-sm">
                        <p className="flex items-center gap-2"><CalendarCheck className="size-4 text-ink/50" aria-hidden />Today&apos;s register: {taken ? <Badge tone="success">Taken ({taken} marked)</Badge> : <Badge tone="warning">Not taken yet</Badge>}</p>
                        {i.subjects.length > 0 && <p className="flex flex-wrap items-center gap-2"><ClipboardList className="size-4 text-ink/50" aria-hidden />Results: {counts.length ? counts.map(([st, c]) => <Badge key={st} tone={SCORE_TONE[st]}>{c} {label(st)}</Badge>) : <Badge>Not started</Badge>}</p>}
                      </div>
                    </button>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link to="/app/school/attendance" className="inline-flex h-9 items-center rounded-md bg-amber px-3 text-sm font-bold text-ink hover:bg-amber-dark">Take attendance</Link>
                      {i.subjects.length > 0 && <Link to="/app/school/results" className="inline-flex h-9 items-center rounded-md border border-line px-3 text-sm font-semibold hover:bg-surface">Enter results</Link>}
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {open && <ClassPage classId={open.id} info={open} term={term} attendance={attendance.data ?? []} scores={scores.data ?? []} onClose={() => setOpenId(null)} />}
    </>
  )
}

function ClassPage({ classId, info, term, attendance, scores, onClose }: { classId: string; info: { pupils: SStudent[]; todays: SAttendance[]; subjects: string[]; mineScores: SScore[] }; term: string; attendance: SAttendance[]; scores: SScore[]; onClose: () => void }) {
  const { businessId, className, subjectName, s } = useSchool()
  const [tab, setTab] = useState<'pupils' | 'results'>('pupils')
  const links = useAsync(() => loadGuardians(businessId).catch(() => ({ guardians: [], links: [] })), [businessId])
  const termInfo = s?.terms.find((t) => t.id === term)
  const guardianOf = (studentId: string) => {
    const l = (links.data?.links ?? []).filter((x) => x.studentId === studentId).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0]
    const g = l ? links.data?.guardians.find((x) => x.id === l.guardianId) : undefined
    return g ? { name: g.name, phone: g.phone, relationship: l!.relationship } : null
  }
  const rate = (id: string) => {
    const rows = attendance.filter((a) => a.studentId === id && (!termInfo || (a.on >= termInfo.startsOn && a.on <= termInfo.endsOn)))
    return rows.length ? Math.round((rows.filter((a) => a.status === 'present' || a.status === 'late').length * 1000) / rows.length) / 10 : null
  }
  return (
    <DetailPage title={className(classId)} onClose={onClose} wide actions={<Button variant="secondary" className="no-print" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print class list</Button>}>
      <div role="tablist" aria-label="Class sections" className="no-print mb-4 flex gap-1 border-b border-ink/10">
        {([['pupils', 'Pupils'], ['results', 'My results']] as const).map(([id, t]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === id ? 'border-amber text-ink' : 'border-transparent text-ink/60 hover:text-ink')}>{t}</button>)}
      </div>
      {tab === 'pupils' && (info.pupils.length ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-semibold text-ink/70"><tr><th className="py-2">Pupil</th><th className="py-2">Today</th><th className="py-2 text-right">Attendance this term</th><th className="py-2 pl-4">Parent or guardian</th></tr></thead>
          <tbody className="divide-y divide-ink/10">{info.pupils.map((p) => { const mark = info.todays.find((a) => a.studentId === p.id); const g = guardianOf(p.id); const r = rate(p.id)
            return <tr key={p.id}><td className="py-2 font-medium">{fullName(p)}<div className="text-xs font-normal text-ink/60">{p.admissionNo}{p.gender ? ` · ${label(p.gender)}` : ''}</div></td>
              <td className="py-2">{mark ? <Badge tone={MARK_TONE[mark.status]}>{label(mark.status)}</Badge> : <span className="text-ink/50">Not marked</span>}</td>
              <td className="tabular py-2 text-right">{r === null ? '–' : <span className={r < 75 ? 'font-semibold text-warning' : ''}>{r}%</span>}</td>
              <td className="py-2 pl-4">{g ? <>{g.name} <span className="text-xs text-ink/60">({g.relationship})</span>{g.phone && <div className="text-xs"><a href={`tel:${g.phone}`} className="underline">{g.phone}</a></div>}</> : <span className="text-ink/50">None recorded</span>}</td></tr> })}</tbody>
        </table>
      ) : <p className="text-sm text-ink/60">No pupils in this class.</p>)}
      {tab === 'results' && (info.subjects.length ? (
        <ul className="divide-y divide-ink/10 text-sm">{info.subjects.map((sub) => { const rows = scores.filter((r) => r.classId === classId && r.subjectId === sub && r.termId === term); const status = rows.length ? (['draft', 'submitted', 'approved', 'published'] as const).find((st) => rows.some((r) => r.status === st)) : null
          return <li key={sub} className="flex flex-wrap items-center justify-between gap-2 py-3"><span className="font-medium">{subjectName(sub)} <span className="font-normal text-ink/60">· {rows.length} of {info.pupils.length} scored</span></span><span className="flex items-center gap-3">{status ? <Badge tone={SCORE_TONE[status]}>{label(status)}</Badge> : <Badge>Not started</Badge>}<Link to="/app/school/results" className="text-sm font-semibold underline">Open</Link></span></li> })}</ul>
      ) : <p className="text-sm text-ink/60">You are the class teacher for this class but are not assigned a subject in it.</p>)}
    </DetailPage>
  )
}
