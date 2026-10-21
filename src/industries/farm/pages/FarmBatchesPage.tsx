import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { DataTable } from '@/shared/tables/DataTable'
import { dateTime, label } from '@/shared/utilities/format'
import { CountBasis, FarmGate, today } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { adjustPopulation, closeBatch, reverseEvent, startBatch } from '../services/farmApi'
import { mortalityRate } from '../types'
import type { FarmBatch, FarmData, Production } from '../types'

export function FarmBatchesPage() {
  const farm = useFarm()
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [status, setStatus] = useState<'active' | 'closed' | ''>('active')

  return (
    <>
      <PageHeader title="Farm batches" description="Each batch is a flock, fish stock or crop cycle. Its numbers come from a ledger: corrections are new entries, never edits."
        actions={farm.can('farm.manage') ? <Button onClick={() => setAdding((a) => !a)}>{adding ? 'Close form' : 'Start a batch'}</Button> : undefined} />
      <FarmGate farm={farm}>
        {(data) => {
          const rows = data.batches.filter((b) => !status || b.status === status)
          return (
            <>
              {adding && <StartBatch farm={farm} units={data.units} onDone={async () => { setAdding(false); await farm.refresh() }} />}
              <div className="mb-3 max-w-xs">
                <SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                  <option value="active">Active batches</option><option value="closed">Closed batches</option><option value="">All</option>
                </SelectField>
              </div>
              <DataTable<FarmBatch>
                rows={rows} total={rows.length} page={0} pageSize={Math.max(rows.length, 1)} onPage={() => {}} rowKey={(b) => b.id} onRowClick={(b) => setOpen(b.id)}
                emptyTitle="No batches" emptyHint={farm.can('farm.manage') ? 'Start your first batch above.' : 'A manager starts batches.'}
                columns={[
                  { key: 'code', header: 'Batch', render: (b) => <><b>{b.code}</b><div className="text-xs text-navy/60">{b.species}{b.variety ? ` · ${b.variety}` : ''} · {farm.unitName(b.unitId)}</div></> },
                  { key: 'pop', header: 'Animals now', align: 'right', render: (b) => <>{b.population.toLocaleString()} <CountBasis basis={b.basis} /></> },
                  { key: 'open', header: 'Opening', align: 'right', render: (b) => b.opening.toLocaleString() },
                  { key: 'mort', header: 'Mortality', align: 'right', render: (b) => `${mortalityRate(b).toFixed(1)}%` },
                  { key: 'status', header: 'Status', render: (b) => <Badge tone={b.status === 'active' ? 'success' : 'neutral'}>{label(b.status)}</Badge> },
                ]}
              />
              {open && <BatchDialog farm={farm} data={data} id={open} onClose={() => setOpen(null)} />}
            </>
          )
        }}
      </FarmGate>
    </>
  )
}

function StartBatch({ farm, units, onDone }: { farm: ReturnType<typeof useFarm>; units: FarmData['units']; onDone: () => Promise<void> }) {
  const [production, setProduction] = useState<Production>('poultry')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const runner = useFormRunner(onDone)
  const candidates = units.filter((u) => u.status === 'active' && u.productionType === production)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '')
    const next: Record<string, string> = {}
    if (!s('unit')) next.unit = 'Choose a production unit.'
    if (!s('code').trim()) next.code = 'Enter a batch code.'
    if (!s('species').trim()) next.species = 'Enter the species or crop.'
    if (!(Number(s('opening')) > 0)) next.opening = 'Enter the opening quantity.'
    if (s('end') && s('end') < s('start')) next.end = 'The end date is before the start date.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => startBatch(farm.businessId, {
      unitId: s('unit'), code: s('code'), species: s('species'), variety: s('variety'), productionType: production,
      opening: Number(s('opening')), startDate: s('start'), plannedEnd: s('end') || null, basis: s('basis') as 'exact' | 'estimated',
    }, k), 'Batch started.')
  }

  return (
    <Card className="mb-4">
      <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Production" value={production} onChange={(e) => setProduction(e.target.value as Production)}>
          <option value="poultry">Poultry</option><option value="fish">Fish</option><option value="crop">Crops</option><option value="livestock">Livestock</option>
        </SelectField>
        <SelectField label="Production unit" name="unit" defaultValue="" error={errors.unit} key={production}>
          <option value="" disabled>{candidates.length ? 'Select…' : 'No unit for this production type'}</option>
          {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </SelectField>
        <TextField label="Batch code" name="code" error={errors.code} placeholder="B-2026-05" />
        <TextField label="Species or crop" name="species" error={errors.species} placeholder="Layer, Catfish, Maize…" />
        <TextField label="Breed or variety (optional)" name="variety" />
        <TextField label="Opening quantity" name="opening" type="number" min="0" step="any" error={errors.opening} />
        <TextField label="Start date" name="start" type="date" defaultValue={today()} />
        <TextField label="Planned end (optional)" name="end" type="date" error={errors.end} />
        <SelectField label="Counts are" name="basis" defaultValue={production === 'fish' ? 'estimated' : 'exact'} key={`b-${production}`} hint="Fish counts are usually estimates.">
          <option value="exact">Exact head counts</option><option value="estimated">Estimates</option>
        </SelectField>
        <div className="space-y-2 sm:col-span-3">
          {runner.error && <ErrorState title="Batch not started" message={runner.error} />}
          <Button type="submit" loading={runner.busy}>Start batch</Button>
        </div>
      </form>
    </Card>
  )
}

