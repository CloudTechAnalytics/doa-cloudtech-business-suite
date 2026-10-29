import { commit as commitBakery, getBakery } from '@/demo/demoBakery'
import { getCrm, mutateCrm } from '@/demo/demoCrm'
import { getFarm, mutateFarm } from '@/demo/demoFarm'
import { getOps, mutateOps } from '@/demo/demoFarmOps'
import { getFinance } from '@/demo/demoFinance'
import { cloneInv, commitInv, getInv } from '@/demo/demoInventory'
import { getMart, mapModule, mutateMart } from '@/demo/demoMart'
import { getOrders } from '@/demo/demoOrders'
import { getPharmacy, mutatePharmacy } from '@/demo/demoPharmacy'
import { demoAllowed, demoCanTrade, getTrade, mutateTrade } from '@/demo/demoTrade'

/**
 * Browser mirror of delete_record() (migration 18): a record that was never used can be deleted; one that has history is refused with a
 * message that points to archiving. Who may delete a record is who may change it. Expenses are never deleted (they are voided), and a
 * stock loss only after it was voided.
 */
export type DeleteKind = 'customer' | 'supplier' | 'product' | 'category' | 'location' | 'lead' | 'loss' | 'worker' | 'equipment' | 'task' | 'farm_note' | 'farm_unit' | 'farm_batch'

const REFUSE_HINT: Partial<Record<DeleteKind, string>> = {
  loss: 'Keep it voided.',
  farm_unit: 'A flock, fish stock or crop was kept in it: delete those first, or archive it.',
  farm_batch: 'It has feeding, harvests, treatments, expenses, tasks or notes recorded against it (deleted ones are kept for the log). Close it instead.',
}
const refuse = (label: string, kind: DeleteKind) => `"${label}" cannot be deleted because it is used by other records. ${REFUSE_HINT[kind] ?? 'Archive it instead.'}`
const denied = 'permission denied'

