import { FarmGate, Stat, sumByUnit, withinDays } from './farmUi'
import { useFarm } from '../hooks/useFarm'
import type { FarmContext } from '../hooks/useFarm'

/** The four headline farm figures, derived from the ledgers (not demo numbers). */
export function FarmKpis({ farm }: { farm: FarmContext }) {
  return (
    <FarmGate farm={farm}>
      {(data) => {
        const active = data.batches.filter((b) => b.status === 'active')
        const animals = active.reduce((a, b) => a + b.population, 0)
        const deaths = active.reduce((a, b) => a + b.mortality, 0)
        const entered = active.reduce((a, b) => a + b.entering, 0)
        const feed = data.feeds.filter((f) => f.status === 'posted' && withinDays(f.on, 7)).map((f) => ({ quantity: f.quantity, unit: farm.productUnit(f.productId) }))
        const harvest = data.harvests.filter((h) => h.status === 'posted' && withinDays(h.date, 7)).map((h) => ({ quantity: h.quantity, unit: farm.productUnit(h.productId) }))
        return (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Live animals" value={animals.toLocaleString()} note={`${active.length} active batch${active.length === 1 ? '' : 'es'}`} />
            <Stat label="Mortality (active batches)" value={`${(entered ? (deaths / entered) * 100 : 0).toFixed(1)}%`} note="Deaths ÷ animals entered, net of corrections" />
            <Stat label="Feed used (7 days)" value={sumByUnit(feed)} note="Posted feeding records" />
            <Stat label="Harvested (7 days)" value={sumByUnit(harvest)} note="Posted harvest records" />
          </div>
        )
      }}
    </FarmGate>
  )
}

/** Dashboard widget: fetches its own data so it works wherever the dashboard shows it. */
export function FarmDashboardWidget() {
  const farm = useFarm()
  return <FarmKpis farm={farm} />
}