function BatchDialog({ farm, data, id, onClose }: { farm: ReturnType<typeof useFarm>; data: FarmData; id: string; onClose: () => void }) {
  const batch = data.batches.find((b) => b.id === id)!
  const events = data.events.filter((e) => e.batchId === id)
  const [mode, setMode] = useState<'adjust' | 'close' | null>(null)
  const runner = useFormRunner(async () => { setMode(null); await farm.refresh() })
  const manage = farm.can('farm.manage') && batch.status === 'active'

  async function reverse(eventId: string) {
    const reason = window.prompt('Reason for correcting this entry?')
    if (reason) await runner.run((k) => reverseEvent(farm.businessId, eventId, reason, k), 'Correction posted.')
  }

  return (
    <Dialog title={`${batch.code} · ${batch.species}`} onClose={onClose} wide>
      {runner.error && <ErrorState message={runner.error} />}
      {runner.ok && <Notice>{runner.ok}</Notice>}
      <dl className="mb-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-navy/60">Animals now</dt><dd className="tabular font-semibold">{batch.population.toLocaleString()} <CountBasis basis={batch.basis} /></dd></div>
        <div><dt className="text-xs text-navy/60">Mortality</dt><dd className="tabular">{batch.mortality.toLocaleString()} ({mortalityRate(batch).toFixed(1)}%)</dd></div>
        <div><dt className="text-xs text-navy/60">Feed given</dt><dd className="tabular">{batch.feed.toLocaleString()}</dd></div>
        <div><dt className="text-xs text-navy/60">Produce harvested</dt><dd className="tabular">{batch.harvest.toLocaleString()}</dd></div>
      </dl>
      <h3 className="mb-1 text-sm font-semibold">Population ledger</h3>
      {events.length === 0 ? <EmptyState title="No entries" /> : (
        <ul className="mb-4 divide-y divide-navy/10 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <Badge tone={e.quantity > 0 ? 'success' : 'danger'}>{label(e.type)}</Badge>
              <span className="tabular font-medium">{e.quantity > 0 ? '+' : ''}{e.quantity.toLocaleString()}</span>
              <span className="text-navy/70">{e.reason}</span>
              {e.reversed && <span className="text-xs text-navy/50">(corrected)</span>}
              <span className="ml-auto text-xs text-navy/50">{dateTime(e.on)}</span>
              {manage && !e.reversed && ['mortality', 'removal', 'cull', 'adjustment'].includes(e.type) && <Button variant="ghost" onClick={() => void reverse(e.id)}>Correct</Button>}
            </li>
          ))}
        </ul>
      )}
      {manage && (
        <div className="flex flex-wrap gap-2 border-t border-navy/10 pt-3">
          <Button variant="secondary" onClick={() => setMode(mode === 'adjust' ? null : 'adjust')}>Cull or adjust count</Button>
          <Button variant="ghost" onClick={() => setMode(mode === 'close' ? null : 'close')}>Close batch</Button>
        </div>
      )}
      {mode === 'adjust' && (
        <form className="mt-3 grid gap-3 sm:grid-cols-4" noValidate onSubmit={async (e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget)
          const qty = Number(f.get('qty')); const type = String(f.get('type')) as 'cull' | 'removal' | 'adjustment'
          if (!qty || (type !== 'adjustment' && qty < 0)) return
          await runner.run((k) => adjustPopulation(farm.businessId, id, type, qty, String(f.get('reason') ?? ''), today(), k), 'Count updated.')
        }}>
          <SelectField label="Type" name="type"><option value="cull">Cull</option><option value="removal">Sold or removed</option><option value="adjustment">Recount (+/−)</option></SelectField>
          <TextField label="Quantity" name="qty" type="number" step="any" hint="Use a negative number only for a recount." />
          <TextField label="Reason" name="reason" />
          <div className="flex items-end"><Button type="submit" loading={runner.busy}>Post</Button></div>
        </form>
      )}
      {mode === 'close' && (
        <form className="mt-3 space-y-3" noValidate onSubmit={async (e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget)
          await runner.run((k) => closeBatch(farm.businessId, id, String(f.get('reason') ?? ''), f.get('writeoff') === 'on', k), 'Batch closed.')
        }}>
          <Notice>Closing locks the batch. Any animals still counted must be written off, which is recorded in the ledger.</Notice>
          <TextField label="Reason for closing" name="reason" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="writeoff" /> Write off the {batch.population.toLocaleString()} animals still counted</label>
          <Button type="submit" loading={runner.busy}>Close batch</Button>
        </form>
      )}
    </Dialog>
  )
}
