import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SelectField, TextField } from '@/shared/components'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { dateTime } from '@/shared/utilities/format'
import { BatchSelect, FarmGate, ReadOnlyNotice, today } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { recordFeeding, voidFeeding } from '../services/farmApi'

export function FarmFeedingPage() {
  const farm = useFarm()
  const runner = useFormRunner(farm.refresh)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [product, setProduct] = useState('')
  const [location, setLocation] = useState('')
  const can = farm.can('farm.record')

  return (
    <>
      <PageHeader title="Feeding" description="Feed is taken from your stock exactly once, when you record it. Voiding a record puts the feed back." />
      <FarmGate farm={farm}>
        {(data, catalog) => {
          const loc = location || catalog.locations[0]?.id || ''
          const onHand = catalog.balances.filter((b) => b.productId === product && b.locationId === loc).reduce((a, b) => a + b.qty, 0)
          const unit = catalog.products.find((p) => p.id === product)?.unit ?? ''
          async function submit(e: FormEvent<HTMLFormElement>) {
            e.preventDefault()
            const form = e.currentTarget; const f = new FormData(form); const s = (k: string) => String(f.get(k) ?? '')
            const next: Record<string, string> = {}
            if (!s('batch')) next.batch = 'Choose a batch.'
            if (!product) next.product = 'Choose the feed.'
            if (!(Number(s('qty')) > 0)) next.qty = 'Enter a quantity above zero.'
            setErrors(next)
            if (Object.keys(next).length) return
            await runner.run((k) => recordFeeding(farm.businessId, s('batch'), product, loc, Number(s('qty')), s('date'), s('notes'), k), 'Feeding recorded and stock updated.', () => { form.reset(); setProduct('') })
          }
          return (
            <>
              <ReadOnlyNotice show={!can} />
              {can && (
                <Card className="mb-4">
                  <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-3">
                    <BatchSelect batches={farm.activeBatches} error={errors.batch} />
                    <SelectField label="Feed" value={product} onChange={(e) => setProduct(e.target.value)} error={errors.product} hint={product ? `In stock: ${onHand.toLocaleString()} ${unit}` : undefined}>
                      <option value="">Select…</option>{catalog.products.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
                    </SelectField>
                    <SelectField label="Take from" value={loc} onChange={(e) => setLocation(e.target.value)}>{catalog.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
                    <TextField label={`Quantity${unit ? ` (${unit})` : ''}`} name="qty" type="number" min="0" step="any" error={errors.qty} />
                    <TextField label="Date" name="date" type="date" defaultValue={today()} max={today()} />
                    <TextField label="Notes (optional)" name="notes" />
                    <div className="space-y-2 sm:col-span-3">
                      {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
                      {runner.ok && <Notice>{runner.ok}</Notice>}
                      <Button type="submit" loading={runner.busy}>Record feeding</Button>
                    </div>
                  </form>
                </Card>
              )}
              {data.feeds.length === 0 ? <EmptyState title="No feeding recorded yet" /> : (
                <Card className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-surface text-left text-xs uppercase text-navy/60"><tr><th className="p-3">Date</th><th className="p-3">Batch</th><th className="p-3">Feed</th><th className="p-3 text-right">Quantity</th><th className="p-3" /></tr></thead>
                    <tbody className="divide-y divide-navy/10">
                      {data.feeds.slice(0, 50).map((r) => (
                        <tr key={r.id} className={r.status === 'voided' ? 'opacity-50' : ''}>
                          <td className="p-3 whitespace-nowrap">{dateTime(r.on)}</td><td className="p-3">{farm.batchCode(r.batchId)}</td><td className="p-3">{farm.productName(r.productId)}</td>
                          <td className="p-3 text-right tabular">{r.quantity.toLocaleString()} {farm.productUnit(r.productId)}</td>
                          <td className="p-3 text-right">{r.status === 'voided' ? <Badge tone="danger">Voided</Badge> : farm.can('farm.manage') && (
                            <Button variant="ghost" onClick={async () => { const why = window.prompt('Reason for voiding this feeding record?'); if (why) await runner.run((k) => voidFeeding(farm.businessId, r.id, why, k), 'Voided; feed returned to stock.') }}>Void</Button>
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
