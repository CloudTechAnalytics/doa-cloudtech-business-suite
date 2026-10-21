import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, TextField } from '@/shared/components'
import { Dialog } from '@/shared/components/dialog'
import { useAsync } from '@/shared/hooks/useAsync'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { naira } from '@/shared/utilities/format'
import { FarmGate, sumByUnit, today } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { startBatch } from '../services/farmApi'
import { listBatchCosts } from '../services/opsApi'
import type { FarmBatch, FarmData } from '../types'

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000)

/** Crop cycles from planting to harvest. A cycle is a farm batch of crops, so its harvests, costs and closing use the same records. */
export function FarmCropsPage() {
  const { active } = useBusiness()
  const farm = useFarm()
  const businessId = active?.id ?? ''
  const costs = useAsync(() => listBatchCosts(businessId), [businessId])
  const [adding, setAdding] = useState(false)
  if (!active) return null

  return (
    <>
      <PageHeader title="Crops" description="Each crop cycle runs from planting to harvest. Harvests are recorded on the Harvests page and costs on the Expenses page, both against the cycle."
        actions={farm.can('farm.manage') ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Start a crop cycle</Button> : undefined} />
      <FarmGate farm={farm}>
        {(data) => {
          const cycles = data.batches.filter((b) => b.productionType === 'crop').sort((a, b) => b.startDate.localeCompare(a.startDate))
          const fields = data.units.filter((u) => u.productionType === 'crop' && u.status === 'active')
          return (
            <>
              {cycles.length === 0 ? (
                <Card><EmptyState title="No crop cycles yet" description={fields.length ? 'Start a cycle when you plant a field.' : 'Add a field under Production Units (production: crops), then start a cycle.'} /></Card>
              ) : (
                <Card className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Cycle</th><th className="p-3">Planted</th><th className="p-3">Harvest</th><th className="p-3 text-right">Area planted</th><th className="p-3 text-right">Harvested</th><th className="p-3 text-right">Costs</th><th className="p-3">Status</th></tr></thead>
                    <tbody className="divide-y divide-ink/10">
                      {cycles.map((c) => <Row key={c.id} c={c} data={data} farm={farm} cost={costs.data?.get(c.id) ?? 0} />)}
                    </tbody>
                  </table>
                </Card>
              )}
              <Notice>To harvest a crop, use <Link className="font-semibold underline" to="/app/farm/harvests">Harvests</Link>. To close a finished cycle, use <Link className="font-semibold underline" to="/app/farm/batches">Farm Batches</Link>.</Notice>
              {adding && <StartCycle businessId={businessId} fields={fields} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await farm.refresh() }} />}
            </>
          )
        }}
      </FarmGate>
    </>
  )
}

function Row({ c, data, farm, cost }: { c: FarmBatch; data: FarmData; farm: ReturnType<typeof useFarm>; cost: number }) {
  const harvested = sumByUnit(data.harvests.filter((h) => h.batchId === c.id && h.status === 'posted').map((h) => ({ quantity: h.quantity, unit: farm.productUnit(h.productId) })))
  const due = c.plannedEnd
  const late = c.status === 'active' && due !== null && due < today()
  const age = daysBetween(c.startDate, c.status === 'active' ? today() : (c.plannedEnd ?? today()))
  return (
    <tr>
      <td className="p-3"><b>{c.species}</b>{c.variety ? ` · ${c.variety}` : ''}<div className="text-xs text-ink/60">{c.code} · {farm.unitName(c.unitId)}</div></td>
      <td className="p-3 whitespace-nowrap">{c.startDate}<div className="text-xs text-ink/60">{c.status === 'active' ? `${age} days ago` : ''}</div></td>
      <td className="p-3 whitespace-nowrap">{due ?? 'Not set'}{late && <> <Badge tone="warning">Overdue</Badge></>}</td>
      <td className="tabular p-3 text-right">{c.opening.toLocaleString()}</td>
      <td className="tabular p-3 text-right">{harvested}</td>
      <td className="tabular p-3 text-right">{naira(cost)}</td>
      <td className="p-3"><Badge tone={c.status === 'active' ? 'success' : 'neutral'}>{c.status === 'active' ? 'Growing' : 'Closed'}</Badge></td>
    </tr>
  )
}

function StartCycle({ businessId, fields, onClose, onSaved }: { businessId: string; fields: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const runner = useFormRunner(onSaved)
  const [errors, setErrors] = useState<Record<string, string>>({})
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim()
    const next: Record<string, string> = {}
    if (!s('field')) next.field = 'Choose the field.'
    if (!s('crop')) next.crop = 'Enter the crop.'
    if (!s('code')) next.code = 'Enter a cycle code.'
    if (!(Number(s('area')) > 0)) next.area = 'Enter the area planted.'
    if (s('end') && s('end') < s('start')) next.end = 'Harvest cannot be before planting.'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => startBatch(businessId, { unitId: s('field'), code: s('code'), species: s('crop'), variety: s('variety'), productionType: 'crop', opening: Number(s('area')), startDate: s('start'), plannedEnd: s('end') || null, basis: 'exact' }, k), 'Crop cycle started.')
  }
  return (
    <Dialog title="Start a crop cycle" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {fields.length === 0 && <Notice>Add a field first: Production Units, production &quot;Crops&quot;.</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Field" name="field" defaultValue="" error={errors.field}><option value="" disabled>Select…</option>{fields.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</SelectField>
          <TextField label="Cycle code" name="code" error={errors.code} placeholder="e.g. C-2026-01" maxLength={40} />
          <TextField label="Crop" name="crop" error={errors.crop} placeholder="e.g. Maize" />
          <TextField label="Variety (optional)" name="variety" />
          <TextField label="Area planted" name="area" type="number" min="0" step="any" error={errors.area} hint="In hectares, plots or whichever unit you use consistently." />
          <TextField label="Planted on" name="start" type="date" defaultValue={today()} max={today()} />
          <TextField label="Expected harvest (optional)" name="end" type="date" error={errors.end} />
        </div>
        {runner.error && <ErrorState title="Not started" message={runner.error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={runner.busy} disabled={fields.length === 0}>Start cycle</Button></div>
      </form>
    </Dialog>
  )
}
