import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label } from '@/shared/utilities/format'
import { NoSetup, useSchool } from '../components/schoolUi'
import { apply, decideAdmission, loadAdmissions } from '../services/schoolApi'
import type { SAdmission } from '../services/schoolApi'

const TONE = { pending: 'warning', accepted: 'success', rejected: 'danger' } as const

/** Applications for a place. Accepting one creates the student, links the parent and makes the admission bill, all together. */
export function SchoolAdmissionsPage() {
  const ctx = useSchool()
  const { businessId, s, can, classes, className, active } = ctx
  const list = useAsync(() => loadAdmissions(businessId), [businessId])
  const [adding, setAdding] = useState(false); const [openId, setOpenId] = useState<string | null>(null); const [status, setStatus] = useState('')
  if (!active) return null
  const rows = (list.data ?? []).filter((a) => !status || a.status === status)
  const open = list.data?.find((a) => a.id === openId) ?? null
  return (
    <>
      <PageHeader title="Admissions" description="Applications for a place at the school. Review each one, then accept or decline it."
        actions={can('school.students') ? <Button onClick={() => setAdding(true)}><UserPlus className="size-4" aria-hidden /> New application</Button> : undefined} />
      {s && !s.classes.length && <NoSetup />}
      {list.error && <ErrorState message={list.error} />}
      <div className="mb-3 w-44"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{Object.keys(TONE).map((x) => <option key={x} value={x}>{label(x)}</option>)}</SelectField></div>
      {list.loading ? <Spinner /> : !rows.length ? <Card><EmptyState title="No applications" description="New applications will show here." /></Card> : (
        <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Applicant</th><th className="p-3">Class applied for</th><th className="p-3">Parent or guardian</th><th className="p-3">Received</th><th className="p-3">Status</th></tr></thead>
          <tbody className="divide-y divide-ink/10">{rows.map((a) => <tr key={a.id} onClick={() => setOpenId(a.id)} className="cursor-pointer hover:bg-surface"><td className="p-3 font-medium">{a.first} {a.last}</td><td className="p-3">{className(a.classId)}</td><td className="p-3">{a.guardianName}</td><td className="p-3">{a.createdAt.slice(0, 10)}</td><td className="p-3"><Badge tone={TONE[a.status]}>{label(a.status)}</Badge></td></tr>)}</tbody></table></Card>
      )}
      {adding && <ApplyDialog ctx={ctx} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await list.refresh() }} />}
      {open && <Decision ctx={ctx} a={open} classes={classes} onClose={() => setOpenId(null)} onChanged={list.refresh} />}
    </>
  )
}

function ApplyDialog({ ctx, onClose, onSaved }: { ctx: ReturnType<typeof useSchool>; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved); const [problem, setProblem] = useState<string | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const g = (k: string) => String(f.get(k) ?? '').trim()
    if (!g('first') || !g('last')) return setProblem('Enter the applicant\'s first and last name.')
    if (!g('guardian')) return setProblem('Enter the parent or guardian\'s name.')
    setProblem(null)
    await runner.run((k) => apply(ctx.businessId, { first: g('first'), last: g('last'), dob: g('dob'), gender: g('gender'), classId: g('class') || null, guardianName: g('guardian'), guardianPhone: g('phone'), guardianEmail: g('email'), relationship: g('rel') || 'parent' }, k), 'Application saved.')
  }
  return (
    <Dialog title="New application" onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3"><TextField label="First name" name="first" autoFocus /><TextField label="Last name" name="last" /><TextField label="Date of birth" name="dob" type="date" />
          <SelectField label="Gender" name="gender"><option value="">Not stated</option><option value="female">Female</option><option value="male">Male</option></SelectField>
          <SelectField label="Class applied for" name="class"><option value="">Not decided</option>{ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField><div />
          <TextField label="Parent or guardian" name="guardian" /><TextField label="Phone" name="phone" /><TextField label="Email" name="email" type="email" /><TextField label="Relationship" name="rel" placeholder="mother, father, guardian" /></div>
        {(problem || runner.error) && <ErrorState title="Not saved" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Save application</Button></div>
      </form>
    </Dialog>
  )
}

function Decision({ ctx, a, classes, onClose, onChanged }: { ctx: ReturnType<typeof useSchool>; a: SAdmission; classes: { id: string; name: string }[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const runner = useFormRunner(onChanged)
  const [cls, setCls] = useState(a.classId ?? ''); const [note, setNote] = useState('')
  const decide = ctx.can('school.students') && a.status === 'pending'
  return (
    <DetailPage title={`${a.first} ${a.last}`} onClose={onClose}>
      <p className="mb-3 text-sm"><Badge tone={TONE[a.status]}>{label(a.status)}</Badge> {a.decidedOn && `on ${a.decidedOn}`} {a.decisionNote && `· ${a.decisionNote}`}</p>
      <dl className="grid gap-4 text-sm sm:grid-cols-3">{([['Date of birth', a.dob ?? '–'], ['Gender', a.gender ? label(a.gender) : '–'], ['Class applied for', ctx.className(a.classId)], ['Parent or guardian', `${a.guardianName} (${a.relationship})`], ['Phone', a.guardianPhone ?? '–'], ['Email', a.guardianEmail ?? '–']] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-ink/60">{k}</dt><dd>{v}</dd></div>)}</dl>
      {decide && (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          <SelectField label="Place in class" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">Select…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
          <TextField label="Note (needed to decline)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Notice>Accepting registers the student, links the parent and creates the admission bill if admission fees are set up.</Notice>
          {runner.error && <ErrorState title="Not saved" message={runner.error} />}
          <div className="flex gap-2"><Button disabled={!cls} loading={runner.busy} onClick={() => void runner.run(async () => decideAdmission(ctx.businessId, a.id, 'accept', cls, note), 'Accepted.')}>Accept</Button><Button variant="secondary" disabled={note.trim().length < 3} loading={runner.busy} onClick={() => void runner.run(async () => decideAdmission(ctx.businessId, a.id, 'reject', null, note), 'Declined.')}>Decline</Button></div>
        </div>
      )}
    </DetailPage>
  )
}
