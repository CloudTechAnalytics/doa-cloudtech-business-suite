import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, ErrorState, Notice, SelectField, TextField } from '@/shared/components'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { BatchSelect, today } from './farmUi'
import type { FarmContext } from '../hooks/useFarm'
import { recordFeeding, recordHarvest, recordMortality } from '../services/farmApi'

type Catalog = NonNullable<FarmContext['catalog']>
interface FormProps { farm: FarmContext; catalog: Catalog; /** Called after a record is saved (the farm data is already refreshed). */ onSaved?: () => void }

/** Shown in place of a record form when there is nothing to record against yet. */
function NoBatches({ farm }: { farm: FarmContext }) {
  return <Notice>There is no active flock, pond or crop to record against yet. {farm.can('farm.manage') ? <Link to="/app/farm/batches" className="underline">Start one first</Link> : 'Ask a manager to start one.'}</Notice>
}

/** Feed given to a batch. The feed is taken from stock once, when it is recorded. */
export function FeedForm({ farm, catalog, onSaved }: FormProps) {
  const runner = useFormRunner(farm.refresh)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [product, setProduct] = useState('')
  const [location, setLocation] = useState('')
  if (!farm.activeBatches.length) return <NoBatches farm={farm} />
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
    await runner.run((k) => recordFeeding(farm.businessId, s('batch'), product, loc, Number(s('qty')), s('date'), s('notes'), k), 'Feeding recorded and stock updated.', () => { form.reset(); setProduct(''); onSaved?.() })
  }
  return (
    <Card className="mb-4">
      <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-3">
        <BatchSelect batches={farm.activeBatches} error={errors.batch} />
        <SelectField label="Feed" value={product} onChange={(e) => setProduct(e.target.value)} error={errors.product} hint={product ? `In stock: ${onHand.toLocaleString()} ${unit}` : 'Feed comes from your stock.'}>
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
  )
}

/** Deaths in a batch, which lower its count. */
export function DeathsForm({ farm, onSaved }: Omit<FormProps, 'catalog'>) {
  const runner = useFormRunner(farm.refresh)
  const [errors, setErrors] = useState<Record<string, string>>({})
  if (!farm.activeBatches.length) return <NoBatches farm={farm} />
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget; const f = new FormData(form); const s = (k: string) => String(f.get(k) ?? '')
    const next: Record<string, string> = {}
    if (!s('batch')) next.batch = 'Choose a batch.'
    if (!(Number(s('qty')) > 0)) next.qty = 'Enter how many died.'
    if (s('cause').trim().length < 3) next.cause = 'Give a cause (at least 3 characters).'
    setErrors(next)
    if (Object.keys(next).length) return
    await runner.run((k) => recordMortality(farm.businessId, s('batch'), Number(s('qty')), s('cause'), s('date'), k), 'Deaths recorded.', () => { form.reset(); onSaved?.() })
  }
  return (
    <Card className="mb-4">
      <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-4">
        <BatchSelect batches={farm.activeBatches} error={errors.batch} />
        <TextField label="Number that died" name="qty" type="number" min="1" step="any" error={errors.qty} />
        <TextField label="Cause" name="cause" error={errors.cause} placeholder="Disease, heat, predator…" />
        <TextField label="Date" name="date" type="date" defaultValue={today()} max={today()} />
        <div className="space-y-2 sm:col-span-4">
          {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
          {runner.ok && <Notice>{runner.ok}</Notice>}
          <Button type="submit" loading={runner.busy}>Record deaths</Button>
        </div>
      </form>
    </Card>
  )
}

/** Eggs, fish, crops or other produce collected from a batch. It goes into stock, ready to sell. */
export function HarvestForm({ farm, catalog, onSaved }: FormProps) {
  const runner = useFormRunner(farm.refresh)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [product, setProduct] = useState('')
  if (!farm.activeBatches.length) return <NoBatches farm={farm} />
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
    await runner.run((k) => recordHarvest(farm.businessId, s('batch'), product, s('location'), Number(s('qty')), s('date'), s('animals') === '' ? null : Number(s('animals')), k), 'Harvest recorded and added to stock.', () => { form.reset(); setProduct(''); onSaved?.() })
  }
  return (
    <Card className="mb-4">
      <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-3">
        <BatchSelect batches={farm.activeBatches} error={errors.batch} />
        <SelectField label="What was collected" value={product} onChange={(e) => setProduct(e.target.value)} error={errors.product} hint="Items such as eggs or catfish are added under What you sell.">
          <option value="">Select…</option>{catalog.products.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
        </SelectField>
        <SelectField label="Add to" name="location">{catalog.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField>
        <TextField label={`Quantity${unit ? ` (${unit})` : ''}`} name="qty" type="number" min="0" step="any" error={errors.qty} />
        <TextField label="Animals taken out (optional)" name="animals" type="number" min="0" step="any" error={errors.animals} hint="For animals harvested or sold live. Lowers the batch count." />
        <TextField label="Date" name="date" type="date" defaultValue={today()} max={today()} />
        <div className="space-y-2 sm:col-span-3">
          {runner.error && <ErrorState title="Not recorded" message={runner.error} />}
          {runner.ok && <Notice>{runner.ok}</Notice>}
          <Button type="submit" loading={runner.busy}>Record harvest</Button>
        </div>
      </form>
    </Card>
  )
}
