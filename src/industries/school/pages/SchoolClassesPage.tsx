import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { NoSetup, fullName, useSchool } from '../components/schoolUi'
import { loadStaff, loadStudents, saveClass, saveHoliday, saveSession, saveSubject, saveTerm, setClassSubjects } from '../services/schoolApi'
import { STAGES, stageOk } from '../services/schoolApi'
import type { SClass, SSession, SSubject, STerm, Stage } from '../services/schoolApi'

type Panel = null | { kind: 'class'; v: SClass | null } | { kind: 'subject'; v: SSubject | null } | { kind: 'session'; v: SSession | null } | { kind: 'term'; v: STerm | null } | { kind: 'holiday' }

/** Academic sessions and terms, classes, subjects, which subjects each class takes, and school holidays. */
export function SchoolClassesPage() {
  const ctx = useSchool()
  const { businessId, s, can, structure, active } = ctx
  const students = useAsync(() => loadStudents(businessId), [businessId])
  const staff = useAsync(() => loadStaff(businessId).catch(() => ({ staff: [], assignments: [] })), [businessId])
  const [panel, setPanel] = useState<Panel>(null); const [openId, setOpenId] = useState<string | null>(null)
  if (!active) return null
  const manage = can('school.manage')
  const done = async () => { setPanel(null); await structure.refresh() }
  const open = s?.classes.find((c) => c.id === openId) ?? null
  return (
    <>
      <PageHeader title="Classes & Subjects" description="The shape of the school year: sessions and terms, the classes, the subjects, and what each class studies." />
      {structure.error && <ErrorState message={structure.error} />}
      {s && !ctx.visibleClasses.length && <NoSetup />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Sessions & terms</h3>{manage && <div className="flex gap-2"><Button variant="secondary" onClick={() => setPanel({ kind: 'session', v: null })}><Plus className="size-4" aria-hidden /> Session</Button><Button variant="secondary" disabled={!s?.sessions.length} onClick={() => setPanel({ kind: 'term', v: null })}><Plus className="size-4" aria-hidden /> Term</Button></div>}</div>
          {s?.sessions.length ? <ul className="space-y-3 text-sm">{s.sessions.map((x) => <li key={x.id}><div className="flex items-center justify-between"><button className="font-medium underline" disabled={!manage} onClick={() => setPanel({ kind: 'session', v: x })}>{x.name}</button><span className="text-ink/60">{x.startsOn} to {x.endsOn} {x.current && <Badge tone="success">Current</Badge>}</span></div>
            <ul className="ml-4 mt-1 divide-y divide-ink/10">{s.terms.filter((t) => t.sessionId === x.id).map((t) => <li key={t.id} className="flex items-center justify-between py-1"><button disabled={!manage} className="underline" onClick={() => setPanel({ kind: 'term', v: t })}>{t.name}</button><span className="text-ink/60">{t.startsOn} to {t.endsOn} {t.current && <Badge tone="success">Current</Badge>}</span></li>)}</ul></li>)}</ul> : <EmptyState title="No sessions yet" />}
        </Card>
        <Card>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Classes</h3>{manage && <Button variant="secondary" onClick={() => setPanel({ kind: 'class', v: null })}><Plus className="size-4" aria-hidden /> Class</Button>}</div>
          {ctx.visibleClasses.length ? <ul className="divide-y divide-ink/10 text-sm">{ctx.visibleClasses.map((c) => <li key={c.id} className="flex items-center justify-between py-1.5"><button className="font-medium underline" onClick={() => setOpenId(c.id)}>{c.name}</button><span className="text-ink/60">{(students.data ?? []).filter((x) => x.classId === c.id && x.status === 'active').length} students · {(s?.classSubjects ?? []).filter((x) => x.classId === c.id).length} subjects {!c.active && <Badge>Not in use</Badge>}</span></li>)}</ul> : <EmptyState title="No classes yet" />}
        </Card>
        <Card>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Subjects</h3>{manage && <Button variant="secondary" onClick={() => setPanel({ kind: 'subject', v: null })}><Plus className="size-4" aria-hidden /> Subject</Button>}</div>
          {ctx.visibleSubjects.length ? <ul className="flex flex-wrap gap-2 text-sm">{ctx.visibleSubjects.map((x) => <li key={x.id}><button disabled={!manage} onClick={() => setPanel({ kind: 'subject', v: x })} className="rounded-full border border-line px-3 py-1 hover:bg-surface">{x.name}{x.code ? ` (${x.code})` : ''}</button></li>)}</ul> : <EmptyState title="No subjects yet" />}
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
    if (panel.kind === 'class') return { name: panel.v?.name ?? '', level: String(panel.v?.levelOrder ?? ''), arm: panel.v?.arm ?? '', active: panel.v?.active === false ? '' : 'on', stage: panel.v?.stage ?? STAGES.find((st) => stageOk(ctx.kind, st)) ?? 'primary' }
    if (panel.kind === 'subject') return { name: panel.v?.name ?? '', code: panel.v?.code ?? '' }
    if (panel.kind === 'session') return { name: panel.v?.name ?? '', starts: panel.v?.startsOn ?? '', ends: panel.v?.endsOn ?? '', current: panel.v?.current ? 'on' : '' }
    if (panel.kind === 'term') return { session: panel.v?.sessionId ?? ctx.s?.sessions.find((x) => x.current)?.id ?? '', name: panel.v?.name ?? '', starts: panel.v?.startsOn ?? '', ends: panel.v?.endsOn ?? '', current: panel.v?.current ? 'on' : '' }
    return { on: '', name: '' }
  })
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))
  const tick = (k: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.checked ? 'on' : '' }))} /> {k === 'active' ? 'In use' : 'This is the current one'}</label>
  const save = () => {
    if (panel.kind === 'class') return runner.run(async () => saveClass(b, { id: panel.v?.id ?? null, name: f.name.trim(), levelOrder: Number(f.level || 0), arm: f.arm.trim(), active: !!f.active, stage: f.stage as Stage }), 'Saved.')
    if (panel.kind === 'subject') return runner.run(async () => saveSubject(b, { id: panel.v?.id ?? null, name: f.name.trim(), code: f.code.trim() }), 'Saved.')
    if (panel.kind === 'session') return runner.run(async () => saveSession(b, { id: panel.v?.id ?? null, name: f.name.trim(), startsOn: f.starts, endsOn: f.ends, current: !!f.current }), 'Saved.')
    if (panel.kind === 'term') return runner.run(async () => saveTerm(b, { id: panel.v?.id ?? null, sessionId: f.session, name: f.name.trim(), startsOn: f.starts, endsOn: f.ends, current: !!f.current }), 'Saved.')
    return runner.run(async () => saveHoliday(b, f.on, f.name.trim()), 'Saved.')
  }
  const title = { class: 'Class', subject: 'Subject', session: 'Academic session', term: 'Term', holiday: 'Holiday' }[panel.kind]
  return (
    <Dialog title={`${'v' in panel && panel.v ? 'Edit' : 'Add'} ${title.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void save() }} noValidate className="space-y-3">
        {panel.kind === 'term' && <SelectField label="Session" value={f.session} onChange={set('session')}>{(ctx.s?.sessions ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField>}
        {panel.kind === 'holiday' ? <><TextField label="Date" type="date" value={f.on} onChange={set('on')} /><TextField label="Name" value={f.name} onChange={set('name')} placeholder="Independence Day" /></> : <TextField label="Name" value={f.name} onChange={set('name')} autoFocus />}
        {panel.kind === 'class' && <SelectField label="Stage" value={f.stage} onChange={set('stage')}>{STAGES.filter((st) => stageOk(ctx.kind, st)).map((st) => <option key={st} value={st}>{st === 'nursery' ? 'Nursery' : st === 'primary' ? 'Primary' : 'Secondary'}</option>)}</SelectField>}
        {panel.kind === 'class' && <div className="grid gap-3 sm:grid-cols-2"><TextField label="Level order (1 = lowest)" type="number" min={0} value={f.level} onChange={set('level')} /><TextField label="Arm (optional)" value={f.arm} onChange={set('arm')} placeholder="A, B, Gold" /></div>}
        {panel.kind === 'subject' && <TextField label="Short code (optional)" value={f.code} onChange={set('code')} />}
        {(panel.kind === 'session' || panel.kind === 'term') && <div className="grid gap-3 sm:grid-cols-2"><TextField label="Starts" type="date" value={f.starts} onChange={set('starts')} /><TextField label="Ends" type="date" value={f.ends} onChange={set('ends')} /></div>}
        {(panel.kind === 'session' || panel.kind === 'term') && tick('current')}
        {panel.kind === 'class' && tick('active')}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-between gap-2">{panel.kind === 'holiday' ? <HolidayRemove ctx={ctx} onDone={onSaved} /> : <span />}<div className="flex gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Save</Button></div></div>
      </form>
    </Dialog>
  )
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
  return (
    <DetailPage title={c.name} onClose={onClose} wide actions={manage ? <Button variant="secondary" onClick={onEdit}>Edit</Button> : undefined}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div><h3 className="mb-1 text-sm font-semibold">Subjects taken</h3>
          <ul className="space-y-1 text-sm">{ctx.visibleSubjects.map((x) => <li key={x.id}><label className="flex items-center gap-2"><input type="checkbox" disabled={!manage} checked={picked.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((id) => id !== x.id))} /> {x.name}</label></li>)}</ul>
          {manage && <div className="mt-3 space-y-2">{runner.error && <ErrorState title="Not saved" message={runner.error} />}{runner.ok && <Notice>{runner.ok}</Notice>}<Button loading={runner.busy} onClick={() => void runner.run(async () => setClassSubjects(ctx.businessId, c.id, picked), 'Subjects saved.')}>Save subjects</Button></div>}
          <p className="mt-2 text-xs text-ink/60">Removing a subject that already has scores is refused so results are never lost.</p></div>
        <div><h3 className="mb-1 text-sm font-semibold">Teachers</h3>
          {mine.length ? <ul className="divide-y divide-ink/10 text-sm">{mine.map((a) => <li key={a.id} className="py-1.5">{teachers?.staff.find((x) => x.id === a.staffId)?.name ?? 'Teacher'} <span className="text-ink/60">{a.classTeacher ? 'Class teacher' : ''} {a.subjectId ? ctx.subjectName(a.subjectId) : ''}</span></li>)}</ul> : <p className="text-sm text-ink/60">No teachers assigned. Assign them under Teachers & Staff.</p>}
          <h3 className="mb-1 mt-4 text-sm font-semibold">Students ({students.length})</h3>
          {students.length ? <ul className="max-h-60 divide-y divide-ink/10 overflow-auto text-sm">{students.map((x) => <li key={x.id} className="py-1.5">{fullName(x)} <span className="text-ink/60">{x.admissionNo}</span></li>)}</ul> : <p className="text-sm text-ink/60">No students in this class.</p>}</div>
      </div>
    </DetailPage>
  )
}
