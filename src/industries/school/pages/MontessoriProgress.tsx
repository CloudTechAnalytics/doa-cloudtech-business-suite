import clsx from 'clsx'
import { Printer } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { NoSetup, fullName, useSchool } from '../components/schoolUi'
import type { SchoolCtx } from '../components/schoolUi'
import { ProgressReportSheet, printProgressReports } from '../components/ProgressReportSheet'
import { loadPhotos, loadProgress, loadProgressNotes, loadRemarks, loadStudents, loadTemplates, loadWorks, progressReport, recordProgress, saveProgressNote, saveRemarks } from '../services/schoolApi'
import type { ProgressStatus, SRemark, SStudent } from '../services/schoolApi'

const CHOICES: [ProgressStatus | '', string, string][] = [
  ['', 'Not yet', 'bg-white text-ink/60 ring-ink/15'],
  ['introduced', 'Introduced', 'bg-accent text-white ring-accent'],
  ['practising', 'Practising', 'bg-amber text-ink ring-amber'],
  ['mastered', 'Mastered', 'bg-success text-white ring-success'],
]

/** The areas (curriculum areas) a given environment works in. */
const areasOf = (ctx: SchoolCtx, classId: string) => (ctx.s?.classSubjects ?? []).filter((x) => x.classId === classId).map((x) => ctx.s!.subjects.find((y) => y.id === x.subjectId)).filter((x): x is NonNullable<typeof x> => !!x && x.levels.includes('montessori')).sort((a, b) => a.name.localeCompare(b.name))

/**
 * Where a Montessori school records and reports progress, in place of exams: guides note which works each child has been introduced to, is practising, or has mastered,
 * write a note per area, and the school prints a narrative progress report each term.
 */
export function MontessoriProgress() {
  const ctx = useSchool()
  const { businessId, s, classes, active } = ctx
  const [tab, setTab] = useState<'record' | 'child' | 'reports'>('record')
  const students = useAsync(() => loadStudents(businessId), [businessId])
  const works = useAsync(() => loadWorks(businessId), [businessId])
  const progress = useAsync(() => loadProgress(businessId), [businessId])
  const notes = useAsync(() => loadProgressNotes(businessId), [businessId])
  const [cls, setCls] = useState('')
  if (!active) return null
  const classId = cls || classes.find((c) => (students.data ?? []).some((x) => x.classId === c.id && x.status === 'active'))?.id || classes[0]?.id || ''
  const roster = (students.data ?? []).filter((x) => x.status === 'active' && x.classId === classId)
  const canRecord = ctx.can('school.results.enter') || ctx.can('school.manage')
  const refresh = async () => { await Promise.all([progress.refresh(), notes.refresh()]) }
  return (
    <>
      <PageHeader title="Progress & Reports" description="Montessori progress is observed, not marked. Record where each child is on each work, add a note for each area, and print a progress report for the term." />
      {s && !s.classes.length && <NoSetup />}
      <div className="no-print mb-3 flex flex-wrap items-end gap-3">
        <div className="w-60"><SelectField label="Environment" value={classId} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.description ? ` · ${c.description.replace('Ages ', '')}` : ''}</option>)}</SelectField></div>
        <div className="ml-auto flex gap-1">{([['record', 'Record work'], ['child', 'By child'], ['reports', 'Reports']] as const).map(([id, t]) => <Button key={id} variant={tab === id ? 'primary' : 'secondary'} onClick={() => setTab(id)}>{t}</Button>)}</div>
      </div>
      {(students.error || works.error) && <ErrorState message={(students.error ?? works.error)!} />}
      {students.loading || works.loading || progress.loading ? <Spinner /> : !roster.length ? <Card><EmptyState title="No children in this environment" description="Register children and place them in an environment under Students." /></Card> : (
        <>
          {tab === 'record' && <RecordTab ctx={ctx} classId={classId} roster={roster} works={works.data ?? []} progress={progress.data ?? []} canRecord={canRecord} onSaved={refresh} />}
          {tab === 'child' && <ChildTab ctx={ctx} classId={classId} roster={roster} works={works.data ?? []} progress={progress.data ?? []} notes={notes.data ?? []} canRecord={canRecord} onSaved={refresh} />}
          {tab === 'reports' && <ReportsTab ctx={ctx} roster={roster} />}
        </>
      )}
    </>
  )
}

