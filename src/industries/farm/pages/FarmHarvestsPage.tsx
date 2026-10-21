import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, TextField } from '@/shared/components'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { dateTime } from '@/shared/utilities/format'
import { BatchSelect, FarmGate, ReadOnlyNotice, today } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { recordHarvest, voidHarvest } from '../services/farmApi'

export function FarmHarvestsPage() {
  const farm = useFarm()
  const runner = useFormRunner(farm.refresh)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [product, setProduct] = useState('')
  const can = farm.can('farm.record')

  return (
    <>
      <PageHeader title="Harvests" description="Produce goes into your stock, ready to sell on the Sales page. Live animals sold or harvested can also leave the batch count." />
      <FarmGate farm={farm}>
        {(data, catalog) => {
          const unit = catalog.products.find((p) => p.id === product)?.unit ?? ''
          async function submit(e: FormEvent<HTMLFormElement>) {
            e.preventDefault()
            const form = e.currentTarget; const f = new FormData(form); const s = (k: string) => String(f.get(k) ?? '')
            const next: Record<string, string> = {}
            if (!s('batch')) next.batch = 'Choose a batch.'
            if (!product) next.product = 'Choose the produce item.'
            if (!(Number(s('qty')) > 0)) next.qty = 'Enter a quantity above zero.'
            if (s('animals') !== '' && !(Number(s('animals')) > 0)) next.animals = 'Must be above zero.'
            setErrors(next)
            if (Object.keys(next).length) return
            await runner.run((k) => recordHarvest(farm.businessId, s('batch'), product, s('location'), Number(s('qty')), s('date'), s('animals') === '' ? null : Number(s('animals')), k), 'Harvest recorded and added to stock.', () => { form.reset(); setProduct('') })
          }
          return (
            <>
              <ReadOnlyNotice show={!can} />
              {can && (
                <Card className="mb-4">
                  <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-3">
                    <BatchSelect batches={farm.activeBatches} error={errors.batch} />
                    <SelectField label="Produce item" value={product} onChange={(e) => setProduct(e.target.value)} error={errors.product} hint="Create items such as eggs or catfish under Inventory.">
                      <option value="">Select…</option>{catalog.products.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
                    </SelectField>
                    <SelectField label="Add to" name="location">{catalog.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
                    <TextField label={`Quantity${unit ? ` (${unit})` : ''}`} name="qty" type="number" min="0" step="any" error={errors.qty} />
                    <TextField label="Animals harvested (optional)" name="animals" type="number" min="0" step="any" error={errors.animals} hint="Removes them from the batch count." />
                    <TextField label="Date" name="date" type="date" defaultValue={today()} max={today()} />
                    <div className="space-y-2 sm:col-span-3">
                      {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
                      {runner.ok && <Notice>{runner.ok}</Notice>}
                      <Button type="submit" loading={runner.busy}>Record harvest</Button>
                    </div>
                  </form>
                </Card>
              )}
              {data.harvests.length === 0 ? <EmptyState title="No harvests recorded yet" /> : (
                <Card className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Date</th><th className="p-3">Batch</th><th className="p-3">Produce</th><th className="p-3 text-right">Quantity</th><th className="p-3 text-right">Animals</th><th className="p-3" /></tr></thead>
                    <tbody className="divide-y divide-ink/10">
                      {data.harvests.slice(0, 50).map((h) => (
                        <tr key={h.id} className={h.status === 'voided' ? 'opacity-50' : ''}>
                          <td className="p-3 whitespace-nowrap">{dateTime(h.date)}</td><td className="p-3">{farm.batchCode(h.batchId)}</td><td className="p-3">{farm.productName(h.productId)}</td>
                          <td className="p-3 text-right tabular">{h.quantity.toLocaleString()} {farm.productUnit(h.productId)}</td><td className="p-3 text-right tabular">{h.animalsRemoved ?? '–'}</td>
                          <td className="p-3 text-right">{h.status === 'voided' ? <Badge tone="danger">Voided</Badge> : farm.can('farm.manage') && (
                            <Button variant="ghost" onClick={async () => { const why = window.prompt('Reason for voiding this harvest?'); if (why) await runner.run((k) => voidHarvest(farm.businessId, h.id, why, k), 'Voided; produce removed from stock.') }}>Void</Button>
                          )}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          )
        }}
      </FarmGate>
    </>
  )
}
