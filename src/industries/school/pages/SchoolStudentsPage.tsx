import clsx from 'clsx'
import { ArrowRightLeft, Download, Printer, UserPlus, IdCard, Upload, GraduationCap } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { ConfirmDelete } from '../components/ConfirmDelete'
import { ReportCardSheet, printReportCards } from '../components/ReportCardSheet'
import { EndOfYearDialog, ImportStudentsDialog } from '../components/StudentBulkDialogs'
import { StudentDocumentsTab, idCardData } from '../components/StudentDocumentsTab'
import { printAnnualCards, printIdCards } from '../components/StudentSheets'
import { NoSetup, downloadCsv, fullName, useSchool } from '../components/schoolUi'
import { SchoolAdmissionsPage } from './SchoolAdmissionsPage'
import type { SchoolCtx } from '../components/schoolUi'
import { annualCard, deleteStudent, loadPhotos, loadRemarks, loadAdmissions, loadAttendance, loadBills, loadEnrollments, loadGuardians, loadStudents, promote, registerStudent, reportCard, setStudentStatus, updateStudent } from '../services/schoolApi'
import type { GuardianInput, SStudent, StudentInput, StudentStatus } from '../services/schoolApi'

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { active: 'success', transferred: 'warning', withdrawn: 'danger', graduated: 'neutral' }
const toInput = (st: SStudent): StudentInput => ({ first: st.first, middle: st.middle ?? '', last: st.last, dob: st.dob ?? '', gender: st.gender ?? '', classId: st.classId, admittedOn: st.admittedOn, emergencyName: st.emergencyName ?? '', emergencyPhone: st.emergencyPhone ?? '', notes: st.notes ?? '' })

