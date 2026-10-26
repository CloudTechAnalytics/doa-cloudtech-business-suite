import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { useSchool } from '../components/schoolUi'
import { passwordProblem } from '@/core/auth/AuthPages'
import { ConfirmDelete } from '@/shared/components/ConfirmDelete'
import { addStaffWithLogin, cancelLogin, createLogin, deleteStaff, giveLogin, loadStaff, loadStaffAccess, saveStaff, setAssignments } from '../services/schoolApi'
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
      <PageHeader title="Teachers & Staff" description="Everyone who works at the school. Not everyone needs to sign in: a cleaner or driver is just a record. When you add a teacher or other staff who should sign in, choose &quot;Can sign in&quot;: you set a temporary password and they choose their own at first sign-in."
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

/** A readable temporary password: 12 characters with upper case, lower case and digits, leaving out look-alikes (0/O, 1/l/I). */
function tempPassword() {
  const pick = (chars: string, n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => chars[x % chars.length])
  const all = [...pick('ABCDEFGHJKLMNPQRSTUVWXYZ', 3), ...pick('abcdefghijkmnpqrstuvwxyz', 6), ...pick('23456789', 3)]
  for (let i = all.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [all[i], all[j]] = [all[j], all[i]] }
  return all.join('')
}

/** Role and temporary password for a login that is created straight away. */
function LoginFields({ role, setRole, password, setPassword }: { role: string; setRole: (v: string) => void; password: string; setPassword: (v: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)}>{Object.entries(ROLE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectField>
      <div><TextField label="Temporary password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        <button type="button" className="mt-1 text-xs underline" onClick={() => setPassword(tempPassword())}>Generate another</button></div>
    </div>
  )
}

/** What to hand to the person. The password is shown here once; it is never stored in readable form. */
function Credentials({ name, email, password, onDone }: { name: string; email: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = `Email: ${email}\nTemporary password: ${password}\nYou will be asked to choose your own password when you sign in.`
  return (
    <div className="space-y-3 text-sm">
      <Notice>{name} can now sign in. Give them these details; they will be asked to choose their own password straight away.</Notice>
      <dl className="rounded-lg border border-line bg-surface p-3"><dt className="text-xs text-ink/60">Email</dt><dd className="font-semibold">{email}</dd><dt className="mt-2 text-xs text-ink/60">Temporary password</dt><dd className="font-mono text-base font-bold tracking-wide">{password}</dd></dl>
      <p className="text-xs text-ink/60">This is the only time the password is shown. If it is lost, ask the person to use "Forgot password" on the sign-in page.</p>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true) }}>{copied ? 'Copied' : 'Copy details'}</Button><Button onClick={onDone}>Done</Button></div>
    </div>
  )
}

function accessBadge(a: StaffAccess | null) {
  if (!a || a.state === 'none') return <span className="text-xs text-ink/50">No login</span>
  if (a.state === 'suspended') return <Badge tone="danger">Suspended{a.role ? ' · ' + roleLabel(a.role) : ''}</Badge>
  return a.state === 'signed_in' ? <Badge tone="success">Can sign in{a.role ? ' · ' + roleLabel(a.role) : ''}</Badge> : <Badge tone="warning">Invited · {roleLabel(a.role)}</Badge>
}

