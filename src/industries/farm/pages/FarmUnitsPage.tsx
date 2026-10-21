import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Card, ErrorState, PageHeader, SelectField, TextField } from '@/shared/components'
import { DataTable } from '@/shared/tables/DataTable'
import { FarmGate } from '../components/farmUi'
import { useFarm } from '../hooks/useFarm'
import { createUnit } from '../services/farmApi'
import { UNIT_TYPES } from '../types'
import type { FarmUnit, Production } from '../types'

export function FarmUnitsPage() {
  const farm = useFarm()
  const [production, setProduction] = useState<Production>('poultry')
  const [error, setError] = useState<string | null>(null)
  const [nameErr, setNameErr] = useState<string | undefined>()

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget; const f = new FormData(form)
    const name = String(f.get('name') ?? '').trim()
    const cap = String(f.get('capacity') ?? '')
    if (!name) return setNameErr('Enter the unit name.')
    if (cap !== '' && !(Number(cap) > 0)) return setNameErr('Capacity must be greater than zero.')
    setNameErr(undefined)
    const err = await createUnit(farm.businessId, { name, unitType: String(f.get('type')), productionType: production, capacity: cap === '' ? null : Number(cap) })
    setError(err)
    if (!err) { form.reset(); await farm.refresh() }
  }

  return (
    <>
      <PageHeader title="Production units" description="The houses, ponds, tanks, fields and pens where batches are kept." />
      {error && <ErrorState message={error} />}
      {farm.can('farm.manage') && (
        <Card className="mb-4">
          <form onSubmit={submit} noValidate className="grid items-end gap-3 sm:grid-cols-5">
            <TextField label="Name" name="name" error={nameErr} />
            <SelectField label="Production" value={production} onChange={(e) => setProduction(e.target.value as Production)}>
              <option value="poultry">Poultry</option><option value="fish">Fish</option><option value="crop">Crops</option><option value="livestock">Livestock</option>
            </SelectField>
            <SelectField label="Type" name="type" key={production}>{UNIT_TYPES[production].map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</SelectField>
            <TextField label="Capacity (optional)" name="capacity" type="number" min="0" step="any" />
            <Button type="submit">Add unit</Button>
          </form>
        </Card>
      )}
      <FarmGate farm={farm}>
        {(data) => (
          <DataTable<FarmUnit>
            rows={data.units} total={data.units.length} page={0} pageSize={Math.max(data.units.length, 1)} onPage={() => {}} rowKey={(u) => u.id}
            emptyTitle="No production units yet" emptyHint="Add a house, pond or field before starting a batch."
            columns={[
              { key: 'name', header: 'Unit', render: (u) => <b>{u.name}</b> },
              { key: 'type', header: 'Type', render: (u) => u.unitType.replace('_', ' ') },
              { key: 'prod', header: 'Production', render: (u) => u.productionType },
              { key: 'cap', header: 'Capacity', align: 'right', render: (u) => u.capacity ?? '–' },
              { key: 'batches', header: 'Active batches', align: 'right', render: (u) => data.batches.filter((b) => b.unitId === u.id && b.status === 'active').length },
            ]}
          />
        )}
      </FarmGate>
    </>
  )
}
