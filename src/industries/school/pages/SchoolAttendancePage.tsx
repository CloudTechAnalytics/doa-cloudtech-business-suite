import { useEffect, useState } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label } from '@/shared/utilities/format'
import { NoSetup, fullName, today, useSchool } from '../components/schoolUi'
import { loadAttendance, loadStudents, markAttendance } from '../services/schoolApi'
import type { AttendanceStatus } from '../services/schoolApi'

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused']
const TONE = { present: 'success', absent: 'danger', late: 'warning', excused: 'neutral' } as const

/** Daily register: pick a class and a date, mark each pupil, save once. Teachers only see the classes they are assigned to. */
export function SchoolAttendancePage() {
  const { businessId, s, can, classes, className, active } = useSchool()
  const students = useAsync(() => loadStudents(businessId), [businessId])
  const [cls, setCls] = useState(''); const [date, setDate] = useState(today())
  const existing = useAsync(() => (cls ? loadAttendance(businessId, cls) : Promise.resolve([])), [businessId, cls])
  const [marks, setMarks] = useState<Record<string, { status: AttendanceStatus; note: string }>>({})
  const runner = useFormRunner(async () => { await existing.refresh() })
  const roster = (students.data ?? []).filter((x) => x.status === 'active' && x.classId === cls)
  const canMark = can('school.attendance')

  // teachers can only see their own pupils, so start on a class that has some
  useEffect(() => { if (!cls && classes.length && students.data) setCls((classes.find((c) => students.data!.some((x) => x.classId === c.id && x.status === 'active')) ?? classes[0]).id) }, [classes, cls, students.data])
  useEffect(() => {
    const day = (existing.data ?? []).filter((a) => a.on === date)
    setMarks(Object.fromEntries(roster.map((x) => { const a = day.find((y) => y.studentId === x.id); return [x.id, { status: a?.status ?? 'present', note: a?.note ?? '' }] })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data, date, cls, students.data])

  if (!active) return null
  const marked = (existing.data ?? []).filter((a) => a.on === date).length
  const days = [...new Set((existing.data ?? []).map((a) => a.on))].sort().reverse().slice(0, 14)
  const set = (id: string, patch: Partial<{ status: AttendanceStatus; note: string }>) => setMarks((m) => ({ ...m, [id]: { ...m[id], ...patch } }))

  return (
    <>
      <PageHeader title="Attendance" description="Take the daily register for a class. You can correct a day by saving it again; every change is kept in the audit trail." />
      {s && !s.classes.length && <NoSetup />}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-52"><SelectField label="Class" value={cls} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></div>
        <div className="w-44"><TextField label="Date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></div>
        {canMark && <Button variant="secondary" onClick={() => setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, status: 'present' as const }])))}>Mark everyone present</Button>}
      </div>
      {(students.error || existing.error) && <ErrorState message={(students.error ?? existing.error)!} />}
      {students.loading ? <Spinner /> : !cls ? null : !roster.length ? <Card><EmptyState title="No students in this class" description="Register students first, or choose another class." /></Card> : (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line p-3 text-sm"><b>{className(cls)}</b><span className="text-ink/70">{marked ? <Badge tone="success">Taken: {marked} marked</Badge> : <Badge tone="warning">Not taken for {date}</Badge>}</span></div>
          <ul className="divide-y divide-ink/10">
            {roster.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="min-w-48 flex-1 font-medium">{fullName(x)} <span className="text-xs font-normal text-ink/60">{x.admissionNo}</span></span>
                <div role="group" aria-label={`Status for ${fullName(x)}`} className="flex gap-1">
                  {STATUSES.map((st) => <button key={st} type="button" disabled={!canMark} aria-pressed={marks[x.id]?.status === st} onClick={() => set(x.id, { status: st })} className={`rounded-md border px-2.5 py-1 text-xs font-medium ${marks[x.id]?.status === st ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-surface'}`}>{label(st)}</button>)}
                </div>
                <input aria-label={`Note for ${fullName(x)}`} disabled={!canMark} placeholder="Note" value={marks[x.id]?.note ?? ''} onChange={(e) => set(x.id, { note: e.target.value })} className="w-40 rounded-md border border-line px-2 py-1 text-xs" />
              </li>
            ))}
          </ul>
          <div className="space-y-2 border-t border-line p-3">
            {runner.error && <ErrorState title="Not saved" message={runner.error} />}
            {runner.ok && <Notice>{runner.ok}</Notice>}
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink/70">{STATUSES.map((st) => `${label(st)} ${Object.values(marks).filter((m) => m.status === st).length}`).join(' · ')}</span>
              {canMark && <Button loading={runner.busy} onClick={() => void runner.run(async () => markAttendance(businessId, cls, date, roster.map((x) => ({ studentId: x.id, status: marks[x.id]?.status ?? 'present', note: marks[x.id]?.note }))), 'Attendance saved.')}>Save attendance</Button>}
            </div>
          </div>
        </Card>
      )}
      {days.length > 0 && (
        <Card className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">Recent days for {className(cls)}</h3>
          <ul className="divide-y divide-ink/10 text-sm">
            {days.map((dy) => { const rows = (existing.data ?? []).filter((a) => a.on === dy); return <li key={dy} className="flex flex-wrap items-center gap-2 py-1.5"><button className="font-medium underline" onClick={() => setDate(dy)}>{dy}</button>{STATUSES.map((st) => { const c = rows.filter((a) => a.status === st).length; return c ? <Badge key={st} tone={TONE[st]}>{label(st)} {c}</Badge> : null })}</li> })}
          </ul>
        </Card>
      )}
    </>
  )
}
