import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, EmptyState, ErrorState, SelectField, Spinner } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { naira } from '@/shared/utilities/format'
import { loadAnnouncements, loadOverview } from '../services/schoolApi'
import { Stat, useSchool } from './schoolUi'

function Bars({ rows, format }: { rows: { name: string; value: number; of?: number }[]; format: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.of ?? r.value), 0)
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[7rem_1fr_6rem] items-center gap-3">
          <span className="truncate">{r.name}</span>
          <span className="h-2 rounded-full bg-canvas"><span className="block h-2 rounded-full bg-amber" style={{ width: `${max ? Math.max((r.value / max) * 100, 2) : 0}%` }} /></span>
          <span className="tabular text-right">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  )
}

/** The school dashboard: every figure comes from the records for the chosen term. Money shows only to people who may read fees. */
export function SchoolOverview() {
  const { can } = useSchool()
  if (!(can('school.read') || can('school.manage'))) return <Shortcuts />
  return <Figures />
}

/** Teachers and parents have no school-wide figures; they get a way into the pages they can use. */
function Shortcuts() {
  const { can } = useSchool()
  const links = [['school.attendance', '/app/school/attendance', 'Take attendance'], ['school.results.enter', '/app/school/results', 'Enter results'], ['school.portal', '/app/school/portal', 'Open the parent portal']] as const
  return <Card><h3 className="mb-2 text-sm font-semibold">Your school</h3><ul className="space-y-1 text-sm">{links.filter(([p]) => can(p)).map(([, to, text]) => <li key={to}><Link className="font-semibold underline" to={to}>{text}</Link></li>)}<li><Link className="font-semibold underline" to="/app/school/announcements">Announcements</Link></li></ul></Card>
}

function Figures() {
  const { businessId, s } = useSchool()
  const [term, setTerm] = useState('')
  const data = useAsync(() => loadOverview(businessId, term || null), [businessId, term])
  const notes = useAsync(() => loadAnnouncements(businessId).catch(() => []), [businessId])
  const o = data.data
  if (!businessId) return null
  return (
    <div className="space-y-4">
      {s && s.terms.length > 0 && <div className="max-w-xs"><SelectField label="Term" value={term} onChange={(e) => setTerm(e.target.value)}><option value="">Current term</option>{s.terms.map((t) => <option key={t.id} value={t.id}>{t.name} ({s.sessions.find((x) => x.id === t.sessionId)?.name})</option>)}</SelectField></div>}
      {data.error && <ErrorState message={data.error} />}
      {data.loading && !o ? <Spinner /> : !o ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat title="Active students" value={String(o.students)} note={`${o.newAdmissions} new this term`} />
            <Stat title="Teachers and staff" value={String(o.staff)} />
            <Stat title="Classes" value={String(o.classes)} />
            <Stat title="Applications waiting" value={String(o.pendingApplications)} tone={o.pendingApplications ? 'warn' : undefined} />
            <Stat title="Attendance today" value={o.attendanceRate === null ? 'Not taken' : `${o.attendanceRate}%`} note={o.markedToday ? `${o.markedToday} marked` : undefined} />
            <Stat title="Absent today" value={String(o.absentToday)} tone={o.absentToday ? 'warn' : undefined} />
            <Stat title="Results awaiting approval" value={String(o.resultsAwaiting)} tone={o.resultsAwaiting ? 'warn' : undefined} />
            {o.billed !== null && <Stat title="Fees billed" value={naira(o.billed)} note={o.term ?? undefined} />}
            {o.collected !== null && <Stat title="Fees collected" value={naira(o.collected)} tone="good" />}
            {o.outstanding !== null && <Stat title="Outstanding fees" value={naira(o.outstanding)} tone={o.outstanding ? 'warn' : undefined} />}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card><h3 className="mb-3 text-sm font-semibold">Students by class</h3>{o.enrolment.some((e) => e.students) ? <Bars rows={o.enrolment.filter((e) => e.students).map((e) => ({ name: e.class, value: e.students }))} format={String} /> : <p className="text-sm text-ink/60">No students yet.</p>}</Card>
            <Card><h3 className="mb-3 text-sm font-semibold">Attendance this week</h3>{o.attendanceWeek.some((w) => w.marked) ? <Bars rows={o.attendanceWeek.map((w) => ({ name: w.day.slice(5), value: w.present, of: w.marked }))} format={String} /> : <p className="text-sm text-ink/60">No attendance taken in the last week.</p>}</Card>
            {o.feesByClass && <Card><h3 className="mb-3 text-sm font-semibold">Fees collected by class</h3>{o.feesByClass.length ? <Bars rows={o.feesByClass.map((f) => ({ name: f.class, value: f.collected, of: f.billed }))} format={naira} /> : <p className="text-sm text-ink/60">No bills for this term.</p>}</Card>}
            {o.recentPayments && <Card><h3 className="mb-3 text-sm font-semibold">Recent payments</h3>{o.recentPayments.length ? <ul className="divide-y divide-ink/10 text-sm">{o.recentPayments.map((p) => <li key={p.receipt} className="flex justify-between py-1.5"><span>{p.student} <span className="text-ink/60">{p.receipt}</span></span><b className="tabular">{naira(p.amount)}</b></li>)}</ul> : <p className="text-sm text-ink/60">No payments yet.</p>}</Card>}
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Announcements</h3>
              {notes.data?.length ? <ul className="divide-y divide-ink/10 text-sm">{notes.data.slice(0, 4).map((a) => <li key={a.id} className="py-1.5"><b>{a.title}</b><div className="text-xs text-ink/60">{a.publishOn}</div></li>)}</ul> : <EmptyState title="No announcements" />}
              <Link className="mt-2 inline-block text-sm font-semibold underline" to="/app/school/announcements">All announcements</Link>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