/** Student records: search, register, view a full profile, move to another class, record a transfer or withdrawal. Nothing is ever deleted. */
export function SchoolStudentsPage() {
  const ctx = useSchool()
  const { businessId, s, can, classes, className } = ctx
  const students = useAsync(() => loadStudents(businessId), [businessId])
  const [q, setQ] = useState(''); const [cls, setCls] = useState(''); const [status, setStatus] = useState('active')
  const apps = useAsync(() => loadAdmissions(businessId).catch(() => []), [businessId])
  const [tab, setTab] = useState<'students' | 'applications'>('students')
  const remarks = useAsync(() => loadRemarks(businessId).catch(() => []), [businessId])
  const [importing, setImporting] = useState(false); const [yearEnd, setYearEnd] = useState(false); const [printingIds, setPrintingIds] = useState(false)
  const [adding, setAdding] = useState(false); const [moving, setMoving] = useState(false); const [openId, setOpenId] = useState<string | null>(null)
  if (!ctx.active) return null
  const edit = can('school.students')
  const term = q.trim().toLowerCase()
  const list = (students.data ?? []).filter((x) => (!status || x.status === status) && (!cls || x.classId === cls) && (!term || fullName(x).toLowerCase().includes(term) || x.admissionNo.toLowerCase().includes(term)))
  const open = students.data?.find((x) => x.id === openId) ?? null
  const exportCsv = () => downloadCsv('students', [['Admission no', 'Name', 'Class', 'Gender', 'Date of birth', 'Status', 'Admitted'], ...list.map((x) => [x.admissionNo, fullName(x), className(x.classId), x.gender ?? '', x.dob ?? '', x.status, x.admittedOn])])

  async function printIds() {
    setPrintingIds(true)
    try { const shown = list.slice(0, 200); const photos = await loadPhotos(businessId, shown.map((x) => x.id)); printIdCards(shown.map((x) => idCardData(ctx, x, photos[x.id] ?? null))) } finally { setPrintingIds(false) }
  }
  const pending = (apps.data ?? []).filter((a) => a.status === 'pending').length
  const showApps = can('school.students') || can('school.read')
  const tabs = showApps && (
    <div role="tablist" aria-label="Students or applications" className="no-print mb-3 flex gap-1 border-b border-ink/10">
      {([['students', 'Students'], ['applications', 'Applications']] as const).map(([id, text]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); if (id === 'students') void Promise.all([students.refresh(), apps.refresh()]) }} className={clsx('-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium', tab === id ? 'border-amber text-ink' : 'border-transparent text-ink/60 hover:text-ink')}>{text}{id === 'applications' && pending > 0 && <Badge tone="warning">{pending} waiting</Badge>}</button>)}
    </div>
  )
  if (tab === 'applications' && showApps) return (
    <>
      <PageHeader title="Students" description="Applications for a place, and everyone enrolled. A student who leaves is marked as transferred or withdrawn; their history stays on record." />
      {tabs}
      <SchoolAdmissionsPage embedded />
    </>
  )

  return (
    <>
      <PageHeader title="Students" description="Everyone enrolled at the school. A student who leaves is marked as transferred or withdrawn; their attendance, results and fee history stay on record."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={!list.length}><Download className="size-4" aria-hidden /> Export CSV</Button>
          <Button variant="secondary" loading={printingIds} disabled={!list.length} onClick={() => void printIds()}><IdCard className="size-4" aria-hidden /> ID cards</Button>
          {edit && <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="size-4" aria-hidden /> Import CSV</Button>}
          {edit && <Button variant="secondary" onClick={() => setYearEnd(true)}><GraduationCap className="size-4" aria-hidden /> End of year</Button>}
          {edit && <Button variant="secondary" onClick={() => setMoving(true)}><ArrowRightLeft className="size-4" aria-hidden /> Promote or move</Button>}
          {edit && <Button onClick={() => setAdding(true)}><UserPlus className="size-4" aria-hidden /> Register student</Button>}
        </div>} />
      {tabs}
      {students.error && <ErrorState message={students.error} />}
      {s && !s.classes.length && <NoSetup />}
      <div className="my-3 flex flex-wrap items-end gap-3">
        <div className="w-64"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or admission number" /></div>
        <div className="w-44"><SelectField label={ctx.classWord} value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></div>
        <div className="w-44"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['active', 'transferred', 'withdrawn', 'graduated'].map((x) => <option key={x} value={x}>{label(x)}</option>)}</SelectField></div>
      </div>
      {students.loading ? <Spinner /> : !list.length ? <Card><EmptyState title={students.data?.length ? 'No students match' : 'No students yet'} description={students.data?.length ? 'Try a different search or filter.' : 'Register a student, or accept an application under Admissions.'} /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Student</th><th className="p-3">Admission no</th><th className="p-3">Class</th><th className="p-3">Status</th><th className="p-3">Admitted</th></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {list.map((x) => (
                <tr key={x.id} onClick={() => setOpenId(x.id)} className="cursor-pointer hover:bg-surface">
                  <td className="p-3 font-medium">{fullName(x)}<div className="text-xs font-normal text-ink/60">{[x.gender && label(x.gender), x.dob].filter(Boolean).join(' · ')}</div></td>
                  <td className="p-3">{x.admissionNo}</td><td className="p-3">{className(x.classId)}</td><td className="p-3"><Badge tone={TONE[x.status]}>{label(x.status)}</Badge></td><td className="p-3">{x.admittedOn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {adding && <RegisterDialog ctx={ctx} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await students.refresh() }} />}
      {importing && <ImportStudentsDialog ctx={ctx} onClose={() => setImporting(false)} onDone={async () => { await students.refresh() }} />}
      {yearEnd && <EndOfYearDialog ctx={ctx} students={students.data ?? []} remarks={remarks.data ?? []} onClose={() => setYearEnd(false)} onDone={async () => { await students.refresh() }} />}
      {moving && <MoveDialog ctx={ctx} students={(students.data ?? []).filter((x) => x.status === 'active')} onClose={() => setMoving(false)} onSaved={async () => { setMoving(false); await students.refresh() }} />}
      {open && <Profile ctx={ctx} student={open} edit={edit} onClose={() => setOpenId(null)} onChanged={students.refresh} />}
    </>
  )
}

function StudentFields({ v, classes, withClass }: { v?: StudentInput; classes: { id: string; name: string }[]; withClass: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <TextField label="First name" name="first" defaultValue={v?.first} autoFocus /><TextField label="Middle name (optional)" name="middle" defaultValue={v?.middle} /><TextField label="Last name" name="last" defaultValue={v?.last} />
      <TextField label="Date of birth" name="dob" type="date" defaultValue={v?.dob} max={new Date().toISOString().slice(0, 10)} />
      <SelectField label="Gender" name="gender" defaultValue={v?.gender ?? ''}><option value="">Not stated</option><option value="female">Female</option><option value="male">Male</option></SelectField>
      {withClass && <SelectField label="Class" name="class" defaultValue={v?.classId ?? ''}><option value="">Select…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>}
      <TextField label="Emergency contact" name="emName" defaultValue={v?.emergencyName} /><TextField label="Emergency phone" name="emPhone" defaultValue={v?.emergencyPhone} />
      <div className="sm:col-span-3"><TextField label="Notes (optional)" name="notes" defaultValue={v?.notes} /></div>
    </div>
  )
}
const readStudent = (f: FormData, classId: string | null, admittedOn = ''): StudentInput => { const g = (k: string) => String(f.get(k) ?? '').trim(); return { first: g('first'), middle: g('middle'), last: g('last'), dob: g('dob'), gender: g('gender'), classId, admittedOn, emergencyName: g('emName'), emergencyPhone: g('emPhone'), notes: g('notes') } }

function RegisterDialog({ ctx, onClose, onSaved }: { ctx: SchoolCtx; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [problem, setProblem] = useState<string | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const g = (k: string) => String(f.get(k) ?? '').trim()
    if (!g('first') || !g('last')) return setProblem('Enter the student\'s first and last name.')
    if (!g('class')) return setProblem('Choose the class.')
    const guardian: GuardianInput = { name: g('gName'), phone: g('gPhone'), email: g('gEmail'), relationship: g('gRel') || 'parent', primary: true }
    setProblem(null)
    await runner.run((k) => registerStudent(ctx.businessId, readStudent(f, g('class')), guardian.name ? [guardian] : [], k), 'Registered.')
  }
  return (
    <Dialog title="Register a student" onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="space-y-4">
        <StudentFields classes={ctx.classes} withClass />
        <div><p className="mb-1 text-sm font-semibold">Parent or guardian</p>
          <div className="grid gap-3 sm:grid-cols-4"><TextField label="Name" name="gName" /><TextField label="Phone" name="gPhone" /><TextField label="Email (for the parent portal)" name="gEmail" type="email" /><TextField label="Relationship" name="gRel" placeholder="mother, father, guardian" /></div>
        </div>
        <Notice>The admission number is created for you and is never reused. Add more parents or guardians afterwards under Parents &amp; Guardians.</Notice>
        {(problem || runner.error) && <ErrorState title="Not registered" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Register</Button></div>
      </form>
    </Dialog>
  )
}

function MoveDialog({ ctx, students, onClose, onSaved }: { ctx: SchoolCtx; students: SStudent[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [picked, setPicked] = useState<string[]>([])
  const inClass = students.filter((x) => x.classId === from)
  return (
    <Dialog title="Promote or move students" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="From class" value={from} onChange={(e) => { setFrom(e.target.value); setPicked([]) }}><option value="">Select…</option>{ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
          <SelectField label="To class" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select…</option>{ctx.classes.filter((c) => c.id !== from).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
        </div>
        {from && (
          <div className="max-h-64 overflow-auto rounded-md border border-line">
            <label className="flex items-center gap-2 border-b border-line bg-surface p-2 text-sm font-medium"><input type="checkbox" checked={picked.length === inClass.length && inClass.length > 0} onChange={(e) => setPicked(e.target.checked ? inClass.map((x) => x.id) : [])} /> All {inClass.length} students</label>
            {inClass.map((x) => <label key={x.id} className="flex items-center gap-2 border-b border-ink/10 p-2 text-sm"><input type="checkbox" checked={picked.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((id) => id !== x.id))} /> {fullName(x)} <span className="text-ink/60">{x.admissionNo}</span></label>)}
          </div>
        )}
        <Notice>Each student&apos;s old class is kept in their enrolment history, and results stay with the class and term they were earned in.</Notice>
        {runner.error && <ErrorState title="Not moved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!to || !picked.length} loading={runner.busy} onClick={() => void runner.run(async () => promote(ctx.businessId, picked.map((studentId) => ({ studentId, classId: to })), 'Promoted'), 'Moved.')}>Move {picked.length || ''} student{picked.length === 1 ? '' : 's'}</Button></div>
      </div>
    </Dialog>
  )
}

function Profile({ ctx, student: st, edit, onClose, onChanged }: { ctx: SchoolCtx; student: SStudent; edit: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const { businessId, className, currentTerm, s } = ctx
  const [tab, setTab] = useState('details')
  const runner = useFormRunner(onChanged)
  const [leaving, setLeaving] = useState<StudentStatus | null>(null); const [reason, setReason] = useState('')
  const enrol = useAsync(() => loadEnrollments(businessId, st.id), [businessId, st.id])
  const links = useAsync(() => loadGuardians(businessId), [businessId])
  const att = useAsync(() => loadAttendance(businessId), [businessId])
  const bills = useAsync(() => loadBills(businessId).catch(() => []), [businessId])
  const photo = useAsync(async () => (await loadPhotos(businessId, [st.id]))[st.id] ?? null, [businessId, st.id])
  const [term, setTerm] = useState(currentTerm?.id ?? '')
  const card = useAsync(() => (term ? reportCard(businessId, st.id, term).catch(() => null) : Promise.resolve(null)), [businessId, st.id, term])
  const mine = (att.data ?? []).filter((a) => a.studentId === st.id)
  const guardians = (links.data?.links ?? []).filter((l) => l.studentId === st.id).map((l) => ({ ...l, g: links.data!.guardians.find((x) => x.id === l.guardianId) })).filter((x) => x.g)
  const myBills = (bills.data ?? []).filter((b) => b.studentId === st.id)
  const tabs = [['details', 'Details'], ['guardians', 'Parents'], ['attendance', 'Attendance'], ['results', 'Results'], ['fees', 'Fees'], ...(edit ? [['documents', 'Documents'] as const] : [])] as const
  const rate = mine.length ? Math.round((mine.filter((a) => a.status === 'present' || a.status === 'late').length * 1000) / mine.length) / 10 : null
  const [editing, setEditing] = useState(false)
  async function save(e: FormEvent<HTMLFormElement>) { e.preventDefault(); await runner.run(async () => updateStudent(businessId, st.id, readStudent(new FormData(e.currentTarget), st.classId, st.admittedOn)), 'Saved.', () => setEditing(false)) }

  return (
    <DetailPage title={`${fullName(st)}`} onClose={onClose} wide actions={<div className="flex gap-2"><Button variant="secondary" onClick={() => window.print()} className="no-print"><Printer className="size-4" aria-hidden /> Print</Button>{ctx.can('school.delete') && <ConfirmDelete label={fullName(st)} noun="student" warning="Their attendance, results, remarks and class history are erased with them. A student who has fee payments on record cannot be deleted, because records of money are never erased; mark them as withdrawn instead." withReason onConfirm={(reason) => deleteStudent(businessId, st.id, reason)} onDeleted={async () => { onClose(); await onChanged() }} />}</div>}>
      <p className="mb-3 text-sm text-ink/70">{st.admissionNo} · {className(st.classId)} · <Badge tone={TONE[st.status]}>{label(st.status)}</Badge>{st.statusReason ? ` · ${st.statusReason}` : ''}</p>
      <div role="tablist" aria-label="Student sections" className="no-print mb-4 flex flex-wrap gap-1 border-b border-ink/10">
        {tabs.map(([id, t]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === id ? 'border-amber text-ink' : 'border-transparent text-ink/60 hover:text-ink')}>{t}</button>)}
      </div>
      {runner.error && <ErrorState message={runner.error} />}

      {tab === 'details' && (editing ? (
        <form onSubmit={save} noValidate className="space-y-3">
          <StudentFields v={toInput(st)} classes={ctx.classes} withClass={false} />
          <div className="flex gap-2"><Button type="submit" loading={runner.busy}>Save changes</Button><Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button></div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Student details</h3>{edit && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}</div>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            {([['Admission number', st.admissionNo], ['Class', className(st.classId)], ['Gender', st.gender ? label(st.gender) : '–'], ['Date of birth', st.dob ?? '–'], ['Admitted', st.admittedOn], ['Emergency contact', [st.emergencyName, st.emergencyPhone].filter(Boolean).join(' · ') || '–']] as const).map(([t, v]) => <div key={t}><dt className="text-xs text-ink/60">{t}</dt><dd>{v}</dd></div>)}
            <div className="sm:col-span-3"><dt className="text-xs text-ink/60">Notes</dt><dd className="whitespace-pre-wrap">{st.notes ?? '–'}</dd></div>
          </dl>
          <div><h3 className="mb-1 text-sm font-semibold">Class history</h3>{enrol.data?.length ? <ul className="divide-y divide-ink/10 text-sm">{enrol.data.map((e) => <li key={e.id} className="flex justify-between py-1.5"><span>{className(e.classId)} <span className="text-ink/60">{e.reason}</span></span><span className="text-ink/60">{e.startedOn} to {e.endedOn ?? 'now'}</span></li>)}</ul> : <p className="text-sm text-ink/60">No class history.</p>}</div>
          {edit && (
            <div className="no-print flex flex-wrap gap-2 border-t border-line pt-3">
              {st.status === 'active' ? (['transferred', 'withdrawn', 'graduated'] as const).map((x) => <Button key={x} variant="secondary" onClick={() => { setLeaving(x); setReason('') }}>Mark as {x}</Button>) : <Button variant="secondary" loading={runner.busy} onClick={() => void runner.run(async () => setStudentStatus(businessId, st.id, 'active', ''), 'Reinstated.')}>Reinstate as active</Button>}
            </div>
          )}
        </div>
      ))}

      {tab === 'guardians' && (guardians.length ? <ul className="divide-y divide-ink/10 text-sm">{guardians.map((x) => <li key={x.guardianId} className="py-2"><b>{x.g!.name}</b> <Badge>{x.relationship}</Badge>{x.isPrimary && <> <Badge tone="info">Primary</Badge></>}<div className="text-xs text-ink/60">{[x.g!.phone, x.g!.email].filter(Boolean).join(' · ') || 'No contact'}</div></li>)}</ul> : <p className="text-sm text-ink/60">No parent or guardian linked yet. Add one under Parents &amp; Guardians.</p>)}

      {tab === 'attendance' && (
        <div className="space-y-3">
          <p className="text-sm">{rate === null ? 'No attendance recorded yet.' : <>Present or late on <b>{rate}%</b> of {mine.length} marked days.</>} {mine.filter((a) => a.status === 'absent').length > 0 && <>Absent {mine.filter((a) => a.status === 'absent').length} day(s), late {mine.filter((a) => a.status === 'late').length}, excused {mine.filter((a) => a.status === 'excused').length}.</>}</p>
          {mine.length > 0 && <ul className="max-h-72 divide-y divide-ink/10 overflow-auto text-sm">{[...mine].sort((a, b) => b.on.localeCompare(a.on)).slice(0, 60).map((a) => <li key={a.id} className="flex justify-between py-1.5"><span>{a.on}</span><span className="flex items-center gap-2">{a.note && <span className="text-xs text-ink/60">{a.note}</span>}<Badge tone={a.status === 'present' ? 'success' : a.status === 'absent' ? 'danger' : 'warning'}>{label(a.status)}</Badge></span></li>)}</ul>}
        </div>
      )}

      {tab === 'documents' && edit && <StudentDocumentsTab ctx={ctx} student={st} onPhoto={() => void photo.refresh()} />}

      {tab === 'results' && (
        <div className="space-y-3">
          <div className="no-print flex flex-wrap items-end justify-between gap-3"><div className="max-w-xs"><SelectField label={ctx.termWord} value={term} onChange={(e) => setTerm(e.target.value)}>{(s?.terms ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField></div>{card.data?.subjects.length ? <><Button variant="secondary" onClick={() => printReportCards([card.data!], [photo.data])}><Printer className="size-4" aria-hidden /> Print report card</Button><Button variant="secondary" onClick={() => void (async () => { const sid = s?.terms.find((x) => x.id === term)?.sessionId ?? s?.sessions.find((x) => x.current)?.id; if (!sid) return; const c = await annualCard(businessId, st.id, sid).catch(() => null); if (c) printAnnualCards([c], [photo.data]) })()}><Printer className="size-4" aria-hidden /> Annual report</Button></> : null}</div>
          {card.loading ? <Spinner /> : !card.data || !card.data.subjects.length ? <p className="text-sm text-ink/60">No results for this term yet.</p> : <ReportCardSheet card={card.data} photo={photo.data} />}
        </div>
      )}

      {tab === 'fees' && (myBills.length ? <ul className="divide-y divide-ink/10 text-sm">{myBills.map((b) => <li key={b.id} className="flex flex-wrap items-baseline gap-2 py-2"><b>{b.number}</b><span className="text-ink/60">{ctx.termName(b.termId)}</span><Badge tone={b.status === 'paid' ? 'success' : b.status === 'overdue' ? 'danger' : 'warning'}>{label(b.status)}</Badge><span className="tabular ml-auto">{naira(b.paid)} of {naira(b.payable)}{b.balance > 0 && <b className="ml-2 text-warning">owes {naira(b.balance)}</b>}</span></li>)}</ul> : <p className="text-sm text-ink/60">No fee bills, or you do not have access to fees.</p>)}

      {leaving && (
        <Dialog title={`Mark ${st.first} as ${leaving}`} onClose={() => setLeaving(null)}>
          <div className="space-y-4">
            <p className="text-sm text-ink/80">The student leaves the active list and their current class enrolment is closed. Their history is kept, and you can reinstate them.</p>
            <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            {runner.error && <ErrorState title="Not saved" message={runner.error} />}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setLeaving(null)}>Cancel</Button><Button disabled={reason.trim().length < 3} loading={runner.busy} onClick={() => void runner.run(async () => setStudentStatus(businessId, st.id, leaving, reason), 'Saved.', () => setLeaving(null))}>Confirm</Button></div>
          </div>
        </Dialog>
      )}
    </DetailPage>
  )
}

