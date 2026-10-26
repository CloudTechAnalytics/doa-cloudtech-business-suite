import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { LEVEL_NAMES, NoSetup, classLevel, fullName, levelsOf, useSchool } from '../components/schoolUi'
import { deleteClass, deleteDepartment, deleteSubject, loadStaff, loadStudents, saveClass, saveDepartment, saveHoliday, saveSession, saveSubject, saveTerm, setClassSubjects } from '../services/schoolApi'
import { STAGES, SUBJECT_LEVELS, stageOk } from '../services/schoolApi'
import type { SClass, SDepartment, SSession, SSubject, STerm, Stage, SubjectLevel } from '../services/schoolApi'
import { ConfirmDelete } from '../components/ConfirmDelete'

type Panel = null | { kind: 'class'; v: SClass | null } | { kind: 'subject'; v: SSubject | null } | { kind: 'session'; v: SSession | null } | { kind: 'term'; v: STerm | null } | { kind: 'holiday' } | { kind: 'department'; v: SDepartment | null }

/** Academic sessions and terms, classes, subjects, which subjects each class takes, and school holidays. */
export function SchoolClassesPage() {
  const ctx = useSchool()
  const { businessId, s, can, structure, active } = ctx
  const students = useAsync(() => loadStudents(businessId), [businessId])
  const staff = useAsync(() => loadStaff(businessId).catch(() => ({ staff: [], assignments: [] })), [businessId])
  const [panel, setPanel] = useState<Panel>(null); const [openId, setOpenId] = useState<string | null>(null)
  const [sq, setSq] = useState(''); const [sLevel, setSLevel] = useState(''); const [sDept, setSDept] = useState('')
  if (!active) return null
  const manage = can('school.manage')
  const done = async () => { setPanel(null); await structure.refresh() }
  const open = s?.classes.find((c) => c.id === openId) ?? null
  const shownSubjects = ctx.visibleSubjects.filter((x) => (!sq.trim() || (x.name + ' ' + (x.code ?? '')).toLowerCase().includes(sq.trim().toLowerCase())) && (!sLevel || x.levels.includes(sLevel as SubjectLevel)) && (!sDept || (sDept === 'none' ? !x.departmentId : x.departmentId === sDept)))
  const filtering = !!(sq.trim() || sLevel || sDept)
  const online = ctx.kind === 'online'
  return (
    <>
      <PageHeader title={online ? 'Courses & Units' : 'Classes & Subjects'} description={online ? 'The courses the school offers, the units in each course, and the terms learners enrol for.' : 'The shape of the school year: sessions and terms, the classes, the subjects, and what each class studies.'} />
      {online ? <p className="mb-3 rounded-lg bg-surface px-3 py-2 text-sm text-ink/70">How it fits together: add the <b>courses</b> your school offers, with a short description and how long each takes. Open a course to add its <b>units</b> (the topics or modules learners are assessed on). Set each course's fee under School Fees, and enrol learners from Students.</p> : <p className="mb-3 rounded-lg bg-surface px-3 py-2 text-sm text-ink/70">How it fits together: <b>classes</b> are the groups pupils sit in, <b>subjects</b> are what the school teaches, and each class studies the subjects you tick when you open it. Departments only matter for senior secondary.</p>}
      {structure.error && <ErrorState message={structure.error} />}
      {s && !ctx.visibleClasses.length && !online && <NoSetup />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">{online ? '1. Courses' : '1. Classes'}</h3><p className="text-xs text-ink/60">{online ? 'Open a course to add its units and see who is enrolled.' : 'Open a class to choose the subjects it studies.'}</p></div>{manage && <Button variant="secondary" onClick={() => setPanel({ kind: 'class', v: null })}><Plus className="size-4" aria-hidden /> {online ? 'Add course' : 'Add class'}</Button>}</div>
          {online && ctx.visibleClasses.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{ctx.visibleClasses.map((c) => <li key={c.id}><button onClick={() => setOpenId(c.id)} className="flex h-full w-full flex-col gap-1 rounded-lg border border-line px-4 py-3 text-left hover:bg-surface"><span className="flex items-start justify-between gap-2"><span className="font-semibold">{c.name}</span>{!c.active && <Badge>Not open</Badge>}</span>{c.duration && <span className="text-xs font-medium text-accent">{c.duration}</span>}{c.description && <span className="line-clamp-2 text-xs text-ink/70">{c.description}</span>}<span className="mt-auto pt-1 text-xs text-ink/60">{(students.data ?? []).filter((x) => x.classId === c.id && x.status === 'active').length} learners · {(s?.classSubjects ?? []).filter((x) => x.classId === c.id).length} units</span></button></li>)}</ul>
          )}
          {!online && ctx.visibleClasses.length ? (
            <div className="space-y-4">{(['nursery', 'primary', 'jss', 'sss'] as const).map((lv) => { const list = ctx.visibleClasses.filter((c) => classLevel(c) === lv); if (!list.length) return null; return (
              <section key={lv}><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/55">{LEVEL_NAMES[lv]}</h4>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{list.map((c) => <li key={c.id}><button onClick={() => setOpenId(c.id)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-surface"><span className="font-medium">{c.name}{!c.active && <> <Badge>Not in use</Badge></>}</span><span className="text-xs text-ink/60">{(students.data ?? []).filter((x) => x.classId === c.id && x.status === 'active').length} pupils · {(s?.classSubjects ?? []).filter((x) => x.classId === c.id).length} subjects</span></button></li>)}</ul></section>
            ) })}</div>
          ) : !ctx.visibleClasses.length ? (online ? <EmptyState title="No courses yet" description="Add the courses your school offers. Each can have a description, a duration and its own units." /> : <EmptyState title="No classes yet" description="Add a class, or use Start from the standard structure." />) : null}
        </Card>
        <Card className="lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">{online ? '2. Units' : '2. Subjects'}</h3><p className="text-xs text-ink/60">{online ? 'Every unit across your courses, listed once. Click one to change or delete it.' : 'Every subject the school teaches, listed once. Click one to change or delete it.'}</p></div>{manage && <Button variant="secondary" onClick={() => setPanel({ kind: 'subject', v: null })}><Plus className="size-4" aria-hidden /> {online ? 'Add unit' : 'Add subject'}</Button>}</div>
          {ctx.visibleSubjects.length > 6 && !online && (
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="w-56"><TextField label="Search subjects" value={sq} onChange={(e) => setSq(e.target.value)} placeholder="Name or code" /></div>
              <div className="w-48"><SelectField label="Taught at" value={sLevel} onChange={(e) => setSLevel(e.target.value)}><option value="">All levels</option>{SUBJECT_LEVELS.filter((l) => levelsOf(ctx.kind).includes(l)).map((l) => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}</SelectField></div>
              {(s?.departments.length ?? 0) > 0 && <div className="w-48"><SelectField label="Department" value={sDept} onChange={(e) => setSDept(e.target.value)}><option value="">All</option><option value="none">Every department</option>{s!.departments.map((d) => <option key={d.id} value={d.id}>{d.name} only</option>)}</SelectField></div>}
              {filtering && <Button variant="secondary" onClick={() => { setSq(''); setSLevel(''); setSDept('') }}>Clear</Button>}
              <p className="pb-2 text-xs text-ink/60">{shownSubjects.length} of {ctx.visibleSubjects.length} subjects</p>
            </div>
          )}
          {filtering && !shownSubjects.length ? <p className="py-4 text-center text-sm text-ink/60">No subject matches. Clear the filters, or add it.</p> : ctx.visibleSubjects.length ? <ul className="divide-y divide-ink/10 text-sm">{shownSubjects.map((x) => { const dept = s?.departments.find((d) => d.id === x.departmentId); const n = (s?.classSubjects ?? []).filter((cs) => cs.subjectId === x.id).length; return (
            <li key={x.id}><button disabled={!manage} onClick={() => setPanel({ kind: 'subject', v: x })} className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left hover:bg-surface"><span className="font-medium">{x.name}{x.code ? <span className="text-ink/50"> ({x.code})</span> : null}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink/60">{x.levels.map((l) => <Badge key={l}>{LEVEL_NAMES[l]}</Badge>)}{dept && <Badge tone="info">{dept.name} only</Badge>}<span>{n} {n === 1 ? 'class' : 'classes'}</span></span></button></li>) })}</ul> : <EmptyState title={online ? 'No units yet' : 'No subjects yet'} />}
        </Card>
        {(ctx.kind === 'secondary' || ctx.kind === 'combined' || (s?.departments.length ?? 0) > 0) && (
          <Card className="lg:col-span-2">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Departments (senior secondary only)</h3><p className="text-xs text-ink/60">Such as Science, Art and Commercial. A senior secondary class sits in one department, and a subject can be limited to one.</p></div>{manage && <Button variant="secondary" onClick={() => setPanel({ kind: 'department', v: null })}><Plus className="size-4" aria-hidden /> Add department</Button>}</div>
            {s?.departments.length ? <ul className="mt-2 flex flex-wrap gap-2 text-sm">{s.departments.map((d) => <li key={d.id}><button disabled={!manage} onClick={() => setPanel({ kind: 'department', v: d })} className="rounded-full border border-line px-3 py-1 hover:bg-surface">{d.name} <span className="text-ink/50">· {s.classes.filter((c) => c.departmentId === d.id && c.active).length} classes</span></button></li>)}</ul> : <p className="mt-2 text-sm text-ink/60">No departments yet.</p>}
          </Card>
        )}
        <Card>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Sessions & terms</h3>{manage && <div className="flex gap-2"><Button variant="secondary" onClick={() => setPanel({ kind: 'session', v: null })}><Plus className="size-4" aria-hidden /> Session</Button><Button variant="secondary" disabled={!s?.sessions.length} onClick={() => setPanel({ kind: 'term', v: null })}><Plus className="size-4" aria-hidden /> Term</Button></div>}</div>
          {s?.sessions.length ? <ul className="space-y-3 text-sm">{s.sessions.map((x) => <li key={x.id}><div className="flex items-center justify-between"><button className="font-medium underline" disabled={!manage} onClick={() => setPanel({ kind: 'session', v: x })}>{x.name}</button><span className="text-ink/60">{x.startsOn} to {x.endsOn} {x.current && <Badge tone="success">Current</Badge>}</span></div>
            <ul className="ml-4 mt-1 divide-y divide-ink/10">{s.terms.filter((t) => t.sessionId === x.id).map((t) => <li key={t.id} className="flex items-center justify-between py-1"><button disabled={!manage} className="underline" onClick={() => setPanel({ kind: 'term', v: t })}>{t.name}</button><span className="text-ink/60">{t.startsOn} to {t.endsOn} {t.current && <Badge tone="success">Current</Badge>}</span></li>)}</ul></li>)}</ul> : <EmptyState title="No sessions yet" />}
        </Card>
        <Card>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Holidays & days off</h3>{manage && <Button variant="secondary" onClick={() => setPanel({ kind: 'holiday' })}><Plus className="size-4" aria-hidden /> Holiday</Button>}</div>
          {s?.holidays.length ? <ul className="divide-y divide-ink/10 text-sm">{s.holidays.map((h) => <li key={h.on} className="flex justify-between py-1.5"><span>{h.name}</span><span className="text-ink/60">{h.on}</span></li>)}</ul> : <p className="text-sm text-ink/60">None. Attendance cannot be taken on a holiday.</p>}
        </Card>
      </div>
      {panel && <Editor ctx={ctx} panel={panel} onClose={() => setPanel(null)} onSaved={done} />}
      {open && <ClassPage ctx={ctx} c={open} students={(students.data ?? []).filter((x) => x.classId === open.id && x.status === 'active')} teachers={staff.data ?? undefined} onClose={() => setOpenId(null)} onEdit={() => setPanel({ kind: 'class', v: open })} onChanged={structure.refresh} />}
    </>
  )
}

