import { Clock, Plus, Printer, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { NoSetup, WEEKDAYS, useSchool } from '../components/schoolUi'
import { TimetableGrid } from '../components/TimetableGrid'
import { loadStaff, loadTimetable, savePeriods, setSlot } from '../services/schoolApi'
import type { SPeriod } from '../services/schoolApi'

/** The weekly timetable of each class. Pick a class, then choose the subject (and teacher) for each period of each school day; every choice is saved as you make it. */
export function SchoolTimetablePage() {
  const ctx = useSchool()
  const { businessId, s, classes, className, subjectName, active, can } = ctx
  const data = useAsync(() => loadTimetable(businessId), [businessId])
  const staff = useAsync(() => loadStaff(businessId).catch(() => ({ staff: [], assignments: [] })), [businessId])
  const [cls, setCls] = useState('')
  const [editing, setEditing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (!cls && classes.length) setCls(classes[0].id) }, [classes, cls])
  if (!active) return null
  const manage = can('school.manage')
  const days = WEEKDAYS.filter(([n]) => (s?.settings?.workingDays ?? [1, 2, 3, 4, 5]).includes(n))
  const periods = data.data?.periods ?? []
  const slots = (data.data?.slots ?? []).filter((x) => x.classId === cls)
  const subjectIds = (s?.classSubjects ?? []).filter((x) => x.classId === cls).map((x) => x.subjectId)
  const teachersFor = (subjectId: string) => (staff.data?.assignments ?? []).filter((a) => a.classId === cls && a.subjectId === subjectId).map((a) => staff.data!.staff.find((x) => x.id === a.staffId && x.status === 'active')).filter((x): x is NonNullable<typeof x> => !!x)
  const staffName = (id: string | null) => staff.data?.staff.find((x) => x.id === id)?.name

  async function change(day: number, period: SPeriod, subject: string | null, teacher: string | null) {
    setProblem(null)
    const err = await setSlot(businessId, cls, day, period.id, subject, teacher, '')
    if (err) setProblem(err)
    await data.refresh()
  }

  return (
    <>
      <PageHeader title="Timetable" description="The school day and the weekly timetable of each class. A teacher can only be in one class at a time, and only teaches subjects they are assigned to." actions={<div className="flex gap-2 no-print"><Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print</Button>{manage && <Button variant="secondary" onClick={() => setEditing(true)}><Clock className="size-4" aria-hidden /> School day</Button>}</div>} />
      {s && !s.classes.length && <NoSetup />}
      {(data.error || staff.error) && <ErrorState message={(data.error ?? staff.error)!} />}
      {problem && <div className="mb-3"><ErrorState title="Not saved" message={problem} /></div>}
      <div className="no-print mb-3 w-56"><SelectField label={ctx.classWord} value={cls} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></div>
      {data.loading && !data.data ? <Spinner /> : !periods.length ? (
        <Card><EmptyState title="The school day is not set up yet" description={manage ? 'Add the periods and breaks of the school day first.' : 'Ask the school office to set up the periods.'} action={manage ? <Button onClick={() => setEditing(true)}>Set up the school day</Button> : undefined} /></Card>
      ) : !cls ? null : (
        <Card className="p-0">
          <h2 className="border-b border-line p-3 font-semibold">{className(cls)}</h2>
          <TimetableGrid periods={periods} days={days} cell={(day, p) => {
            const slot = slots.find((x) => x.day === day && x.periodId === p.id)
            if (!manage) return slot ? <div className="rounded-md bg-accent-soft px-2 py-1.5"><b className="block">{subjectName(slot.subjectId)}</b><span className="text-xs text-ink/70">{staffName(slot.staffId) ?? 'No teacher set'}</span></div> : <span className="text-ink/30">–</span>
            return (
              <div className="space-y-1">
                <select aria-label={`${p.label} on ${days.find(([n]) => n === day)?.[1]}: subject`} value={slot?.subjectId ?? ''} onChange={(e) => void change(day, p, e.target.value || null, null)} className="h-8 w-full rounded-md border border-line bg-white px-1.5 text-xs">
                  <option value="">Free</option>{subjectIds.map((id) => <option key={id} value={id}>{subjectName(id)}</option>)}
                </select>
                {slot && <select aria-label={`${p.label} on ${days.find(([n]) => n === day)?.[1]}: teacher`} value={slot.staffId ?? ''} onChange={(e) => void change(day, p, slot.subjectId, e.target.value || null)} className="h-8 w-full rounded-md border border-line bg-surface px-1.5 text-xs">
                  <option value="">No teacher set</option>{teachersFor(slot.subjectId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>}
              </div>
            )
          }} />
        </Card>
      )}
      {editing && <PeriodsDialog periods={periods} businessId={businessId} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await data.refresh() }} />}
    </>
  )
}

type Row = { id?: string; label: string; starts: string; ends: string; isBreak: boolean }
function PeriodsDialog({ periods, businessId, onClose, onSaved }: { periods: SPeriod[]; businessId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [rows, setRows] = useState<Row[]>(periods.length ? periods.map((p) => ({ id: p.id, label: p.label, starts: p.startsAt, ends: p.endsAt, isBreak: p.isBreak })) : [{ label: 'Period 1', starts: '08:00', ends: '08:40', isBreak: false }])
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const add = () => { const last = rows[rows.length - 1]; setRows([...rows, { label: `Period ${rows.filter((r) => !r.isBreak).length + 1}`, starts: last?.ends ?? '08:00', ends: last?.ends ?? '08:40', isBreak: false }]) }
  return (
    <Dialog title="The school day" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-ink/70">List the periods in order, with their times. Mark break and lunch times as breaks; they cannot have lessons. A period that already has lessons cannot be removed.</p>
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.id ?? i} className="grid grid-cols-[1fr_6.5rem_6.5rem_auto_auto] items-end gap-2">
              <TextField label={i === 0 ? 'Name' : ''} aria-label={`Name of period ${i + 1}`} value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
              <TextField label={i === 0 ? 'Starts' : ''} aria-label={`Start of period ${i + 1}`} type="time" value={r.starts} onChange={(e) => set(i, { starts: e.target.value })} />
              <TextField label={i === 0 ? 'Ends' : ''} aria-label={`End of period ${i + 1}`} type="time" value={r.ends} onChange={(e) => set(i, { ends: e.target.value })} />
              <label className="flex h-11 items-center gap-1.5 text-sm"><input type="checkbox" checked={r.isBreak} onChange={(e) => set(i, { isBreak: e.target.checked })} /> Break</label>
              <button type="button" aria-label={`Remove period ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length === 1} className="grid size-11 place-items-center rounded-md text-ink/50 hover:bg-surface hover:text-danger disabled:opacity-30"><Trash2 className="size-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" onClick={add}><Plus className="size-4" aria-hidden /> Add a period</Button>
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button loading={runner.busy} onClick={() => void runner.run(async () => savePeriods(businessId, rows), 'Saved.')}>Save the school day</Button></div>
      </div>
    </Dialog>
  )
}
