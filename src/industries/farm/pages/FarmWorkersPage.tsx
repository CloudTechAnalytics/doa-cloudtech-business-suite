import { ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, Spinner, TextField } from '@/shared/components'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { listWorkers, saveWorker } from '../services/opsApi'
import type { WorkerDto } from '../services/opsApi'
import { openRow } from '@/shared/utilities/rows'
import { DeleteButton } from '@/shared/components/delete-button'

/** The people who work on the farm. Records for assigning work; they do not need an account. */
export function FarmWorkersPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const workers = useAsync(() => listWorkers(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const [editing, setEditing] = useState<WorkerDto | 'new' | null>(null)
  if (!active) return null
  const manage = can('farm.manage')

  return (
    <>
      <PageHeader title="Workers" description="The people who work on the farm. Add them here to assign tasks. Workers do not need an account to appear in this list."
        actions={manage ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add worker</Button> : undefined} />
      {workers.error && <ErrorState message={workers.error} />}
      {workers.loading ? <Spinner /> : !workers.data?.length ? <Card><EmptyState title="No workers yet" description="Add the people you assign work to." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Name</th><th className="p-3">Role</th><th className="p-3">Phone</th><th className="p-3">Status</th>{manage && <th className="w-12 p-3" />}</tr></thead>
            <tbody className="divide-y divide-ink/10">
              {workers.data.map((w) => (
                <tr data-row-link onClick={openRow} key={w.id} className={w.active ? '' : 'text-ink/50'}>
                  <td className="p-3 font-medium">{w.name}</td><td className="p-3">{w.role ?? '–'}</td><td className="p-3">{w.phone ?? '–'}</td>
                  <td className="p-3"><Badge tone={w.active ? 'success' : 'neutral'}>{w.active ? 'Active' : 'Inactive'}</Badge></td>
                  {manage && <td className="p-3 text-right"><button type="button" aria-label={`Open ${w.name}`} onClick={() => setEditing(w)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><ChevronRight className="size-4" aria-hidden /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {!manage && !workers.loading && <Notice>Your role can see tasks but not the worker list.</Notice>}
      {editing && <WorkerDialog businessId={businessId} worker={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await workers.refresh() }} />}
    </>
  )
}

function WorkerDialog({ businessId, worker, onClose, onSaved }: { businessId: string; worker: WorkerDto | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [problem, setProblem] = useState<string | undefined>()
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    if (!s('name')) return setProblem("Enter the worker's name.")
    setProblem(undefined)
    await runner.run(async () => saveWorker(businessId, { id: worker?.id ?? null, name: s('name'), phone: s('phone'), role: s('role'), active: f.get('active') === 'on' || !worker }), 'Saved.')
  }
  return (
    <DetailPage title={worker ? `Edit ${worker.name}` : 'Add a worker'} onClose={onClose} view={!!worker} modal={!worker} actions={worker ? <DeleteButton businessId={businessId} kind="worker" id={worker.id} label={worker.name} noun="worker" onDeleted={onSaved} /> : undefined}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Name" name="name" defaultValue={worker?.name} error={problem} autoFocus maxLength={120} />
        <div className="grid gap-4 sm:grid-cols-2"><TextField label="Role (optional)" name="role" defaultValue={worker?.role ?? ''} placeholder="e.g. Poultry attendant" /><TextField label="Phone (optional)" name="phone" defaultValue={worker?.phone ?? ''} /></div>
        {worker && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={worker.active} /> Active <span className="text-ink/60">(inactive workers cannot be given new tasks)</span></label>}
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>{worker ? 'Save' : 'Add worker'}</Button></div>
      </form>
    </DetailPage>
  )
}