export function demoDeleteRecord(biz: string, kind: DeleteKind, id: string): string | null {
  const inv = getInv(); const trade = getTrade(); const mart = getMart(); const pharm = getPharmacy(); const bakery = getBakery(); const crm = getCrm(); const ops = getOps()
  switch (kind) {
    case 'customer': {
      const c = trade.customers.find((x) => x.id === id && x.businessId === biz); if (!c) return denied
      if (!demoAllowed(biz, 'customers', 'customers.manage')) return denied
      if (trade.sales.some((s) => s.customerId === id) || getOrders().orders.some((o) => o.customerId === id) || pharm.prescriptions.some((r) => r.customerId === id) || getCrm().deals.some((d) => d.customerId === id) || getCrm().quotes.some((q) => q.customerId === id)) return refuse(c.name, kind)
      mutateTrade((t) => ({ ...t, customers: t.customers.filter((x) => x.id !== id) }))
      mutateCrm((s) => ({ ...s, interactions: s.interactions.filter((i) => i.customerId !== id), tasks: s.tasks.filter((t) => t.customerId !== id), entityTags: s.entityTags.filter((t) => t.customerId !== id), leads: s.leads.map((l) => (l.customerId === id ? { ...l, customerId: null } : l)) }))
      return null
    }
    case 'supplier': {
      const s = trade.suppliers.find((x) => x.id === id && x.businessId === biz); if (!s) return denied
      if (!demoAllowed(biz, 'suppliers', 'suppliers.manage')) return denied
      const used = trade.purchases.some((p) => p.supplierId === id) || mart.returns.some((r) => r.supplierId === id) || mart.profiles.some((p) => p.supplierId === id)
        || pharm.receipts.some((r) => r.supplierId === id) || getFinance().expenses.some((e) => e.supplierId === id) || getOrders().bills.some((b) => b.supplierId === id) || (inv.lots ?? []).some((l) => l.supplierId === id)
      if (used) return refuse(s.name, kind)
      mutateTrade((t) => ({ ...t, suppliers: t.suppliers.filter((x) => x.id !== id) }))
      return null
    }
    case 'product': {
      const p = inv.products.find((x) => x.id === id && x.businessId === biz); if (!p) return denied
      if (!demoAllowed(biz, 'inventory', 'inventory.adjust')) return denied
      if (pharm.profiles.some((f) => f.productId === id) && !demoCanTrade(biz, 'pharmacy.manage')) return denied
      if (mart.profiles.some((f) => f.productId === id) && !demoCanTrade(biz, 'retail.manage')) return denied
      if (bakery.profiles.some((f) => f.productId === id) && !demoCanTrade(biz, 'bakery.manage')) return denied
      const used = inv.movements.some((m) => m.productId === id) || trade.saleItems.some((i) => i.productId === id) || trade.purchaseItems.some((i) => i.productId === id)
        || bakery.recipes.some((r) => r.productId === id) || bakery.lines.some((l) => l.ingredientId === id) || bakery.batches.some((b) => b.productId === id)
        || getOrders().requests.some((r) => r.items.some((i) => i.productId === id)) || getOrders().orders.some((o) => o.lines.some((l) => l.productId === id))
        || pharm.prescriptions.some((r) => r.items.some((i) => i.productId === id)) || getFarm().feeds.some((f) => f.productId === id)
      if (used) return refuse(p.name, kind)
      const next = cloneInv(inv)
      next.products = next.products.filter((x) => x.id !== id)
      next.lotProducts = (next.lotProducts ?? []).filter((x) => x !== id); next.martLotProducts = (next.martLotProducts ?? []).filter((x) => x !== id); next.pharmacyProducts = (next.pharmacyProducts ?? []).filter((x) => x !== id)
      next.balances = Object.fromEntries(Object.entries(next.balances).filter(([k]) => !k.startsWith(`${biz}|${id}|`)))
      commitInv(next)
      mutateMart((m) => { m.profiles = m.profiles.filter((f) => f.productId !== id); m.packs = m.packs.filter((k) => k.productId !== id) })
      mutatePharmacy((s) => ({ ...s, profiles: s.profiles.filter((f) => f.productId !== id) }))
      commitBakery({ ...bakery, profiles: bakery.profiles.filter((f) => f.productId !== id) })
      mutateFarm((s) => ({ ...s, profiles: s.profiles.filter((f) => f.productId !== id) }))
      return null
    }
    case 'category': {
      const c = mart.categories.find((x) => x.id === id && x.businessId === biz); if (!c) return denied
      if (!demoAllowed(biz, 'inventory', 'inventory.adjust')) return denied
      if (mart.profiles.some((f) => f.categoryId === id)) return refuse(c.name, kind)
      mutateMart((m) => { m.categories = m.categories.filter((x) => x.id !== id) })
      return null
    }
    case 'location': {
      const l = inv.locations.find((x) => x.id === id && x.businessId === biz); if (!l) return denied
      if (!demoAllowed(biz, 'inventory', 'inventory.adjust')) return denied
      if (inv.movements.some((m) => m.locationId === id) || mart.counts.some((c) => c.locationId === id)) return refuse(l.name, kind)
      const next = cloneInv(inv)
      next.locations = next.locations.filter((x) => x.id !== id)
      commitInv(next)
      return null
    }
    case 'lead': {
      const l = crm.leads.find((x) => x.id === id && x.businessId === biz); if (!l) return denied
      if (!demoAllowed(biz, 'customers', 'customers.manage')) return denied
      if (crm.deals.some((d) => d.leadId === id) || crm.quotes.some((q) => q.leadId === id)) return refuse(l.name, kind)
      mutateCrm((s) => ({ ...s, leads: s.leads.filter((x) => x.id !== id), interactions: s.interactions.filter((i) => i.leadId !== id), tasks: s.tasks.filter((t) => t.leadId !== id), entityTags: s.entityTags.filter((t) => t.leadId !== id) }))
      return null
    }
    case 'loss': {
      const w = mart.losses.find((x) => x.id === id && x.businessId === biz); if (!w) return denied
      if (!demoAllowed(biz, mapModule(biz, 'retail-losses'), 'retail.manage')) return denied
      if (w.status !== 'voided') return 'void this entry first; only a voided entry can be deleted'
      mutateMart((m) => { m.losses = m.losses.filter((x) => x.id !== id) })
      return null
    }
    case 'worker': {
      const w = ops.workers.find((x) => x.id === id && x.businessId === biz); if (!w) return denied
      if (!demoCanTrade(biz, 'farm.manage')) return denied
      if (ops.tasks.some((t) => t.assigneeId === id)) return refuse(w.name, kind)
      mutateOps((s) => ({ ...s, workers: s.workers.filter((x) => x.id !== id) }))
      return null
    }
    case 'equipment': {
      const a = ops.assets.find((x) => x.id === id && x.businessId === biz); if (!a) return denied
      if (!demoCanTrade(biz, 'farm.manage')) return denied
      if (ops.maintenance.some((m) => m.assetId === id)) return refuse(a.name, kind)
      mutateOps((s) => ({ ...s, assets: s.assets.filter((x) => x.id !== id) }))
      return null
    }
    case 'task': {
      const t = ops.tasks.find((x) => x.id === id && x.businessId === biz); if (!t) return denied
      if (!demoCanTrade(biz, 'farm.manage')) return denied
      mutateOps((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== id) }))
      return null
    }
    case 'farm_note': {
      const a = getFarm().activities.find((x) => x.id === id && x.businessId === biz); if (!a) return denied
      if (!demoCanTrade(biz, 'farm.manage') && !demoCanTrade(biz, 'farm.record')) return denied
      mutateFarm((s) => ({ ...s, activities: s.activities.filter((x) => x.id !== id) }))
      return null
    }
    case 'farm_unit': {
      const f = getFarm(); const u = f.units.find((x) => x.id === id && x.businessId === biz); if (!u) return denied
      if (!demoCanTrade(biz, 'farm.manage')) return denied
      if (f.batches.some((b) => b.unitId === id) || f.activities.some((a) => a.unitId === id)) return refuse(u.name, kind)
      mutateFarm((s) => ({ ...s, units: s.units.filter((x) => x.id !== id) }))
      return null
    }
    case 'farm_batch': {
      const f = getFarm(); const b = f.batches.find((x) => x.id === id && x.businessId === biz); if (!b) return denied
      if (!demoCanTrade(biz, 'farm.manage')) return denied
      if (f.events.some((e) => e.batchId === id && e.type !== 'opening')) return `"${b.code}" has records against it, so it cannot be deleted. Close it instead`
      const used = f.feeds.some((x) => x.batchId === id) || f.harvests.some((x) => x.batchId === id) || f.health.some((x) => x.batchId === id) || f.activities.some((x) => x.batchId === id)
        || getFinance().expenses.some((e) => e.batchId === id) || ops.tasks.some((t) => t.batchId === id)
      if (used) return refuse(b.code, kind)
      mutateFarm((s) => ({ ...s, batches: s.batches.filter((x) => x.id !== id), events: s.events.filter((e) => e.batchId !== id) }))
      return null
    }
  }
}
