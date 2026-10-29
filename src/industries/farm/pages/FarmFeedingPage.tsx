import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader } from '@/shared/components'
import { useFormRunner } from '@/shared/hooks/useFormRunner'
import { dateTime } from '@/shared/utilities/format'
import { FarmGate, ReadOnlyNotice } from '../components/farmUi'
import { FeedForm } from '../components/recordForms'
import { useFarm } from '../hooks/useFarm'
import { voidFeeding } from '../services/farmApi'

export function FarmFeedingPage() {
  const farm = useFarm()
  const runner = useFormRunner(farm.refresh)
  const can = farm.can('farm.record')

  return (
    <>
      <PageHeader title="Feeding" description="Feed given to each flock, pond or herd. Feed is taken from your stock once, when you record it. Voiding a record puts the feed back." />
      <FarmGate farm={farm}>
        {(data, catalog) => (
          <>
            <ReadOnlyNotice show={!can} />
            {can && <FeedForm farm={farm} catalog={catalog} />}
            {runner.error && <ErrorState message={runner.error} />}
            {runner.ok && <Notice>{runner.ok}</Notice>}
            {data.feeds.length === 0 ? <EmptyState title="No feeding recorded yet" /> : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Date</th><th className="p-3">Batch</th><th className="p-3">Feed</th><th className="p-3 text-right">Quantity</th><th className="p-3" /></tr></thead>
                  <tbody className="divide-y divide-ink/10">
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
        )}
      </FarmGate>
    </>
  )
}
