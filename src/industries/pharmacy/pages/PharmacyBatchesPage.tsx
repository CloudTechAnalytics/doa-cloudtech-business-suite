import { useState } from 'react'
import type { FormEvent } from 'react'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, Spinner, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { DetailPage } from '@/shared/components/detail-page'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { dateTime, label, naira, qty } from '@/shared/utilities/format'
import { DISPOSE_REASONS, completeBatch, disposeBatch, loadBatchEvents, loadBatches, loadSettings, saveSettings, setBatchStatus } from '../services/pharmacyApi'
import type { BatchRow, DisposeReason, PharmSettings } from '../services/pharmacyApi'

const TONE = { ok: 'success', watch: 'info', warning: 'warning', critical: 'danger', expired: 'danger', unknown: 'neutral' } as const
const EXPIRY_LABEL: Record<string, string> = { ok: 'In date', watch: 'Watch', warning: 'Expiring', critical: 'Expiring soon', expired: 'Expired', unknown: 'No expiry' }
const TYPES = [['community_pharmacy', 'Community pharmacy'], ['medicine_store', 'Medicine store'], ['retail_chain', 'Retail pharmacy chain'], ['hospital_pharmacy', 'Hospital pharmacy'], ['distributor', 'Pharmacy distributor']] as const