function StaffDialog({ ctx, v, onClose, onSaved }: { ctx: ReturnType<typeof useSchool>; v: SStaff | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  const [login, setLogin] = useState(false); const [role, setRole] = useState('teacher'); const [password, setPassword] = useState(() => tempPassword())
  const [done, setDone] = useState<{ name: string; email: string; password: string } | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const g = (k: string) => String(f.get(k) ?? '').trim()
    const value = { id: v?.id ?? null, name: g('name'), phone: g('phone'), email: g('email'), jobTitle: g('title'), department: g('dept'), active: f.get('active') === 'on' }
    const wantLogin = !v && login
    if (wantLogin) {
      if (!value.email) return setError("Enter the email address: it is how they sign in.")
      const bad = passwordProblem(password); if (bad) return setError(bad)
    }
    setBusy(true); setError(null)
    const err = wantLogin ? await addStaffWithLogin(ctx.businessId, value, { role, password }) : await saveStaff(ctx.businessId, value)
    setBusy(false)
    if (err) { setError(err); if (wantLogin) await onSaved().catch(() => undefined); return }
    if (wantLogin) { setDone({ name: value.name, email: value.email, password }); return }
    await onSaved()
  }
  if (done) return <Dialog title="Login created" onClose={() => void onSaved()}><Credentials {...done} onDone={() => void onSaved()} /></Dialog>
  return (
    <Dialog title={v ? 'Edit staff' : 'Add staff'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <TextField label="Name" name="name" defaultValue={v?.name} autoFocus /><div className="grid gap-3 sm:grid-cols-2"><TextField label="Phone" name="phone" defaultValue={v?.phone ?? ''} /><TextField label="Email" name="email" type="email" defaultValue={v?.email ?? ''} /><TextField label="Job title" name="title" defaultValue={v?.jobTitle ?? ''} placeholder="Teacher, Bursar, Cleaner" /><TextField label="Department" name="dept" defaultValue={v?.department ?? ''} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={v ? v.status === 'active' : true} /> Still working here</label>
        {!v && (
          <fieldset className="space-y-2 rounded-lg border border-line bg-surface p-3 text-sm"><legend className="px-1 font-semibold">Sign-in</legend>
            <label className="flex items-start gap-2"><input type="radio" name="login" className="mt-1" checked={!login} onChange={() => setLogin(false)} /><span><b>No login</b><br /><span className="text-ink/60">Just a record. Right for a cleaner, driver or security.</span></span></label>
            <label className="flex items-start gap-2"><input type="radio" name="login" className="mt-1" checked={login} onChange={() => setLogin(true)} /><span><b>Can sign in</b><br /><span className="text-ink/60">Creates their login now with a temporary password. They choose their own at first sign-in.</span></span></label>
            {login && <LoginFields role={role} setRole={setRole} password={password} setPassword={setPassword} />}
          </fieldset>
        )}
        {error && <ErrorState title="Not saved" message={error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{!v && login ? 'Save and create login' : 'Save'}</Button></div>
      </form>
    </Dialog>
  )
}

function Assign({ ctx, staff, access, onAccess, assignments, manage, onClose, onEdit, onChanged }: { ctx: ReturnType<typeof useSchool>; staff: SStaff; access: StaffAccess | null; onAccess: () => Promise<void>; assignments: { classId: string; subjectId: string | null; classTeacher: boolean }[]; manage: boolean; onClose: () => void; onEdit: () => void; onChanged: () => Promise<void> }) {
  const runner = useFormRunner(onChanged)
  const [rows, setRows] = useState(assignments.map((a) => ({ ...a })))
  const [selClasses, setSelClasses] = useState<string[]>([]); const [selSubjects, setSelSubjects] = useState<string[]>([]); const [alsoClassTeacher, setAlsoClassTeacher] = useState(false)
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const classSubjects = ctx.s?.classSubjects ?? []
  // Only subjects that at least one of the chosen classes studies can be picked; each is added to the chosen classes that study it.
  const subjectChoices = ctx.visibleSubjects.filter((x) => classSubjects.some((cs) => cs.subjectId === x.id && selClasses.includes(cs.classId)))
  const additions = (): { classId: string; subjectId: string | null; classTeacher: boolean }[] => {
    const have = (c: string, s: string | null) => rows.some((r) => r.classId === c && r.subjectId === s)
    const out: { classId: string; subjectId: string | null; classTeacher: boolean }[] = []
    for (const c of selClasses) {
      const subs = selSubjects.filter((s) => classSubjects.some((cs) => cs.classId === c && cs.subjectId === s))
      for (const s of subs) if (!have(c, s)) out.push({ classId: c, subjectId: s, classTeacher: alsoClassTeacher })
      if (!subs.length && !have(c, null)) out.push({ classId: c, subjectId: null, classTeacher: true })
    }
    return out
  }
  const toAdd = additions()
  return (
    <DetailPage title={staff.name} onClose={onClose} actions={manage ? <div className="flex gap-2"><Button variant="secondary" onClick={onEdit}>Edit</Button>{ctx.can('school.delete') && <ConfirmDelete label={staff.name} noun="staff member" warning="Their record and class assignments are erased, lessons they taught stay on the timetable without a teacher, and any sign-in they had to this school is removed. Their own account is not deleted. To keep the record, untick Still working here under Edit instead." withReason onConfirm={(reason) => deleteStaff(ctx.businessId, staff.id, reason)} onDeleted={async () => { onClose(); await onChanged() }} />}</div> : undefined}>
      <p className="mb-3 text-sm text-ink/70">{staff.staffNo} · {staff.jobTitle ?? 'Staff'} · {[staff.phone, staff.email].filter(Boolean).join(' · ') || 'No contact'}</p>
      <SignInAccess ctx={ctx} staff={staff} access={access} manage={manage} onChanged={onAccess} />
      <h3 className="mb-1 text-sm font-semibold">Classes and subjects</h3>
      {rows.length ? <ul className="divide-y divide-ink/10 text-sm">{rows.map((r, i) => <li key={i} className="flex items-center justify-between py-1.5"><span>{ctx.className(r.classId)} · {r.subjectId ? ctx.subjectName(r.subjectId) : 'Class teacher only'}{r.classTeacher && <> <Badge tone="info">Class teacher</Badge></>}</span>{manage && <Button variant="secondary" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>}</li>)}</ul> : <p className="text-sm text-ink/60">Nothing assigned. This person cannot reach any class records.</p>}
      {manage && (
        <div className="mt-4 space-y-4 border-t border-line pt-3">
          <fieldset><legend className="mb-1 flex w-full items-center justify-between text-sm font-medium"><span>Classes</span><span className="text-xs font-normal"><button type="button" className="underline" onClick={() => setSelClasses(ctx.classes.map((c) => c.id))}>Select all</button> · <button type="button" className="underline" onClick={() => { setSelClasses([]); setSelSubjects([]) }}>Clear</button></span></legend>
            <div className="flex max-h-44 flex-wrap gap-2 overflow-auto">{ctx.classes.map((c) => <label key={c.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${selClasses.includes(c.id) ? 'border-amber bg-accent-soft font-medium' : 'border-line hover:bg-surface'}`}><input type="checkbox" className="sr-only" checked={selClasses.includes(c.id)} onChange={() => toggle(selClasses, setSelClasses, c.id)} />{c.name}</label>)}</div></fieldset>
          {selClasses.length > 0 && (
            <fieldset><legend className="mb-1 flex w-full items-center justify-between text-sm font-medium"><span>Subjects</span><span className="text-xs font-normal"><button type="button" className="underline" onClick={() => setSelSubjects(subjectChoices.map((x) => x.id))}>Select all</button> · <button type="button" className="underline" onClick={() => setSelSubjects([])}>Clear</button></span></legend>
              {subjectChoices.length ? <div className="flex flex-wrap gap-2">{subjectChoices.map((x) => <label key={x.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${selSubjects.includes(x.id) ? 'border-amber bg-accent-soft font-medium' : 'border-line hover:bg-surface'}`}><input type="checkbox" className="sr-only" checked={selSubjects.includes(x.id)} onChange={() => toggle(selSubjects, setSelSubjects, x.id)} />{x.name}</label>)}</div> : <p className="text-sm text-ink/60">The chosen classes have no subjects yet. Open the class under Classes &amp; Subjects to tick its subjects. You can still add the teacher as class teacher.</p>}
              <p className="mt-1 text-xs text-ink/60">Pick as many classes and subjects as you need. Each subject is added to the chosen classes that study it.</p>
            </fieldset>
          )}
          {selClasses.length > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={alsoClassTeacher} onChange={(e) => setAlsoClassTeacher(e.target.checked)} /> Also make them class teacher of the chosen classes{selSubjects.length === 0 ? ' (chosen classes with no subject picked are added as class teacher anyway)' : ''}</label>}
          <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={!toAdd.length} onClick={() => { setRows([...rows, ...toAdd]); setSelSubjects([]); setSelClasses([]); setAlsoClassTeacher(false) }}><Plus className="size-4" aria-hidden /> Add {toAdd.length ? toAdd.length + (toAdd.length === 1 ? ' assignment' : ' assignments') : 'to the list'}</Button><span className="text-xs text-ink/60">Then press Save assignments below.</span></div>
          {runner.error && <ErrorState title="Not saved" message={runner.error} />}{runner.ok && <Notice>{runner.ok}</Notice>}
          <Button loading={runner.busy} onClick={() => void runner.run(async () => setAssignments(ctx.businessId, staff.id, rows), 'Assignments saved.')}>Save assignments</Button>
        </div>
      )}
    </DetailPage>
  )
}

