import { History, ChevronRight, Plus, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { PAY_METHODS } from '@/modules/finance/financeApi'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { label, naira } from '@/shared/utilities/format'
import { today } from '../components/farmUi'
import { ASSET_TYPES, listAssets, listMaintenance, recordMaintenance, saveAsset, voidMaintenance } from '../services/opsApi'
import type { AssetRow, MaintenanceDto } from '../services/opsApi'
import { openRow } from '@/shared/utilities/rows'

const TONE = { active: 'success', under_repair: 'warning', retired: 'neutral' } as const

/** Machines and tools, when each was last serviced and when it is due next. Maintenance costs become expenses automatically. */
export function FarmEquipmentPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const assets = useAsync(() => listAssets(businessId), [businessId])
  const history = useAsync(() => listMaintenance(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const [editing, setEditing] = useState<AssetRow | 'new' | null>(null)
  const [servicing, setServicing] = useState<AssetRow | null>(null)
  const [viewing, setViewing] = useState<AssetRow | null>(null)
  if (!active) return null
  const manage = can('farm.manage')
  const refresh = async () => { await Promise.all([assets.refresh(), history.refresh()]) }

  return (
    <>
      <PageHeader title="Equipment" description="Machines and tools, their service history and what maintenance has cost. A maintenance cost is recorded once, as a repairs expense."
        actions={manage ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add equipment</Button> : undefined} />
      {assets.error && <ErrorState message={assets.error} />}
      {assets.loading ? <Spinner /> : !assets.data?.length ? <Card><EmptyState title="No equipment yet" description="Add tractors, pumps, generators and tools to track their servicing." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Equipment</th><th className="p-3">Status</th><th className="p-3">Last service</th><th className="p-3">Next service</th><th className="p-3 text-right">Maintenance cost</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {assets.data.map((a) => (
                <tr data-row-link onClick={openRow} key={a.id} className={a.status === 'retired' ? 'text-ink/50' : ''}>
                  <td className="p-3 font-medium">{a.name}<div className="text-xs font-normal text-ink/60">{label(a.type)}{a.serial ? ` · ${a.serial}` : ''}</div></td>
                  <td className="p-3"><Badge tone={TONE[a.status]}>{label(a.status)}</Badge></td>
                  <td className="p-3">{a.lastServiceOn ?? 'Never'}</td>
                  <td className="p-3">{a.nextServiceOn ?? '–'}{a.serviceOverdue && <> <Badge tone="danger">Overdue</Badge></>}</td>
                  <td className="tabular p-3 text-right">{naira(a.totalCost)}</td>
                  <td className="whitespace-nowrap p-3 text-right">
                    <button type="button" aria-label={`History of ${a.name}`} onClick={() => setViewing(a)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><History className="size-4" aria-hidden /></button>
                    {manage && a.status !== 'retired' && <button type="button" aria-label={`Record maintenance for ${a.name}`} onClick={() => setServicing(a)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><Wrench className="size-4" aria-hidden /></button>}
                    {manage && <button type="button" aria-label={`Open ${a.name}`} onClick={() => setEditing(a)} className="rounded-md p-1.5 text-ink/50 hover:bg-surface hover:text-ink"><ChevronRight className="size-4" aria-hidden /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <AssetDialog businessId={businessId} asset={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />}
      {servicing && <MaintenanceDialog businessId={businessId} asset={servicing} onClose={() => setServicing(null)} onSaved={async () => { setServicing(null); await refresh() }} />}
      {viewing && <HistoryDialog businessId={businessId} asset={viewing} records={(history.data ?? []).filter((r) => r.assetId === viewing.id)} manage={manage} onClose={() => setViewing(null)} onChanged={refresh} />}
    </>
  )
}

function AssetDialog({ businessId, asset, onClose, onSaved }: { businessId: string; asset: AssetRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [problem, setProblem] = useState<string | undefined>()
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    if (!s('name')) return setProblem('Enter the equipment name.')
    setProblem(undefined)
    await runner.run((k) => saveAsset(businessId, { id: asset?.id ?? null, name: s('name'), type: s('type'), serial: s('serial'), purchaseDate: s('date') || null, purchaseCost: s('cost') === '' ? null : Number(s('cost')), status: (s('status') || 'active') as AssetRow['status'], intervalDays: s('interval') === '' ? null : Number(s('interval')), notes: s('notes') }, k), 'Saved.')
  }
  return (
    <DetailPage title={asset ? `Edit ${asset.name}` : 'Add equipment'} onClose={onClose} view={!!asset}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Name" name="name" defaultValue={asset?.name} error={problem} autoFocus maxLength={120} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Type" name="type" defaultValue={asset?.type ?? 'tractor'}>{ASSET_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</SelectField>
          <TextField label="Serial number (optional)" name="serial" defaultValue={asset?.serial ?? ''} />
          <TextField label="Bought on (optional)" name="date" type="date" max={today()} defaultValue={asset?.purchaseDate ?? ''} />
          <TextField label="Purchase cost (optional)" name="cost" type="number" min="0" step="0.01" defaultValue={asset?.purchaseCost ?? ''} />
          <TextField label="Service every (days)" name="interval" type="number" min="1" max="3650" defaultValue={asset?.intervalDays ?? ''} hint="Leave empty if it has no schedule." />
          {asset && <SelectField label="Status" name="status" defaultValue={asset.status}><option value="active">Active</option><option value="under_repair">Under repair</option><option value="retired">Retired</option></SelectField>}
        </div>
        <TextField label="Notes (optional)" name="notes" defaultValue={asset?.notes ?? ''} />
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>{asset ? 'Save' : 'Add equipment'}</Button></div>
      </form>
    </DetailPage>
  )
}

function MaintenanceDialog({ businessId, asset, onClose, onSaved }: { businessId: string; asset: AssetRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [errors, setErrors] = useState<Record<string, string>>({})
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (s('description').length < 2) next.description = 'Describe the work.'
    if (!(Number(s('cost') || 0) >= 0)) next.cost = 'Enter zero or more.'
    if (!s('date') || s('date') > today()) next.date = 'Choose today or an earlier date.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => recordMaintenance(businessId, { assetId: asset.id, kind: s('kind') as MaintenanceDto['kind'], on: s('date'), cost: Math.round(Number(s('cost') || 0) * 100) / 100, description: s('description'), method: s('method') }, k), 'Maintenance recorded.')
  }
  return (
    <Dialog title={`Maintenance: ${asset.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="What was done?" name="description" error={errors.description} placeholder="e.g. Oil change and filters" maxLength={300} autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Type" name="kind" defaultValue="service"><option value="service">Service</option><option value="repair">Repair</option><option value="inspection">Inspection</option></SelectField>
          <TextField label="Date" name="date" type="date" defaultValue={today()} max={today()} error={errors.date} />
          <TextField label="Cost" name="cost" type="number" min="0" step="0.01" defaultValue="0" error={errors.cost} hint="Above zero creates a repairs expense." />
          <SelectField label="Paid by" name="method" defaultValue="cash">{PAY_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</SelectField>
        </div>
        {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Record</Button></div>
      </form>
    </Dialog>
  )
}

function HistoryDialog({ businessId, asset, records, manage, onClose, onChanged }: { businessId: string; asset: AssetRow; records: MaintenanceDto[]; manage: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const runner = useFormRunner(onChanged)
  const [voiding, setVoiding] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  return (
    <Dialog title={`${asset.name}: history`} onClose={onClose} wide>
      {records.length === 0 ? <p className="text-sm text-ink/60">No maintenance recorded yet.</p> : (
        <ul className="divide-y divide-ink/10 text-sm">
          {records.map((r) => (
            <li data-row-link onClick={openRow} key={r.id} className={`py-2 ${r.status === 'voided' ? 'text-ink/45' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className={r.status === 'voided' ? 'line-through' : 'font-medium'}>{r.description}</span> <Badge>{label(r.kind)}</Badge><span className="ml-2 text-xs text-ink/60">{r.on}</span></span>
                <span className="flex items-center gap-2"><b className="tabular">{naira(r.cost)}</b>{manage && r.status === 'posted' && <Button variant="ghost" onClick={() => setVoiding(r.id)}>Void</Button>}</span>
              </div>
              {r.status === 'voided' && <p className="text-xs">Voided: {r.voidReason}</p>}
              {voiding === r.id && (
                <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void runner.run((k) => voidMaintenance(businessId, r.id, reason, k), 'Voided.', () => { setVoiding(null); setReason('') }) }}>
                  <div className="w-64"><TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
                  <Button type="submit" loading={runner.busy} disabled={reason.trim().length < 3} className="bg-danger text-white hover:bg-danger/90">Void record</Button>
                  <Button type="button" variant="secondary" onClick={() => setVoiding(null)}>Back</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {runner.error && <ErrorState title="Not voided" message={runner.error} />}
    </Dialog>
  )
}