function RecordTab({ ctx, classId, roster, works, progress, canRecord, onSaved }: { ctx: SchoolCtx; classId: string; roster: SStudent[]; works: Awaited<ReturnType<typeof loadWorks>>; progress: Awaited<ReturnType<typeof loadProgress>>; canRecord: boolean; onSaved: () => Promise<void> }) {
  const areas = areasOf(ctx, classId)
  const [areaPick, setArea] = useState(''); const [workPick, setWork] = useState('')
  const area = areas.find((a) => a.id === areaPick) ?? areas[0]
  const list = works.filter((w) => w.subjectId === area?.id)
  const work = list.find((w) => w.id === workPick) ?? list[0]
  const [edits, setEdits] = useState<Record<string, ProgressStatus | ''>>({})
  const runner = useFormRunner(onSaved)
  const now = (id: string): ProgressStatus | '' => edits[id] ?? progress.find((p) => p.studentId === id && p.workId === work?.id)?.status ?? ''
  const changed = roster.filter((x) => edits[x.id] !== undefined && edits[x.id] !== (progress.find((p) => p.studentId === x.id && p.workId === work?.id)?.status ?? ''))
  if (!areas.length) return <Card><EmptyState title="No curriculum areas for this environment" description="Open the environment under Environments & Areas and choose its areas." /></Card>
  return (
    <Card className="p-0">
      <div className="no-print flex flex-wrap items-end gap-3 border-b border-line p-3">
        <div className="w-52"><SelectField label="Area" value={area?.id ?? ''} onChange={(e) => { setArea(e.target.value); setWork(''); setEdits({}) }}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectField></div>
        <div className="min-w-56 flex-1"><SelectField label="Work" value={work?.id ?? ''} onChange={(e) => { setWork(e.target.value); setEdits({}) }}>{list.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</SelectField></div>
        {canRecord && <div className="flex flex-wrap gap-1.5 pb-0.5 text-xs"><span className="self-center text-ink/55">Everyone:</span>{CHOICES.slice(1).map(([v, t]) => <button key={v} type="button" onClick={() => setEdits(Object.fromEntries(roster.map((x) => [x.id, v])))} className="rounded-full px-2.5 py-1 font-semibold ring-1 ring-ink/15 hover:bg-surface">{t}</button>)}</div>}
      </div>
      {!work ? <div className="p-4"><EmptyState title="No works in this area" description="Add the works under Environments & Areas." /></div> : (
        <ul className="divide-y divide-ink/10">{roster.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <span className="min-w-40 text-sm font-medium">{fullName(x)}</span>
            <span role="radiogroup" aria-label={`${work.name} for ${fullName(x)}`} className="flex flex-wrap gap-1">{CHOICES.map(([v, t, on]) => (
              <button key={v} type="button" role="radio" aria-checked={now(x.id) === v} disabled={!canRecord} onClick={() => setEdits((p) => ({ ...p, [x.id]: v }))}
                className={clsx('rounded-full px-3 py-1 text-xs font-bold ring-1 transition', now(x.id) === v ? on : 'bg-white text-ink/50 ring-ink/10 hover:bg-surface')}>{t}</button>
            ))}</span>
          </li>
        ))}</ul>
      )}
      <div className="space-y-2 border-t border-line p-3">
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}{runner.ok && <Notice>{runner.ok}</Notice>}
        {canRecord && work && <div className="flex justify-end"><Button disabled={!changed.length} loading={runner.busy} onClick={() => void runner.run(async () => { const e = await recordProgress(ctx.businessId, work.id, changed.map((x) => ({ studentId: x.id, status: (edits[x.id] || null) as ProgressStatus | null }))); if (!e) setEdits({}); return e }, 'Progress saved.')}>Save{changed.length ? ` (${changed.length})` : ''}</Button></div>}
      </div>
    </Card>
  )
}

