import { useState } from 'react'
import { Card, EmptyState, PageHeader } from '@/shared/components'
import { ConfirmDelete } from '@/shared/components/ConfirmDelete'
import { ShowDeleted, deleteKey } from '@/shared/components/ShowDeleted'
import { dateTime } from '@/shared/utilities/format'
import { FarmGate, ReadOnlyNotice } from '../components/farmUi'
import { HarvestForm } from '../components/recordForms'
import { useFarm } from '../hooks/useFarm'
import { voidHarvest } from '../services/farmApi'

export function FarmHarvestsPage() {
  const farm = useFarm()
  const [showDeleted, setShowDeleted] = useState(false)
  const can = farm.can('farm.record')

  return (
    <>
      <PageHeader title="Harvests and eggs" description="Eggs, fish, crops and other produce collected. It goes into your stock, ready to sell. Animals harvested or sold live can also leave the batch count." />
      <FarmGate farm={farm}>
        {(data, catalog) => {
          const rows = data.harvests.filter((h) => showDeleted || h.status !== 'voided')
          return (
            <>
              <ReadOnlyNotice show={!can} />
              {can && <HarvestForm farm={farm} catalog={catalog} />}
              {rows.length === 0 ? <EmptyState title="No harvests recorded yet" /> : (
                <Card className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-surface text-left text-xs font-semibold text-ink/70"><tr><th className="p-3">Date</th><th className="p-3">Batch</th><th className="p-3">Produce</th><th className="p-3 text-right">Quantity</th><th className="p-3 text-right">Animals</th><th className="p-3" /></tr></thead>
                    <tbody className="divide-y divide-ink/10">
                      {rows.slice(0, 50).map((h) => (
                        <tr key={h.id} className={h.status === 'voided' ? 'opacity-50' : ''}>
                          <td className="p-3 whitespace-nowrap">{dateTime(h.date)}</td><td className="p-3">{farm.batchCode(h.batchId)}</td><td className="p-3">{farm.productName(h.productId)}</td>
                          <td className="p-3 text-right tabular">{h.quantity.toLocaleString()} {farm.productUnit(h.productId)}</td><td className="p-3 text-right tabular">{h.animalsRemoved ?? '–'}</td>
                          <td className="p-3 text-right">{h.status === 'voided' ? <span className="text-xs">Deleted</span> : farm.can('farm.manage') && (
                            <ConfirmDelete compact withReason noun="harvest" label={`${h.quantity} ${farm.productUnit(h.productId)} ${farm.productName(h.productId)} from ${farm.batchCode(h.batchId)}`} warning="The produce is taken back out of stock, and any animals taken out are counted in the batch again." onConfirm={(why) => voidHarvest(farm.businessId, h.id, why, deleteKey())} onDeleted={farm.refresh} />
                          )}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
              <ShowDeleted count={data.harvests.filter((h) => h.status === 'voided').length} show={showDeleted} onChange={setShowDeleted} />
            </>
          )
        }}
      </FarmGate>
    </>
  )
}
