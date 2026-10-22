import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { fullName, useSchool } from '../components/schoolUi'
import { linkGuardian, loadGuardians, loadStudents, saveGuardian } from '../services/schoolApi'
import type { SGuardian } from '../services/schoolApi'

/** Parents and guardians, and which children each one is linked to. A parent signs in with the email recorded here. */
export function SchoolGuardiansPage() {
  const ctx = useSchool()
  const { businessId, can, active } = ctx
  const data = useAsync(() => loadGuardians(businessId), [businessId])
  const students = useAsync(() => loadStudents(businessId), [businessId])
  const [q, setQ] = useState(''); const [editing, setEditing] = useState<SGuardian | 'new' | null>(null); const [openId, setOpenId] = useState<string | null>(null)
  if (!active) return null
  const kids = (id: string) => (data.data?.links ?? []).filter((l) => l.guardianId === id)
  const list = (data.data?.guardians ?? []).filter((g) => !q.trim() || (g.name + (g.phone ?? '') + (g.email ?? '')).toLowerCase().includes(q.trim().toLowerCase()))
  const open = data.data?.guardians.find((g) => g.id === openId) ?? null
  const refresh = async () => { await data.refresh() }
  return (
    <>
      <PageHeader title="Parents & Guardians" description="The people responsible for each student. Link a parent to their children so they can see attendance, published results and fees in the parent portal."
        actions={can('school.students') ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add parent or guardian</Button> : undefined} />
      {data.error && <ErrorState message={data.error} />}
      <div className="mb-3 w-64"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or email" /></div>
      {data.loading ? <Spinner /> : !list.length ? <Card><EmptyState title="No parents or guardians" description="Add one here, or when registering a student." /></Card> : (
        <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Name</th><th className="p-3">Phone</th><th className="p-3">Email</th><th className="p-3">Children</th><th className="p-3">Portal</th></tr></thead>
          <tbody className="divide-y divide-ink/10">{list.map((g) => <tr key={g.id} onClick={() => setOpenId(g.id)} className="cursor-pointer hover:bg-surface"><td className="p-3 font-medium">{g.name}</td><td className="p-3">{g.phone ?? '–'}</td><td className="p-3">{g.email ?? '–'}</td><td className="p-3">{kids(g.id).length}</td><td className="p-3"><Badge tone={g.userId ? 'success' : 'neutral'}>{g.userId ? 'Signed in before' : 'Not yet'}</Badge></td></tr>)}</tbody></table></Card>
      )}
      {editing && <GuardianDialog ctx={ctx} g={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />}
      {open && <Profile ctx={ctx} g={open} links={kids(open.id)} students={students.data ?? []} onClose={() => setOpenId(null)} onChanged={refresh} onEdit={() => setEditing(open)} />}
    </>
  )
}

function GuardianDialog({ ctx, g, onClose, onSaved }: { ctx: ReturnType<typeof useSchool>; g: SGuardian | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); const v = (k: string) => String(f.get(k) ?? '').trim(); await runner.run(async () => saveGuardian(ctx.businessId, { id: g?.id ?? null, name: v('name'), phone: v('phone'), email: v('email'), address: v('address') }), 'Saved.') }
  return (
    <Dialog title={g ? 'Edit parent or guardian' : 'Add parent or guardian'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <TextField label="Name" name="name" defaultValue={g?.name} autoFocus /><TextField label="Phone" name="phone" defaultValue={g?.phone ?? ''} /><TextField label="Email (used to sign in to the parent portal)" name="email" type="email" defaultValue={g?.email ?? ''} /><TextField label="Address" name="address" defaultValue={g?.address ?? ''} />
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Save</Button></div>
      </form>
    </Dialog>
  )
}

function Profile({ ctx, g, links, students, onClose, onChanged, onEdit }: { ctx: ReturnType<typeof useSchool>; g: SGuardian; links: { studentId: string; relationship: string; isPrimary: boolean }[]; students: Awaited<ReturnType<typeof loadStudents>>; onClose: () => void; onChanged: () => Promise<void>; onEdit: () => void }) {
  const runner = useFormRunner(onChanged)
  const [pick, setPick] = useState(''); const [rel, setRel] = useState('parent')
  const edit = ctx.can('school.students')
  const free = students.filter((x) => !links.some((l) => l.studentId === x.id))
  return (
    <DetailPage title={g.name} onClose={onClose} actions={edit ? <Button variant="secondary" onClick={onEdit}>Edit</Button> : undefined}>
      <dl className="mb-4 grid gap-4 text-sm sm:grid-cols-3">{([['Phone', g.phone ?? '–'], ['Email', g.email ?? '–'], ['Address', g.address ?? '–']] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-ink/60">{k}</dt><dd>{v}</dd></div>)}</dl>
      <h3 className="mb-1 text-sm font-semibold">Children</h3>
      {links.length ? <ul className="divide-y divide-ink/10 text-sm">{links.map((l) => { const st = students.find((x) => x.id === l.studentId); return <li key={l.studentId} className="flex items-center justify-between py-2"><span>{st ? fullName(st) : 'Student'} <Badge>{l.relationship}</Badge> {l.isPrimary && <Badge tone="info">Primary</Badge>} <span className="text-ink/60">{ctx.className(st?.classId ?? null)}</span></span>{edit && <Button variant="secondary" loading={runner.busy} onClick={() => void runner.run(async () => linkGuardian(ctx.businessId, l.studentId, g.id, l.relationship, l.isPrimary, true), 'Unlinked.')}>Unlink</Button>}</li> })}</ul> : <p className="text-sm text-ink/60">Not linked to any student yet.</p>}
      {edit && <div className="mt-4 space-y-3 border-t border-line pt-3"><div className="grid gap-3 sm:grid-cols-2"><SelectField label="Link to a student" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Select…</option>{free.map((x) => <option key={x.id} value={x.id}>{fullName(x)} ({x.admissionNo})</option>)}</SelectField><TextField label="Relationship" value={rel} onChange={(e) => setRel(e.target.value)} /></div>
        {runner.error && <ErrorState title="Not linked" message={runner.error} />}{runner.ok && <Notice>{runner.ok}</Notice>}
        <Button disabled={!pick} loading={runner.busy} onClick={() => void runner.run(async () => linkGuardian(ctx.businessId, pick, g.id, rel || 'parent', links.length === 0), 'Linked.', () => setPick(''))}>Link student</Button></div>}
    </DetailPage>
  )
}
