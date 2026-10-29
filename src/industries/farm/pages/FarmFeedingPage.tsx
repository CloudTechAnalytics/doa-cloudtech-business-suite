import { useState } from 'react'
import { Card, EmptyState, PageHeader } from '@/shared/components'
import { ConfirmDelete } from '@/shared/components/ConfirmDelete'
import { ShowDeleted, deleteKey } from '@/shared/components/ShowDeleted'
import { dateTime } from '@/shared/utilities/format'
import { FarmGate, ReadOnlyNotice } from '../components/farmUi'
import { FeedForm } from '../components/recordForms'
import { useFarm } from '../hooks/useFarm'
import { voidFeeding } from '../services/farmApi'

export function FarmFeedingPage() {
  const farm = useFarm()
  const [showDeleted, setShowDeleted] = useState(false)
  const can = farm.can('farm.record')

  return (
    <>
      <PageHeader title="Feeding" description="Feed given to each flock or pond. Feed is taken from your stock when you record it; deleting a record puts the feed back." />
      <FarmGate farm={farm}>
        {(data, catalog) => {
          const rows = data.feeds.filter((r) => showDeleted || r.status !== 'voided')
          return (
            <>
              <ReadOnlyNotice show={!can} />
              {can && <FeedForm farm={farm} catalog={catalog} />}
              {rows.length === 0 ? <EmptyState title="No feeding recorded yet" /> : (
                <Card className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Date</th><th className="p-3">Batch</th><th className="p-3">Feed</th><th className="p-3 text-right">Quantity</th><th className="p-3" /></tr></thead>
                    <tbody className="divide-y divide-ink/10">
                      {rows.slice(0, 50).map((r) => (
                        <tr key={r.id} className={r.status === 'voided' ? 'opacity-50' : ''}>
                          <td className="p-3 whitespace-nowrap">{dateTime(r.on)}</td><td className="p-3">{farm.batchCode(r.batchId)}</td><td className="p-3">{farm.productName(r.productId)}</td>
                          <td className="p-3 text-right tabular">{r.quantity.toLocaleString()} {farm.productUnit(r.productId)}</td>
                          <td className="p-3 text-right">{r.status === 'voided' ? <span className="text-xs">Deleted</span> : farm.can('farm.manage') && (
                            <ConfirmDelete compact withReason noun="feeding record" label={`${r.quantity} ${farm.productUnit(r.productId)} ${farm.productName(r.productId)} for ${farm.batchCode(r.batchId)}`} warning="The feed goes back into stock." onConfirm={(why) => voidFeeding(farm.businessId, r.id, why, deleteKey())} onDeleted={farm.refresh} />
                          )}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
              <ShowDeleted count={data.feeds.filter((r) => r.status === 'voided').length} show={showDeleted} onChange={setShowDeleted} />
            </>
          )
        }}
      </FarmGate>
    </>
  )
}
