import { useBusiness } from '@/core/business-context/BusinessProvider'
import { usePermissions } from '@/core/permissions/usePermissions'
import { loadCatalog } from '@/modules/sales/tradeApi'
import { useAsync } from '@/shared/hooks/useAsync'
import { loadFarm } from '../services/farmApi'

/** Farm records, the shared product/location catalogue (for feed and produce), and the user's permissions. */
export function useFarm() {
  const { active } = useBusiness()
  const businessId = active?.id ?? ''
  const farm = useAsync(() => loadFarm(businessId), [businessId])
  const catalog = useAsync(() => loadCatalog(businessId, 'farm'), [businessId])
  const perms = usePermissions(businessId)

  const batches = farm.data?.batches ?? []
  return {
    businessId,
    data: farm.data,
    catalog: catalog.data,
    loading: farm.loading || catalog.loading,
    error: farm.error ?? catalog.error,
    can: perms.can,
    refresh: async () => { await Promise.all([farm.refresh(), catalog.refresh()]) },
    activeBatches: batches.filter((b) => b.status === 'active'),
    batchCode: (id: string | null) => batches.find((b) => b.id === id)?.code ?? '–',
    unitName: (id: string | null) => farm.data?.units.find((u) => u.id === id)?.name ?? '–',
    productName: (id: string) => catalog.data?.products.find((p) => p.id === id)?.name ?? 'Product',
    productUnit: (id: string) => catalog.data?.products.find((p) => p.id === id)?.unit ?? '',
  }
}

export type FarmContext = ReturnType<typeof useFarm>
