import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { canManageStaff, demoInvite, demoRoleIn, demoSetStatus, useDemoState } from '@/demo/demoStore'
import type { RoleName } from '@/shared/types/domain'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'

interface Member { id: string; user_id: string; status: string; roles: { name: string } | null; profiles: { display_name: string } | null }
interface Invite { id: string; email: string; roles: { name: string } | null }

const ASSIGNABLE = ['business_admin', 'manager', 'accountant', 'cashier', 'inventory_officer', 'operations_staff', 'pharmacist', 'pharmacy_technician', 'principal', 'teacher', 'bursar', 'admissions_officer', 'parent', 'viewer']

export function StaffPage() {
  return isDemoMode ? <DemoStaffPage /> : <LiveStaffPage />
}

function DemoStaffPage() {
  const { active } = useBusiness()
  const demo = useDemoState()
  const [error, setError] = useState<string | null>(null)
  if (!active) return <EmptyState title="No business selected" />
  const can = canManageStaff(demoRoleIn(active.id))
  const members = demo.members.filter((m) => m.businessId === active.id)

  function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const err = demoInvite(active!.id, String(f.get('email')), String(f.get('role')) as RoleName)
    setError(err)
    if (!err) e.currentTarget.reset()
  }

  return (
    <>
      <PageHeader title="Staff & Roles" description={`People with access to ${active.name}.`} />
      {error && <ErrorState message={error} />}
      {can ? (
        <Card className="mb-4">
          <form onSubmit={invite} className="grid items-end gap-3 sm:grid-cols-[1fr_200px_auto]">
            <TextField label="Invite by email" name="email" type="email" required />
            <SelectField label="Role" name="role" defaultValue="cashier">
              {ASSIGNABLE.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </SelectField>
            <Button type="submit">Invite</Button>
          </form>
        </Card>
      ) : (
        <p className="mb-4 text-sm text-ink/70">Your role ({demoRoleIn(active.id)}) can view staff but not manage it.</p>
      )}
      <Card>
        <ul className="divide-y divide-ink/10">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <span><b>{m.name}</b> · {m.role.replace('_', ' ')} · {m.status}</span>
              {can && m.role !== 'owner' && m.userId !== demo.userId && (
                <span className="flex gap-2">
                  {m.status === 'active'
                    ? <Button variant="secondary" onClick={() => setError(demoSetStatus(m.id, 'suspended'))}>Suspend</Button>
                    : m.status !== 'revoked' && <Button variant="secondary" onClick={() => setError(demoSetStatus(m.id, 'active'))}>Reinstate</Button>}
                  {m.status !== 'revoked' && <Button variant="ghost" onClick={() => setError(demoSetStatus(m.id, 'revoked'))}>Revoke</Button>}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

function LiveStaffPage() {
  const { active } = useBusiness()
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase || !active) return
    setLoading(true)
    const [m, i] = await Promise.all([
      supabase.from('business_members').select('id, user_id, status, roles(name), profiles!business_members_user_id_fkey(display_name)').eq('business_id', active.id),
      supabase.from('business_invitations').select('id, email, roles(name)').eq('business_id', active.id).eq('status', 'pending'),
    ])
    setError(m.error?.message ?? null)
    setMembers((m.data ?? []) as unknown as Member[])
    setInvites((i.data ?? []) as unknown as Invite[])
    setLoading(false)
  }, [active])

  useEffect(() => { void load() }, [load])

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase || !active) return
    const f = new FormData(e.currentTarget)
    const { error } = await supabase.rpc('invite_member', { p_business: active.id, p_email: String(f.get('email')), p_role: String(f.get('role')) })
    setError(error?.message ?? null)
    if (!error) { e.currentTarget.reset(); await load() }
  }

  async function setStatus(id: string, status: string) {
    if (!supabase) return
    const { error } = await supabase.rpc('set_member_status', { p_member: id, p_status: status })
    setError(error?.message ?? null)
    await load()
  }

  if (!active) return <EmptyState title="No business selected" />

  return (
    <>
      <PageHeader title="Staff & Roles" description={`People with access to ${active.name}. Permissions are enforced by the database.`} />
      {error && <ErrorState message={error} />}
      <Card className="mb-4">
        <form onSubmit={invite} className="grid items-end gap-3 sm:grid-cols-[1fr_200px_auto]">
          <TextField label="Invite by email" name="email" type="email" required />
          <SelectField label="Role" name="role" defaultValue="cashier">
            {ASSIGNABLE.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
          </SelectField>
          <Button type="submit">Invite</Button>
        </form>
      </Card>
      {loading ? <Spinner /> : (
        <Card>
          <ul className="divide-y divide-ink/10">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span><b>{m.profiles?.display_name || 'Unnamed'}</b> · {m.roles?.name} · {m.status}</span>
                {m.roles?.name !== 'owner' && (
                  <span className="flex gap-2">
                    {m.status === 'active'
                      ? <Button variant="secondary" onClick={() => setStatus(m.id, 'suspended')}>Suspend</Button>
                      : m.status !== 'revoked' && <Button variant="secondary" onClick={() => setStatus(m.id, 'active')}>Reinstate</Button>}
                    {m.status !== 'revoked' && <Button variant="ghost" onClick={() => setStatus(m.id, 'revoked')}>Revoke</Button>}
                  </span>
                )}
              </li>
            ))}
            {invites.map((i) => (
              <li key={i.id} className="py-3 text-sm text-ink/70">{i.email} · {i.roles?.name} · invitation pending</li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
