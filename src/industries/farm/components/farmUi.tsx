import type { ReactNode } from 'react'
import { Badge, Card, ErrorState, Notice, SelectField, Spinner } from '@/shared/components'
import type { FarmContext } from '../hooks/useFarm'
import type { FarmBatch } from '../types'

/** Shows a spinner or error until the farm data is ready, then renders the page. */
export function FarmGate({ farm, children }: { farm: FarmContext; children: (data: NonNullable<FarmContext['data']>, catalog: NonNullable<FarmContext['catalog']>) => ReactNode }) {
  if (farm.error) return <ErrorState message={farm.error} />
  if (!farm.data || !farm.catalog) return <Spinner />
  return <>{children(farm.data, farm.catalog)}</>
}

export function BatchSelect({ batches, name = 'batch', error, label = 'Batch' }: { batches: FarmBatch[]; name?: string; error?: string; label?: string }) {
  return (
    <SelectField label={label} name={name} defaultValue="" error={error}>
      <option value="" disabled>Select…</option>
      {batches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.species} ({b.population} now)</option>)}
    </SelectField>
  )
}

export const CountBasis = ({ basis }: { basis: FarmBatch['basis'] }) => (basis === 'estimated' ? <Badge tone="info">Estimate</Badge> : null)

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-navy/60">{label}</p>
      <p className="tabular mt-2 text-2xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-xs text-navy/60">{note}</p>}
    </Card>
  )
}

export function ReadOnlyNotice({ show }: { show: boolean }) {
  return show ? <Notice>Your role can view these records but not add to them.</Notice> : null
}

/** Sums quantities per unit so mixed units are never added together. */
export function sumByUnit(rows: { quantity: number; unit: string }[]): string {
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.unit, (totals.get(r.unit) ?? 0) + r.quantity)
  if (!totals.size) return '0'
  return [...totals].map(([u, q]) => `${Math.round(q * 100) / 100} ${u}`.trim()).join(', ')
}

export const withinDays = (iso: string, days: number) => Date.now() - new Date(iso).getTime() <= days * 86400000
export const today = () => new Date().toISOString().slice(0, 10)
