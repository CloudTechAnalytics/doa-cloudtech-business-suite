import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader } from '@/shared/components'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { dateTime } from '@/shared/utilities/format'
import { FarmGate, ReadOnlyNotice } from '../components/farmUi'
import { HarvestForm } from '../components/recordForms'
import { useFarm } from '../hooks/useFarm'
import { voidHarvest } from '../services/farmApi'

export function FarmHarvestsPage() {
  const farm = useFarm()
  const runner = useFormRunner(farm.refresh)
  const can = farm.can('farm.record')

  return (
    <>
      <PageHeader title="Harvests and eggs" description="Eggs, fish, crops and other produce collected. It goes into your stock, ready to sell. Animals harvested or sold live can also leave the batch count." />
      <FarmGate farm={farm}>
        {(data, catalog) => (
          <>
            <ReadOnlyNotice show={!can} />
            {can && <HarvestForm farm={farm} catalog={catalog} />}
            {runner.error && <ErrorState message={runner.error} />}
            {runner.ok && <Notice>{runner.ok}</Notice>}
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
        )}
      </FarmGate>
    </>
  )
}