/** Batch balances and expiry. Expired, quarantined and undated batches are never sold; quarantine, release and disposal are recorded with a reason. */
export function PharmacyBatchesPage() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const batches = useAsync(() => loadBatches(businessId), [businessId])
  const settings = useAsync(() => loadSettings(businessId), [businessId])
  const { can } = usePermissions(businessId)
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState(''); const [location, setLocation] = useState('')
  const [action, setAction] = useState<{ kind: 'quarantine' | 'release' | 'complete' | 'dispose' | 'history'; batch: BatchRow } | null>(null)
  const [editing, setEditing] = useState(false)
  if (!active) return null
  const manage = can('pharmacy.manage'); const pharmacist = can('pharmacy.dispense'); const adjust = can('inventory.adjust')
  const q = search.trim().toLowerCase()
  const locations = [...new Map((batches.data ?? []).filter((b) => b.locationId).map((b) => [b.locationId!, b.locationName ?? ''])).entries()]
  const list = (batches.data ?? []).filter((b) => (!q || [b.productName, b.batchNumber, b.supplierName].some((v) => v?.toLowerCase().includes(q))) && (!location || b.locationId === location)
    && (!filter || (filter === 'quarantined' ? b.status === 'quarantined' : filter === 'undated' ? b.expiresOn === null : b.status === 'active' && b.expiryStatus === filter)))
  const count = (s: string) => (batches.data ?? []).filter((b) => (s === 'quarantined' ? b.status === 'quarantined' : b.status === 'active' && b.expiryStatus === s)).length
  const s = settings.data
  const refresh = async () => { await batches.refresh() }

  return (
    <>
      <PageHeader title="Batches & expiry" description="Stock is held by batch and sold earliest-expiry first. Expired, quarantined and undated batches are excluded from every sale and dispensing, and every change is recorded."
        actions={manage ? <Button variant="secondary" onClick={() => setEditing(true)}>Expiry settings</Button> : undefined} />
      {(batches.error || settings.error) && <ErrorState message={(batches.error ?? settings.error)!} />}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {([['expired', 'Expired'], ['critical', `Within ${s?.critical ?? 30} days`], ['warning', `Within ${s?.alert ?? 90} days`], ['watch', `Within ${s?.warning ?? 180} days`], ['quarantined', 'Quarantined']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(filter === k ? '' : k)} className={`rounded-lg border p-3 text-left ${filter === k ? 'border-amber bg-amber/10' : 'border-line bg-white'}`}>
            <p className="text-xs font-medium uppercase tracking-wide text-ink/60">{l}</p><p className="tabular mt-1 text-2xl font-semibold">{count(k)}</p><p className="text-xs text-ink/60">batch{count(k) === 1 ? '' : 'es'}</p>
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-64"><TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Medicine, batch or supplier" /></div>
        <div className="w-52"><SelectField label="Status" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All batches</option><option value="expired">Expired</option><option value="critical">Expiring soon</option><option value="warning">Expiring</option><option value="watch">Watch</option><option value="ok">In date</option><option value="undated">No batch or expiry</option><option value="quarantined">Quarantined</option></SelectField></div>
        {locations.length > 1 && <div className="w-44"><SelectField label="Location" value={location} onChange={(e) => setLocation(e.target.value)}><option value="">All</option>{locations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</SelectField></div>}
      </div>
      {batches.loading ? <Spinner /> : list.length === 0 ? <Card><EmptyState title="No batches" description="Batches appear when goods are received. Use Receive goods on the Medicines page." /></Card> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Medicine</th><th className="p-3">Batch</th><th className="p-3">Expiry</th><th className="p-3 text-right">Remaining</th><th className="p-3">Status</th><th className="p-3 text-right">Value</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-ink/10">
              {list.map((b) => (
                <tr key={b.id}>
                  <td className="p-3 font-medium">{b.productName}<div className="text-xs font-normal text-ink/60">{[b.locationName, b.supplierName && `from ${b.supplierName}`, `received ${b.receivedOn}`].filter(Boolean).join(' · ')}</div></td>
                  <td className="p-3">{b.batchNumber ?? <span className="text-warning">not recorded</span>}</td>
                  <td className="p-3">{b.expiresOn ?? '–'} <Badge tone={TONE[b.expiryStatus]}>{EXPIRY_LABEL[b.expiryStatus]}{b.daysLeft !== null && b.daysLeft >= 0 ? ` · ${b.daysLeft} d` : ''}</Badge></td>
                  <td className="tabular p-3 text-right">{qty(b.remaining)}</td>
                  <td className="p-3">{b.status === 'quarantined' ? <><Badge tone="danger">Quarantined</Badge><div className="text-xs text-ink/60">{b.statusReason}</div></> : b.expiresOn === null || b.expiryStatus === 'expired' ? <Badge tone="warning">Not saleable</Badge> : <Badge tone="success">Saleable</Badge>}</td>
                  <td className="tabular p-3 text-right">{naira(b.value)}</td>
                  <td className="p-3 text-right"><div className="flex justify-end gap-1">
                    {b.expiresOn === null && adjust && <Button variant="secondary" onClick={() => setAction({ kind: 'complete', batch: b })}>Add expiry</Button>}
                    {(manage || pharmacist) && (b.status === 'active' ? <Button variant="ghost" onClick={() => setAction({ kind: 'quarantine', batch: b })}>Quarantine</Button> : <Button variant="ghost" onClick={() => setAction({ kind: 'release', batch: b })}>Release</Button>)}
                    {manage && <Button variant="ghost" onClick={() => setAction({ kind: 'dispose', batch: b })}>Dispose</Button>}
                    <Button variant="ghost" onClick={() => setAction({ kind: 'history', batch: b })}>History</Button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {action && action.kind !== 'history' && action.kind !== 'dispose' && action.kind !== 'complete' && <StatusDialog businessId={businessId} kind={action.kind} batch={action.batch} onClose={() => setAction(null)} onSaved={async () => { setAction(null); await refresh() }} />}
      {action?.kind === 'complete' && <CompleteDialog businessId={businessId} batch={action.batch} onClose={() => setAction(null)} onSaved={async () => { setAction(null); await refresh() }} />}
      {action?.kind === 'dispose' && <DisposeDialog businessId={businessId} batch={action.batch} onClose={() => setAction(null)} onSaved={async () => { setAction(null); await refresh() }} />}
      {action?.kind === 'history' && <HistoryDialog businessId={businessId} batch={action.batch} onClose={() => setAction(null)} />}
      {editing && s && <SettingsDialog businessId={businessId} settings={s} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await Promise.all([settings.refresh(), batches.refresh()]) }} />}
    </>
  )
}

function StatusDialog({ businessId, kind, batch, onClose, onSaved }: { businessId: string; kind: 'quarantine' | 'release'; batch: BatchRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [reason, setReason] = useState(''); const [expiry, setExpiry] = useState(batch.expiresOn ?? ''); const [batchNo, setBatchNo] = useState(batch.batchNumber ?? '')
  const release = kind === 'release'
  return (
    <Dialog title={`${release ? 'Release' : 'Quarantine'} ${batch.productName}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void runner.run(async () => setBatchStatus(businessId, batch.id, release ? 'active' : 'quarantined', reason, batchNo, expiry || null), release ? 'Released for sale.' : 'Quarantined.') }} className="space-y-4">
        <p className="text-sm text-ink/80">{release ? 'The batch becomes saleable again. Confirm it was inspected and that its batch number and expiry date are correct.' : `${qty(batch.remaining)} units stop being saleable at once. Use this for damaged, suspect or recalled stock and for returned goods awaiting inspection.`}</p>
        {release && <div className="grid gap-4 sm:grid-cols-2"><TextField label="Batch number" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} /><TextField label="Expiry date" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>}
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder={release ? 'e.g. Inspected: sealed and in date' : 'e.g. Supplier recall notice'} />
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} disabled={reason.trim().length < 3}>{release ? 'Release' : 'Quarantine'}</Button></div>
      </form>
    </Dialog>
  )
}

function CompleteDialog({ businessId, batch, onClose, onSaved }: { businessId: string; batch: BatchRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [batchNo, setBatchNo] = useState(batch.batchNumber ?? ''); const [expiry, setExpiry] = useState('')
  return (
    <Dialog title={`Batch details for ${batch.productName}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void runner.run(async () => completeBatch(businessId, batch.id, batchNo, expiry), 'Saved.') }} className="space-y-4">
        <p className="text-sm text-ink/80">This batch arrived without a batch number or expiry date, so it cannot be sold. Copy them from the pack.</p>
        <div className="grid gap-4 sm:grid-cols-2"><TextField label="Batch number" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} autoFocus /><TextField label="Expiry date" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} disabled={!expiry}>Save</Button></div>
      </form>
    </Dialog>
  )
}

function DisposeDialog({ businessId, batch, onClose, onSaved }: { businessId: string; batch: BatchRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [problem, setProblem] = useState<string | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const q2 = Number(f.get('qty'))
    if (!(q2 > 0) || q2 > batch.remaining) return setProblem(`Enter a quantity between 0 and ${batch.remaining}.`)
    setProblem(null)
    await runner.run((k) => disposeBatch(businessId, batch.id, q2, String(f.get('reason')) as DisposeReason, String(f.get('notes') ?? ''), k), 'Disposal recorded.')
  }
  return (
    <Dialog title={`Dispose of stock: ${batch.productName}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-ink/80">Batch {batch.batchNumber ?? 'unnamed'}, {qty(batch.remaining)} left. Stock goes down and the estimated loss is recorded at cost. Follow your licence conditions for the physical disposal of medicines.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Quantity" name="qty" type="number" min="0" step="any" defaultValue={batch.remaining} />
          <SelectField label="Reason" name="reason" defaultValue={batch.expiryStatus === 'expired' ? 'expired' : 'damaged'}>{DISPOSE_REASONS.map((r) => <option key={r} value={r}>{label(r)}</option>)}</SelectField>
        </div>
        <TextField label="Notes (reference, witness, method)" name="notes" />
        {(problem || runner.error) && <ErrorState title="Not recorded" message={(problem ?? runner.error)!} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} className="bg-danger text-white hover:bg-danger/90">Record disposal</Button></div>
      </form>
    </Dialog>
  )
}

function HistoryDialog({ businessId, batch, onClose }: { businessId: string; batch: BatchRow; onClose: () => void }) {
  const events = useAsync(() => loadBatchEvents(businessId, batch.id), [businessId, batch.id])
  return (
    <DetailPage title={`History: ${batch.productName} ${batch.batchNumber ?? ''}`} onClose={onClose}>
      {events.loading ? <Spinner /> : !events.data?.length ? <p className="text-sm text-ink/60">Nothing has been recorded against this batch yet.</p> : (
        <ul className="divide-y divide-ink/10 text-sm">{events.data.map((e) => <li key={e.id} className="py-2"><b>{label(e.event)}</b> · {qty(e.quantity)} units<div className="text-xs text-ink/60">{dateTime(e.at)} · {e.reason}</div></li>)}</ul>
      )}
      <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
    </DetailPage>
  )
}

function SettingsDialog({ businessId, settings, onClose, onSaved }: { businessId: string; settings: PharmSettings; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    await runner.run(async () => saveSettings(businessId, { businessType: s('type'), licence: s('licence') || null, superintendent: s('super') || null, warning: Number(s('warning')), alert: Number(s('alert')), critical: Number(s('critical')) }), 'Saved.')
  }
  return (
    <Dialog title="Pharmacy and expiry settings" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <SelectField label="Business type" name="type" defaultValue={settings.businessType}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
        <div className="grid gap-4 sm:grid-cols-2"><TextField label="Licence number" name="licence" defaultValue={settings.licence ?? ''} /><TextField label="Superintendent pharmacist" name="super" defaultValue={settings.superintendent ?? ''} /></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Watch (days)" name="warning" type="number" min="1" defaultValue={settings.warning} hint="Longest" />
          <TextField label="Expiring (days)" name="alert" type="number" min="1" defaultValue={settings.alert} />
          <TextField label="Soon (days)" name="critical" type="number" min="1" defaultValue={settings.critical} hint="Shortest" />
        </div>
        <Notice>These periods set the expiry badges, the dashboard counts and the alerts. Expired stock is always excluded from sale.</Notice>
        {runner.error && <ErrorState title="Not saved" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy}>Save</Button></div>
      </form>
    </Dialog>
  )
}
