import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { useSchool } from '../components/schoolUi'
import { cancelLogin, giveLogin, loadStaff, loadStaffAccess, saveStaff, setAssignments } from '../services/schoolApi'
import type { SStaff, StaffAccess } from '../services/schoolApi'

const ROLE_NAMES: Record<string, string> = { teacher: 'Teacher', bursar: 'Bursar', admissions_officer: 'Admissions officer', principal: 'Principal' }
const roleLabel = (r: string | null) => (r ? ROLE_NAMES[r] ?? r : '')

/** Teachers and other staff, and which classes and subjects each teacher is responsible for. A teacher can only reach what is assigned here. */
export function SchoolStaffPage() {
  const ctx = useSchool()
  const { businessId, can, active } = ctx
  const data = useAsync(() => loadStaff(businessId), [businessId])
  const access = useAsync(() => (can('school.manage') ? loadStaffAccess(businessId) : Promise.resolve([] as StaffAccess[])), [businessId])
  const accessOf = (id: string) => access.data?.find((a) => a.staffId === id) ?? null
  const refreshAll = async () => { await Promise.all([data.refresh(), access.refresh()]) }
  const [editing, setEditing] = useState<SStaff | 'new' | null>(null); const [openId, setOpenId] = useState<string | null>(null)
  if (!active) return null
  const manage = can('school.manage')
  const open = data.data?.staff.find((x) => x.id === openId) ?? null
  const count = (id: string) => (data.data?.assignments ?? []).filter((a) => a.staffId === id).length
  return (
    <>
      <PageHeader title="Teachers & Staff" description="Everyone who works at the school. Not everyone needs to sign in: a cleaner or driver is just a record. For a teacher or other staff who should sign in, record their email and give them access. They choose their own password."
        actions={manage ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add staff</Button> : undefined} />
      {data.error && <ErrorState message={data.error} />}
      {data.loading ? <Spinner /> : !data.data?.staff.length ? <Card><EmptyState title="No staff yet" description="Add the teachers and other staff." /></Card> : (
        <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Staff no</th><th className="p-3">Name</th><th className="p-3">Job</th><th className="p-3">Contact</th><th className="p-3">Assignments</th><th className="p-3">Sign-in</th><th className="p-3">Status</th></tr></thead>
          <tbody className="divide-y divide-ink/10">{data.data.staff.map((x) => <tr key={x.id} onClick={() => setOpenId(x.id)} className="cursor-pointer hover:bg-surface"><td className="p-3">{x.staffNo}</td><td className="p-3 font-medium">{x.name}</td><td className="p-3">{x.jobTitle ?? '–'}</td><td className="p-3">{[x.phone, x.email].filter(Boolean).join(' · ') || '–'}</td><td className="p-3">{count(x.id)}</td><td className="p-3">{accessBadge(accessOf(x.id))}</td><td className="p-3"><Badge tone={x.status === 'active' ? 'success' : 'neutral'}>{x.status === 'active' ? 'Active' : 'Not working here'}</Badge></td></tr>)}</tbody></table></Card>
      )}
      {editing && <StaffDialog ctx={ctx} v={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refreshAll() }} />}
      {open && <Assign ctx={ctx} staff={open} access={accessOf(open.id)} onAccess={refreshAll} assignments={(data.data?.assignments ?? []).filter((a) => a.staffId === open.id)} manage={manage} onClose={() => setOpenId(null)} onEdit={() => setEditing(open)} onChanged={data.refresh} />}
    </>
  )
}

function accessBadge(a: StaffAccess | null) {
  if (!a || a.state === 'none') return <span className="text-xs text-ink/50">No login</span>
  return a.state === 'signed_in' ? <Badge tone="success">Can sign in{a.role ? ' · ' + roleLabel(a.role) : ''}</Badge> : <Badge tone="warning">Invited · {roleLabel(a.role)}</Badge>
}

function StaffDialog({ ctx, v, onClose, onSaved }: { ctx: ReturnType<typeof useSchool>; v: SStaff | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); const g = (k: string) => String(f.get(k) ?? '').trim(); await runner.run(async () => saveStaff(ctx.businessId, { id: v?.id ?? null, name: g('name'), phone: g('phone'), email: g('email'), jobTitle: g('title'), department: g('dept'), active: f.get('active') === 'on' }), 'Saved.') }
  return (
    <Dialog title={v ? 'Edit staff' : 'Add staff'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <TextField label="Name" name="name" defaultValue={v?.name} autoFocus /><div className="grid gap-3 sm:grid-cols-2"><TextField label="Phone" name="phone" defaultValue={v?.phone ?? ''} /><TextField label="Email" name="email" type="email" defaultValue={v?.email ?? ''} /><TextField label="Job title" name="title" defaultValue={v?.jobTitle ?? ''} placeholder="Teacher, Bursar, Cleaner" /><TextField label="Department" name="dept" defaultValue={v?.department ?? ''} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={v ? v.status === 'active' : true} /> Still working here</label>
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Save</Button></div>
      </form>
    </Dialog>
  )
}