function ChildTab({ ctx, classId, roster, works, progress, notes, canRecord, onSaved }: { ctx: SchoolCtx; classId: string; roster: SStudent[]; works: Awaited<ReturnType<typeof loadWorks>>; progress: Awaited<ReturnType<typeof loadProgress>>; notes: Awaited<ReturnType<typeof loadProgressNotes>>; canRecord: boolean; onSaved: () => Promise<void> }) {
  const [pick, setPick] = useState(''); const [term, setTerm] = useState(ctx.currentTerm?.id ?? '')
  const child = roster.find((x) => x.id === pick) ?? roster[0]
  const areas = areasOf(ctx, classId)
  const [open, setOpen] = useState<string | null>(null)
  const runner = useFormRunner(onSaved)
  const [draft, setDraft] = useState<Record<string, string>>({})
  if (!child) return null
  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-end gap-3">
        <div className="w-60"><SelectField label="Child" value={child.id} onChange={(e) => { setPick(e.target.value); setDraft({}) }}>{roster.map((x) => <option key={x.id} value={x.id}>{fullName(x)}</option>)}</SelectField></div>
        <div className="w-44"><SelectField label="Term (for the notes)" value={term} onChange={(e) => setTerm(e.target.value)}>{(ctx.s?.terms ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField></div>
      </div>
      {runner.error && <ErrorState title="Not saved" message={runner.error} />}
      {areas.map((a) => {
        const list = works.filter((w) => w.subjectId === a.id)
        const status = (wid: string) => progress.find((p) => p.studentId === child.id && p.workId === wid)?.status ?? ''
        const counts = { mastered: list.filter((w) => status(w.id) === 'mastered').length, practising: list.filter((w) => status(w.id) === 'practising').length, introduced: list.filter((w) => status(w.id) === 'introduced').length }
        const noteKey = `${child.id}|${term}|${a.id}`; const saved = notes.find((n) => n.studentId === child.id && n.termId === term && n.subjectId === a.id)?.note ?? ''
        return (
          <Card key={a.id} className="p-0">
            <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left">
              <span className="font-bold">{a.name}</span>
              <span className="flex flex-wrap gap-1.5 text-xs"><Badge tone="success">{counts.mastered} mastered</Badge><Badge tone="warning">{counts.practising} practising</Badge><Badge tone="info">{counts.introduced} introduced</Badge><span className="self-center text-ink/50">of {list.length}</span></span>
            </button>
            {open === a.id && (
              <div className="space-y-3 border-t border-line p-4">
                <ul className="divide-y divide-ink/10 text-sm">{list.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-40 font-medium">{w.name}</span>
                    <select aria-label={`${w.name} for ${fullName(child)}`} disabled={!canRecord} value={status(w.id)} onChange={(e) => void runner.run(async () => recordProgress(ctx.businessId, w.id, [{ studentId: child.id, status: (e.target.value || null) as ProgressStatus | null }]), 'Saved.')} className="rounded-md border border-line bg-white px-2 py-1 text-sm">{CHOICES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></li>
                ))}</ul>
                <TextField label={`Note about ${child.first} in ${a.name} (printed on the report)`} disabled={!canRecord} value={draft[noteKey] ?? saved} onChange={(e) => setDraft({ ...draft, [noteKey]: e.target.value })} onBlur={() => { if (draft[noteKey] !== undefined && draft[noteKey] !== saved) void runner.run(async () => saveProgressNote(ctx.businessId, child.id, term, a.id, draft[noteKey]), 'Note saved.') }} maxLength={600} />
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function ReportsTab({ ctx, roster }: { ctx: SchoolCtx; roster: SStudent[] }) {
  const [term, setTerm] = useState(ctx.currentTerm?.id ?? '')
  const [openFor, setOpenFor] = useState<string | null>(null)
  const remarks = useAsync(() => loadRemarks(ctx.businessId).catch(() => []), [ctx.businessId])
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  async function printAll() {
    setBusy(true); setError(null)
    try {
      const photos = await loadPhotos(ctx.businessId, roster.map((x) => x.id))
      const items = await Promise.all(roster.map(async (x) => ({ r: await progressReport(ctx.businessId, x.id, term).catch(() => null), p: photos[x.id] ?? null })))
      const have = items.filter((i) => i.r)
      if (!have.length) setError('There is nothing to print for this term yet.'); else printProgressReports(have.map((i) => i.r!), have.map((i) => i.p))
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  return (
    <Card className="p-0">
      <div className="no-print flex flex-wrap items-end justify-between gap-3 border-b border-line p-3">
        <div className="w-48"><SelectField label="Term" value={term} onChange={(e) => setTerm(e.target.value)}>{(ctx.s?.terms ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField></div>
        <Button loading={busy} onClick={() => void printAll()}><Printer className="size-4" aria-hidden /> Print all progress reports</Button>
      </div>
      {error && <div className="p-3"><ErrorState title="Not printed" message={error} /></div>}
      <ul className="divide-y divide-ink/10 text-sm">{roster.map((x) => <li key={x.id} className="flex items-center justify-between p-3"><span>{fullName(x)} <span className="text-xs text-ink/60">{x.admissionNo}</span></span><Button variant="secondary" onClick={() => setOpenFor(x.id)}>View report</Button></li>)}</ul>
      {openFor && <ReportDialog ctx={ctx} studentId={openFor} termId={term} remarks={remarks.data ?? []} onClose={() => setOpenFor(null)} onSaved={remarks.refresh} />}
    </Card>
  )
}

/** A child's progress report, with the guide's overall comment, the head's comment and the decision about the next environment. */
function ReportDialog({ ctx, studentId, termId, remarks, onClose, onSaved }: { ctx: SchoolCtx; studentId: string; termId: string; remarks: SRemark[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { businessId, can } = ctx
  const report = useAsync(() => progressReport(businessId, studentId, termId), [businessId, studentId, termId])
  const photo = useAsync(async () => (await loadPhotos(businessId, [studentId]))[studentId] ?? null, [businessId, studentId])
  const templates = useAsync(() => loadTemplates(businessId), [businessId])
  const mine = remarks.find((r) => r.studentId === studentId && r.termId === termId)
  const [teacher, setTeacher] = useState(mine?.teacherRemark ?? ''); const [principal, setPrincipal] = useState(mine?.principalRemark ?? ''); const [promo, setPromo] = useState<string>(mine?.promotion ?? '')
  const runner = useFormRunner(async () => { await onSaved(); await report.refresh() })
  const writer = can('school.teach') || can('school.manage')
  const pick = (kind: 'teacher' | 'principal', set: (v: string) => void) => { const list = (templates.data ?? []).filter((x) => x.kind === kind); return list.length ? <select aria-label={`Insert a ${kind} comment`} value="" onChange={(e) => { if (e.target.value) set(e.target.value) }} className="-mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink/70"><option value="">Insert a ready-made comment…</option>{list.map((x) => <option key={x.id} value={x.text}>{x.text}</option>)}</select> : null }
  return (
    <Dialog title="Progress report" onClose={onClose} wide>
      {report.loading ? <Spinner /> : report.error ? <ErrorState message={report.error} /> : report.data && (
        <div className="space-y-4">
          <ProgressReportSheet report={report.data} photo={photo.data} />
          {writer && (
            <div className="no-print space-y-3 border-t border-line pt-3">
              <TextField label="Guide's overall comment" value={teacher} onChange={(e) => setTeacher(e.target.value)} />{pick('teacher', setTeacher)}
              {can('school.manage') && <><TextField label="Head's comment" value={principal} onChange={(e) => setPrincipal(e.target.value)} />{pick('principal', setPrincipal)}
                <SelectField label="Next environment" value={promo} onChange={(e) => setPromo(e.target.value)}><option value="">Not decided</option><option value="promoted">Moves up</option><option value="repeat">Stays in this environment</option><option value="graduate">Leaves (graduates)</option></SelectField></>}
              {runner.error && <ErrorState title="Not saved" message={runner.error} />}{runner.ok && <Notice>{runner.ok}</Notice>}
              <Button variant="secondary" loading={runner.busy} onClick={() => void runner.run(async () => saveRemarks(businessId, studentId, termId, teacher, principal, (promo || null) as SRemark['promotion']), 'Comments saved.')}>Save comments</Button>
            </div>
          )}
          <div className="no-print flex justify-end gap-2"><Button variant="secondary" onClick={() => printProgressReports([report.data!], [photo.data])}><Printer className="size-4" aria-hidden /> Print</Button><Button onClick={onClose}>Close</Button></div>
        </div>
      )}
    </Dialog>
  )
}

/** One child's progress report for one term, with a print button: used on the student's profile and in the parent portal. */
export function ProgressReportView({ businessId, studentId, termId }: { businessId: string; studentId: string; termId: string }) {
  const report = useAsync(() => (termId ? progressReport(businessId, studentId, termId).catch(() => null) : Promise.resolve(null)), [businessId, studentId, termId])
  const photo = useAsync(async () => (await loadPhotos(businessId, [studentId]))[studentId] ?? null, [businessId, studentId])
  if (report.loading) return <Spinner />
  if (!report.data) return <p className="text-sm text-ink/60">No progress report for this term yet.</p>
  return (
    <div className="space-y-2">
      <div className="no-print flex justify-end"><Button variant="secondary" onClick={() => printProgressReports([report.data!], [photo.data])}><Printer className="size-4" aria-hidden /> Print progress report</Button></div>
      <ProgressReportSheet report={report.data} photo={photo.data} />
    </div>
  )
}
