import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FormEvent } from 'react'
import { Badge, Button, Card, ErrorState, PageHeader, SelectField, TextField } from '@/shared/components'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { DataTable } from '@/shared/tables/DataTable'
import { label } from '@/shared/utilities/format'
import { BatchPage } from '../components/BatchPage'
import { CountBasis, FarmGate, today } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { startBatch } from '../services/farmApi'
import { mortalityRate } from '../types'
import type { FarmBatch, FarmData, Production } from '../types'

export function FarmBatchesPage() {
  const farm = useFarm()
  const [adding, setAdding] = useState(false)
  const [params, setParams] = useSearchParams()
  const open = params.get('open')
  const setOpen = (id: string | null) => setParams(id ? { open: id } : {}, { replace: !id })
  const [status, setStatus] = useState<'active' | 'closed' | ''>('active')

  return (
    <>
      <PageHeader title="Flocks & batches" description="Each flock, fish stock, herd or crop. Open one to see its figures and history, and to record feeding, deaths and harvests for it."
        actions={farm.can('farm.manage') ? <Button onClick={() => setAdding((a) => !a)}>{adding ? 'Close form' : 'Start a flock or batch'}</Button> : undefined} />
      <FarmGate farm={farm}>
        {(data, catalog) => {
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
                  { key: 'code', header: 'Batch', render: (b) => <><b>{b.code}</b><div className="text-xs text-ink/60">{b.species}{b.variety ? ` · ${b.variety}` : ''} · {farm.unitName(b.unitId)}</div></> },
                  { key: 'pop', header: 'Count now', align: 'right', render: (b) => <>{b.population.toLocaleString()} <CountBasis basis={b.basis} /></> },
                  { key: 'open', header: 'Opening', align: 'right', render: (b) => b.opening.toLocaleString() },
                  { key: 'mort', header: 'Died', align: 'right', render: (b) => `${mortalityRate(b).toFixed(1)}%` },
                  { key: 'status', header: 'Status', render: (b) => <Badge tone={b.status === 'active' ? 'success' : 'neutral'}>{label(b.status)}</Badge> },
                ]}
              />
              {open && <BatchPage farm={farm} data={data} catalog={catalog} id={open} onClose={() => setOpen(null)} />}
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