function Assign({ ctx, staff, access, onAccess, assignments, manage, onClose, onEdit, onChanged }: { ctx: ReturnType<typeof useSchool>; staff: SStaff; access: StaffAccess | null; onAccess: () => Promise<void>; assignments: { classId: string; subjectId: string | null; classTeacher: boolean }[]; manage: boolean; onClose: () => void; onEdit: () => void; onChanged: () => Promise<void> }) {
  const runner = useFormRunner(onChanged)
  const [rows, setRows] = useState(assignments.map((a) => ({ ...a })))
  const [cls, setCls] = useState(''); const [sub, setSub] = useState('')
  return (
    <DetailPage title={staff.name} onClose={onClose} actions={manage ? <Button variant="secondary" onClick={onEdit}>Edit</Button> : undefined}>
      <p className="mb-3 text-sm text-ink/70">{staff.staffNo} · {staff.jobTitle ?? 'Staff'} · {[staff.phone, staff.email].filter(Boolean).join(' · ') || 'No contact'}</p>
      <SignInAccess ctx={ctx} staff={staff} access={access} manage={manage} onChanged={onAccess} />
      <h3 className="mb-1 text-sm font-semibold">Classes and subjects</h3>
      {rows.length ? <ul className="divide-y divide-ink/10 text-sm">{rows.map((r, i) => <li key={i} className="flex items-center justify-between py-1.5"><span>{ctx.className(r.classId)} · {r.subjectId ? ctx.subjectName(r.subjectId) : 'Class teacher only'}{r.classTeacher && <> <Badge tone="info">Class teacher</Badge></>}</span>{manage && <Button variant="secondary" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>}</li>)}</ul> : <p className="text-sm text-ink/60">Nothing assigned. This person cannot reach any class records.</p>}
      {manage && (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          <div className="grid gap-3 sm:grid-cols-2"><SelectField label="Class" value={cls} onChange={(e) => { setCls(e.target.value); setSub('') }}><option value="">Select…</option>{ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
            <SelectField label="Subject" value={sub} onChange={(e) => setSub(e.target.value)}><option value="">None (class teacher only)</option>{(ctx.s?.classSubjects ?? []).filter((x) => x.classId === cls).map((x) => <option key={x.subjectId} value={x.subjectId}>{ctx.subjectName(x.subjectId)}</option>)}</SelectField></div>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={!cls} onClick={() => { setRows([...rows, { classId: cls, subjectId: sub || null, classTeacher: !sub }]); setSub('') }}><Plus className="size-4" aria-hidden /> Add</Button></div>
          {runner.error && <ErrorState title="Not saved" message={runner.error} />}{runner.ok && <Notice>{runner.ok}</Notice>}
          <Button loading={runner.busy} onClick={() => void runner.run(async () => setAssignments(ctx.businessId, staff.id, rows), 'Assignments saved.')}>Save assignments</Button>
        </div>
      )}
    </DetailPage>
  )
}

/** Optional sign-in for a staff member. They get an invitation by email, sign up with it and choose their own password; nobody else sets or sees it. */
function SignInAccess({ ctx, staff, access, manage, onChanged }: { ctx: ReturnType<typeof useSchool>; staff: SStaff; access: StaffAccess | null; manage: boolean; onChanged: () => Promise<void> }) {
  const runner = useFormRunner(onChanged)
  const [role, setRole] = useState(/teach/i.test(staff.jobTitle ?? '') || !staff.jobTitle ? 'teacher' : /burs/i.test(staff.jobTitle ?? '') ? 'bursar' : /admission/i.test(staff.jobTitle ?? '') ? 'admissions_officer' : 'teacher')
  const state = access?.state ?? 'none'
  return (
    <section className="mb-4 rounded-lg border border-line bg-surface p-3 text-sm" aria-label="Sign-in access">
      <h3 className="mb-1 font-semibold">Sign-in access</h3>
      {state === 'signed_in' && <p>{staff.name} can sign in{access?.role ? ' as ' + roleLabel(access.role) : ''}. To change or remove their access, use Staff &amp; Roles.</p>}
      {state === 'invited' && (
        <div className="space-y-2"><p>Invited as <b>{roleLabel(access?.role ?? null)}</b>. When {staff.name} signs up with <b>{staff.email}</b> and confirms that email, they are in and linked to this record. They choose their own password.</p>
          {manage && <Button variant="secondary" loading={runner.busy} onClick={() => void runner.run(async () => cancelLogin(ctx.businessId, staff.id), 'Invitation withdrawn.')}>Withdraw invitation</Button>}</div>
      )}
      {state === 'none' && (
        <div className="space-y-2">
          <p className="text-ink/70">No login. That is fine for staff who do not use the system (cleaner, driver, security). {staff.email ? '' : 'To give someone a login, edit their record and add their email first.'}</p>
          {manage && staff.email && (
            <div className="flex flex-wrap items-end gap-2"><div className="w-56"><SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)}>{Object.entries(ROLE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectField></div>
              <Button loading={runner.busy} onClick={() => void runner.run(async () => giveLogin(ctx.businessId, staff.id, role), 'Invitation created. Ask them to sign up with ' + staff.email + '.')}>Give sign-in access</Button></div>
          )}
        </div>
      )}
      {runner.error && <div className="mt-2"><ErrorState title="Not done" message={runner.error} /></div>}{runner.ok && <div className="mt-2"><Notice>{runner.ok}</Notice></div>}
    </section>
  )
}