function Editor({ ctx, panel, onClose, onSaved }: { ctx: ReturnType<typeof useSchool>; panel: NonNullable<Panel>; onClose: () => void; onSaved: () => Promise<void> }) {
  const b = ctx.businessId; const runner = useFormRunner(onSaved)
  const [f, setF] = useState<Record<string, string>>((): Record<string, string> => {
    if (panel.kind === 'class') return { name: panel.v?.name ?? '', level: String(panel.v?.levelOrder ?? ''), arm: panel.v?.arm ?? '', active: panel.v?.active === false ? '' : 'on', stage: panel.v?.stage ?? STAGES.find((st) => stageOk(ctx.kind, st)) ?? 'primary', department: panel.v?.departmentId ?? '', description: panel.v?.description ?? '', duration: panel.v?.duration ?? '' }
    if (panel.kind === 'subject') return { name: panel.v?.name ?? '', code: panel.v?.code ?? '', levels: (panel.v ? panel.v.levels : levelsOf(ctx.kind)).join(','), department: panel.v?.departmentId ?? '' }
    if (panel.kind === 'department') return { name: panel.v?.name ?? '' }
    if (panel.kind === 'session') return { name: panel.v?.name ?? '', starts: panel.v?.startsOn ?? '', ends: panel.v?.endsOn ?? '', current: panel.v?.current ? 'on' : '' }
    if (panel.kind === 'term') return { session: panel.v?.sessionId ?? ctx.s?.sessions.find((x) => x.current)?.id ?? '', name: panel.v?.name ?? '', starts: panel.v?.startsOn ?? '', ends: panel.v?.endsOn ?? '', current: panel.v?.current ? 'on' : '' }
    return { on: '', name: '' }
  })
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))
  const tick = (k: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.checked ? 'on' : '' }))} /> {k === 'active' ? 'In use' : 'This is the current one'}</label>
  const save = () => {
    if (panel.kind === 'class') return runner.run(async () => saveClass(b, { id: panel.v?.id ?? null, name: f.name.trim(), levelOrder: f.level ? Number(f.level) : Math.max(0, ...(ctx.s?.classes ?? []).map((c) => c.levelOrder)) + 1, arm: f.arm.trim(), active: !!f.active, stage: f.stage as Stage, departmentId: f.stage === 'secondary' && f.department ? f.department : null, description: f.description, duration: f.duration }), 'Saved.')
    if (panel.kind === 'subject') return runner.run(async () => saveSubject(b, { id: panel.v?.id ?? null, name: f.name.trim(), code: f.code.trim(), levels: (f.levels ? f.levels.split(',') : []) as SubjectLevel[], departmentId: f.department || null }), 'Saved.')
    if (panel.kind === 'department') return runner.run(async () => saveDepartment(b, { id: panel.v?.id ?? null, name: f.name.trim() }), 'Saved.')
    if (panel.kind === 'session') return runner.run(async () => saveSession(b, { id: panel.v?.id ?? null, name: f.name.trim(), startsOn: f.starts, endsOn: f.ends, current: !!f.current }), 'Saved.')
    if (panel.kind === 'term') return runner.run(async () => saveTerm(b, { id: panel.v?.id ?? null, sessionId: f.session, name: f.name.trim(), startsOn: f.starts, endsOn: f.ends, current: !!f.current }), 'Saved.')
    return runner.run(async () => saveHoliday(b, f.on, f.name.trim()), 'Saved.')
  }
  const isOnline = ctx.kind === 'online'
  const title = { class: isOnline ? 'Course' : 'Class', subject: isOnline ? 'Unit' : 'Subject', session: 'Academic session', term: 'Term', holiday: 'Holiday', department: 'Department' }[panel.kind]
  const levelsNow = f.levels ? f.levels.split(',') : []
  const toggleLevel = (l: SubjectLevel) => setF((p) => ({ ...p, levels: (levelsNow.includes(l) ? levelsNow.filter((x) => x !== l) : [...levelsNow, l]).join(',') }))
  const departments = ctx.s?.departments ?? []
  return (
    <Dialog title={`${'v' in panel && panel.v ? 'Edit' : 'Add'} ${title.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void save() }} noValidate className="space-y-3">
        {panel.kind === 'term' && <SelectField label="Session" value={f.session} onChange={set('session')}>{(ctx.s?.sessions ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField>}
        {panel.kind === 'holiday' ? <><TextField label="Date" type="date" value={f.on} onChange={set('on')} /><TextField label="Name" value={f.name} onChange={set('name')} placeholder="Independence Day" /></> : <TextField label={isOnline && panel.kind === 'class' ? 'Course title' : isOnline && panel.kind === 'subject' ? 'Unit name' : 'Name'} value={f.name} onChange={set('name')} autoFocus />}
        {panel.kind === 'class' && isOnline && <><TextField label="Duration (optional)" value={f.duration} onChange={set('duration')} placeholder="12 weeks, 3 months, self-paced" /><label className="block text-sm"><span className="mb-1 block font-medium">Description (optional)</span><textarea value={f.description} onChange={set('description')} rows={4} maxLength={600} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm" placeholder="What learners will study, who it is for, how it is taught" /></label></>}
        {panel.kind === 'class' && !isOnline && <SelectField label="Stage" value={f.stage} onChange={set('stage')}>{STAGES.filter((st) => stageOk(ctx.kind, st)).map((st) => <option key={st} value={st}>{st === 'nursery' ? 'Nursery' : st === 'primary' ? 'Primary' : 'Secondary'}</option>)}</SelectField>}
        {panel.kind === 'class' && !isOnline && <details className="text-sm" open={!!f.arm}><summary className="cursor-pointer text-ink/70">More options</summary><div className="mt-2 grid gap-3 sm:grid-cols-2"><TextField label="Order in the school (1 = lowest)" type="number" min={0} value={f.level} onChange={set('level')} /><TextField label="Arm (optional)" value={f.arm} onChange={set('arm')} placeholder="A, B, Gold" /></div><p className="mt-1 text-xs text-ink/60">Leave the order empty and the class goes at the end.</p></details>}
        {panel.kind === 'class' && f.stage === 'secondary' && departments.length > 0 && <SelectField label="Department (senior secondary)" value={f.department} onChange={set('department')}><option value="">None (junior secondary)</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</SelectField>}
        {panel.kind === 'subject' && <TextField label="Short code (optional)" value={f.code} onChange={set('code')} />}
        {panel.kind === 'subject' && !isOnline && <fieldset className="space-y-1"><legend className="mb-1 text-sm font-medium">Taught at</legend><div className="flex flex-wrap gap-x-4 gap-y-1">{SUBJECT_LEVELS.filter((l) => levelsOf(ctx.kind).includes(l)).map((l) => <label key={l} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={levelsNow.includes(l)} onChange={() => toggleLevel(l)} />{LEVEL_NAMES[l]}</label>)}</div><p className="text-xs text-ink/60">Tick the levels where it is offered. This decides which subjects are suggested for each class.</p></fieldset>}
        {panel.kind === 'subject' && departments.length > 0 && <SelectField label="Department (senior secondary only)" value={f.department} onChange={set('department')}><option value="">Every department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</SelectField>}
        {(panel.kind === 'session' || panel.kind === 'term') && <div className="grid gap-3 sm:grid-cols-2"><TextField label="Starts" type="date" value={f.starts} onChange={set('starts')} /><TextField label="Ends" type="date" value={f.ends} onChange={set('ends')} /></div>}
        {(panel.kind === 'session' || panel.kind === 'term') && tick('current')}
        {panel.kind === 'class' && tick('active')}
        {panel.kind === 'class' && isOnline && <p className="-mt-2 text-xs text-ink/60">Untick "In use" to stop offering the course without deleting it.</p>}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-between gap-2">{panel.kind === 'holiday' ? <HolidayRemove ctx={ctx} onDone={onSaved} /> : 'v' in panel && panel.v ? <EditorDelete ctx={ctx} panel={panel} onDone={onSaved} /> : <span />}<div className="flex gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Save</Button></div></div>
      </form>
    </Dialog>
  )
}

function EditorDelete({ ctx, panel, onDone }: { ctx: ReturnType<typeof useSchool>; panel: NonNullable<Panel>; onDone: () => Promise<void> }) {
  const b = ctx.businessId
  if (panel.kind === 'subject' && panel.v) { const id = panel.v.id; return <ConfirmDelete label={panel.v.name} noun="subject" warning="It is taken off every class and removed from the timetable. A subject that already has results recorded cannot be deleted." onConfirm={() => deleteSubject(b, id)} onDeleted={onDone} /> }
  if (panel.kind === 'department' && panel.v) { const id = panel.v.id; return <ConfirmDelete label={panel.v.name} noun="department" warning="A department that still has classes or subjects cannot be deleted; move them first." onConfirm={() => deleteDepartment(b, id)} onDeleted={onDone} /> }
  if (panel.kind === 'class' && panel.v) { const id = panel.v.id; return <ConfirmDelete label={panel.v.name} noun="class" warning="Its subject choices, teacher assignments and timetable are removed. A class that has students, attendance, results or fees on record cannot be deleted; untick In use instead." onConfirm={() => deleteClass(b, id)} onDeleted={onDone} /> }
  return <span />
}

function HolidayRemove({ ctx, onDone }: { ctx: ReturnType<typeof useSchool>; onDone: () => Promise<void> }) {
  const runner = useFormRunner(onDone); const [on, setOn] = useState('')
  const hol = ctx.s?.holidays ?? []
  if (!hol.length) return <span />
  return <div className="flex items-center gap-1"><select aria-label="Holiday to remove" value={on} onChange={(e) => setOn(e.target.value)} className="rounded-md border border-line px-2 py-1 text-xs"><option value="">Remove a holiday…</option>{hol.map((h) => <option key={h.on} value={h.on}>{h.name} ({h.on})</option>)}</select><Button type="button" variant="secondary" disabled={!on} loading={runner.busy} onClick={() => void runner.run(async () => saveHoliday(ctx.businessId, on, hol.find((h) => h.on === on)?.name ?? '', true), 'Removed.')}>Remove</Button></div>
}

function ClassPage({ ctx, c, students, teachers, onClose, onEdit, onChanged }: { ctx: ReturnType<typeof useSchool>; c: SClass; students: Awaited<ReturnType<typeof loadStudents>>; teachers?: Awaited<ReturnType<typeof loadStaff>>; onClose: () => void; onEdit: () => void; onChanged: () => Promise<void> }) {
  const runner = useFormRunner(onChanged)
  const [picked, setPicked] = useState<string[]>((ctx.s?.classSubjects ?? []).filter((x) => x.classId === c.id).map((x) => x.subjectId))
  const manage = ctx.can('school.manage')
  const mine = (teachers?.assignments ?? []).filter((a) => a.classId === c.id)
  // A subject fits a class when it is taught at the class's level and (for senior secondary) is in its department or in none.
  const level = classLevel(c)
  const fits = (x: SSubject) => (x.levels.length === 0 || x.levels.includes(level)) && (!x.departmentId || x.departmentId === c.departmentId)
  const [find, setFind] = useState('')
  const match = (x: SSubject) => !find.trim() || x.name.toLowerCase().includes(find.trim().toLowerCase())
  const fit = ctx.visibleSubjects.filter((x) => fits(x) && match(x))
  const others = ctx.visibleSubjects.filter((x) => !fits(x) && match(x))
  return (
    <DetailPage title={c.name} onClose={onClose} wide actions={manage ? <div className="flex gap-2"><Button variant="secondary" onClick={onEdit}>Edit</Button><ConfirmDelete label={c.name} noun="class" warning="Its subject choices, teacher assignments and timetable are removed. A class that has students, attendance, results or fees on record cannot be deleted; untick In use under Edit instead." onConfirm={() => deleteClass(ctx.businessId, c.id)} onDeleted={async () => { onClose(); await onChanged() }} /></div> : undefined}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>{c.stage === 'online' && (c.duration || c.description) && <div className="mb-4 rounded-lg bg-surface p-3 text-sm">{c.duration && <p className="font-semibold text-accent">{c.duration}</p>}{c.description && <p className="mt-1 whitespace-pre-line text-ink/80">{c.description}</p>}</div>}<h3 className="mb-1 text-sm font-semibold">{c.stage === 'online' ? 'Units in this course' : 'Subjects taken'}</h3>
          <p className="mb-2 text-xs text-ink/60">Tick the subjects this class studies. The first list shows the subjects that fit the level of this class{c.departmentId ? ' and department' : ''}; the rest are under "Other subjects".</p>
          {ctx.visibleSubjects.length > 8 && <div className="mb-2 max-w-xs"><TextField label="Find a subject" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type to filter" /></div>}
          {find.trim() && !fit.length && !others.length && <p className="text-sm text-ink/60">No subject matches.</p>}
          <ul className="space-y-1 text-sm">{fit.map((x) => <li key={x.id}><label className="flex items-center gap-2"><input type="checkbox" disabled={!manage} checked={picked.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((id) => id !== x.id))} /> {x.name}</label></li>)}</ul>
          {others.length > 0 && <details className="mt-3" open={others.some((x) => picked.includes(x.id))}><summary className="cursor-pointer text-sm font-medium text-ink/70">Other subjects ({others.length})</summary><ul className="mt-1 space-y-1 text-sm">{others.map((x) => <li key={x.id}><label className="flex items-center gap-2"><input type="checkbox" disabled={!manage} checked={picked.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((id) => id !== x.id))} /> {x.name} {x.levels.length > 0 && <span className="text-xs text-ink/50">({x.levels.map((l) => LEVEL_NAMES[l]).join(', ')})</span>}</label></li>)}</ul></details>}
          {manage && <div className="mt-3 space-y-2">{runner.error && <ErrorState title="Not saved" message={runner.error} />}{runner.ok && <Notice>{runner.ok}</Notice>}<Button loading={runner.busy} onClick={() => void runner.run(async () => setClassSubjects(ctx.businessId, c.id, picked), 'Subjects saved.')}>Save subjects</Button></div>}
          <p className="mt-2 text-xs text-ink/60">Removing a subject that already has scores is refused so results are never lost.</p></div>
        <div><h3 className="mb-1 text-sm font-semibold">{c.stage === 'online' ? 'Instructors' : 'Teachers'}</h3>
          {mine.length ? <ul className="divide-y divide-ink/10 text-sm">{mine.map((a) => <li key={a.id} className="py-1.5">{teachers?.staff.find((x) => x.id === a.staffId)?.name ?? 'Teacher'} <span className="text-ink/60">{a.classTeacher ? 'Class teacher' : ''} {a.subjectId ? ctx.subjectName(a.subjectId) : ''}</span></li>)}</ul> : <p className="text-sm text-ink/60">No teachers assigned. Assign them under Teachers & Staff.</p>}
          <h3 className="mb-1 mt-4 text-sm font-semibold">{c.stage === 'online' ? 'Learners' : 'Students'} ({students.length})</h3>
          {students.length ? <ul className="max-h-60 divide-y divide-ink/10 overflow-auto text-sm">{students.map((x) => <li key={x.id} className="py-1.5">{fullName(x)} <span className="text-ink/60">{x.admissionNo}</span></li>)}</ul> : <p className="text-sm text-ink/60">No students in this class.</p>}</div>
      </div>
    </DetailPage>
  )
}