/** Optional sign-in for a staff member: create the login now with a temporary password, or invite someone who already has an account. */
function SignInAccess({ ctx, staff, access, manage, onChanged }: { ctx: ReturnType<typeof useSchool>; staff: SStaff; access: StaffAccess | null; manage: boolean; onChanged: () => Promise<void> }) {
  const runner = useFormRunner(onChanged)
  const guess = /burs/i.test(staff.jobTitle ?? '') ? 'bursar' : /admission/i.test(staff.jobTitle ?? '') ? 'admissions_officer' : 'teacher'
  const [role, setRole] = useState(guess); const [password, setPassword] = useState(() => tempPassword())
  const [made, setMade] = useState<string | null>(null)
  const state = access?.state ?? 'none'
  async function create() {
    const bad = passwordProblem(password); if (bad) return void runner.run(async () => bad, '')
    await runner.run(async () => { const err = await createLogin(ctx.businessId, staff.id, role, password); if (!err) setMade(password); return err }, 'Login created.')
  }
  return (
    <section className="mb-4 rounded-lg border border-line bg-surface p-3 text-sm" aria-label="Sign-in access">
      <h3 className="mb-1 font-semibold">Sign-in access</h3>
      {made && staff.email ? <Credentials name={staff.name} email={staff.email} password={made} onDone={() => setMade(null)} /> : (<>
        {state === 'suspended' && <p className="text-danger">{staff.name}'s access is <b>suspended</b>: they are locked out until the owner or an admin reinstates them under Staff &amp; Roles.</p>}
        {state === 'signed_in' && <p>{staff.name} can sign in{access?.role ? ' as ' + roleLabel(access.role) : ''}. To change or remove their access, use Staff &amp; Roles.</p>}
        {state === 'invited' && (
          <div className="space-y-2"><p>Invited as <b>{roleLabel(access?.role ?? null)}</b>. When {staff.name} signs up with <b>{staff.email}</b> and confirms that email, they are in and linked to this record.</p>
            {manage && <Button variant="secondary" loading={runner.busy} onClick={() => void runner.run(async () => cancelLogin(ctx.businessId, staff.id), 'Invitation withdrawn.')}>Withdraw invitation</Button>}</div>
        )}
        {state === 'none' && (
          <div className="space-y-3">
            <p className="text-ink/70">No login. That is fine for staff who do not use the system (cleaner, driver, security). {staff.email ? '' : 'To give someone a login, edit their record and add their email first.'}</p>
            {manage && staff.email && (<>
              <LoginFields role={role} setRole={setRole} password={password} setPassword={setPassword} />
              <div className="flex flex-wrap items-center gap-3"><Button loading={runner.busy} onClick={() => void create()}>Create login</Button>
                <button type="button" className="text-xs underline" onClick={() => void runner.run(async () => giveLogin(ctx.businessId, staff.id, role), 'Invitation created. Ask them to sign up with ' + staff.email + '.')}>They already have an account: invite them instead</button></div>
            </>)}
          </div>
        )}
      </>)}
      {runner.error && <div className="mt-2"><ErrorState title="Not done" message={runner.error} /></div>}{runner.ok && <div className="mt-2"><Notice>{runner.ok}</Notice></div>}
    </section>
  )
}
