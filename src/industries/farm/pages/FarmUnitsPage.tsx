import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Card, ErrorState, PageHeader, SelectField, TextField } from '@/shared/components'
import { DeleteButton } from '@/shared/components/delete-button'
import { DataTable } from '@/shared/tables/DataTable'
import { FarmGate } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { createUnit } from '../services/farmApi'
import { UNIT_TYPES } from '../types'
import type { FarmUnit, Production } from '../types'

const PRODUCTION: { value: Production; label: string; example: string }[] = [
  { value: 'poultry', label: 'Birds (chickens, turkeys…)', example: 'e.g. Pen A, Layer house 1' },
  { value: 'fish', label: 'Fish', example: 'e.g. Pond 1, Tank B' },
  { value: 'crop', label: 'Crops', example: 'e.g. Back field, Maize plot' },
  { value: 'livestock', label: 'Animals (goats, pigs, cattle…)', example: 'e.g. Goat pen, Pig sty 2' },
]
const KIND: Record<Production, string> = { poultry: 'Birds', fish: 'Fish', crop: 'Crops', livestock: 'Animals' }

/** The places where animals and crops are kept. Each flock, fish stock or crop is started in one of them. */
export function FarmUnitsPage() {
  const farm = useFarm()
  const [production, setProduction] = useState<Production>('poultry')
  const [error, setError] = useState<string | null>(null)
  const [nameErr, setNameErr] = useState<string | undefined>()
  const example = PRODUCTION.find((p) => p.value === production)!.example

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget; const f = new FormData(form)
    const name = String(f.get('name') ?? '').trim()
    const cap = String(f.get('capacity') ?? '')
    if (!name) return setNameErr('Give it a name you will recognise, for example "Pen A".')
    if (cap !== '' && !(Number(cap) > 0)) return setNameErr('How many it holds must be more than zero.')
    setNameErr(undefined)
    const err = await createUnit(farm.businessId, { name, unitType: String(f.get('type')), productionType: production, capacity: cap === '' ? null : Number(cap) })
    setError(err)
    if (!err) { form.reset(); await farm.refresh() }
  }

  return (
    <>
      <PageHeader title="Pens, ponds & fields" description="The places on your farm where animals or crops are kept: a poultry house, a pen, a pond, a tank or a field. Add each one once; then start a flock, fish stock or crop in it." />
      {error && <ErrorState message={error} />}
      {farm.can('farm.manage') && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">Add a place</h2>
          <form onSubmit={submit} noValidate className="grid items-end gap-3 sm:grid-cols-5">
            <SelectField label="What is kept there" value={production} onChange={(e) => setProduction(e.target.value as Production)}>
              {PRODUCTION.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </SelectField>
            <SelectField label="Kind of place" name="type" key={production}>{UNIT_TYPES[production].map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</SelectField>
            <TextField label="Its name" name="name" error={nameErr} placeholder={example} hint="What you call it on the farm." />
            <TextField label="How many it holds (optional)" name="capacity" type="number" min="0" step="any" hint={production === 'crop' ? 'Size, e.g. hectares.' : 'Number of animals.'} />
            <Button type="submit">Add</Button>
          </form>
        </Card>
      )}
      <FarmGate farm={farm}>
        {(data) => (
          <DataTable<FarmUnit>
            rows={data.units} total={data.units.length} page={0} pageSize={Math.max(data.units.length, 1)} onPage={() => {}} rowKey={(u) => u.id}
            emptyTitle="No pens, ponds or fields yet" emptyHint="Add one above before starting a flock, fish stock or crop."
            columns={[
              { key: 'name', header: 'Name', render: (u) => <b>{u.name}</b> },
              { key: 'type', header: 'Kind of place', render: (u) => UNIT_TYPES[u.productionType].find((t) => t.value === u.unitType)?.label ?? u.unitType.replace('_', ' ') },
              { key: 'prod', header: 'Kept there', render: (u) => KIND[u.productionType] },
              { key: 'cap', header: 'Holds', align: 'right', render: (u) => u.capacity ?? '–' },
              { key: 'batches', header: 'Running now', align: 'right', render: (u) => data.batches.filter((b) => b.unitId === u.id && b.status === 'active').length },
              ...(farm.can('farm.manage') ? [{ key: 'del', header: '', align: 'right' as const, render: (u: FarmUnit) => <DeleteButton compact businessId={farm.businessId} kind="farm_unit" id={u.id} label={u.name} noun="place" onDeleted={farm.refresh} /> }] : []),
            ]}
          />
        )}
      </FarmGate>
    </>
  )
}
