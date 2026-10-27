import { searchCustomers, searchLeads } from '@/modules/crm/crmApi'
import { listDeals } from '@/modules/crm/dealsApi'
import { listInvoices } from '@/modules/invoices/invoicesApi'
import { loadCatalog } from '@/modules/sales/tradeApi'
import type { IndustryCode, ModuleCode } from '@/shared/types/domain'

/** One record found by the search box, and where to open it. */
export interface RecordHit { key: string; kind: string; label: string; sub: string; to: string }

const LIMIT = 5
const has = (term: string, ...fields: (string | null | undefined)[]) => { const t = term.toLowerCase(); return fields.some((f) => f?.toLowerCase().includes(t)) }

/**
 * Looks for records by name, number, phone, email, SKU or barcode, in the apps that are switched on and that this person can read (each source answers for itself:
 * one that refuses, or fails, is left out and the others still show). A hit opens its own page through ?open=<id>.
 */
export async function searchRecords(businessId: string, industry: IndustryCode, usable: ReadonlySet<ModuleCode>, term: string): Promise<RecordHit[]> {
  const t = term.trim()
  if (t.length < 2) return []
  const jobs: Promise<RecordHit[]>[] = []
  if (usable.has('customers')) {
    jobs.push(searchCustomers(businessId, { q: t, category: '', page: 0, pageSize: LIMIT }).then((r) => r.rows.map((c) => ({ key: `c${c.id}`, kind: 'Customer', label: c.name, sub: [c.company, c.phone, c.email].filter(Boolean).join(' · '), to: `/app/customers?tab=customers&open=${c.id}` }))))
    jobs.push(searchLeads(businessId, { q: t, status: '', page: 0, pageSize: LIMIT }).then((r) => r.rows.map((l) => ({ key: `l${l.id}`, kind: 'Lead', label: l.name, sub: [l.phone, l.email].filter(Boolean).join(' · '), to: `/app/customers?tab=leads&open=${l.id}` }))))
    jobs.push(listDeals(businessId).then((r) => r.filter((d) => has(t, d.title, d.contact)).slice(0, LIMIT).map((d) => ({ key: `d${d.id}`, kind: 'Deal', label: d.title, sub: [d.contact, d.stageName].filter(Boolean).join(' · '), to: `/app/customers?tab=deals&open=${d.id}` }))))
  }
  if (usable.has('invoices')) {
    jobs.push(listInvoices(businessId).then((r) => r.filter((i) => has(t, i.number, i.customer)).slice(0, LIMIT).map((i) => ({ key: `i${i.id}`, kind: 'Invoice', label: i.number, sub: [i.customer, i.status.replace(/_/g, ' ')].filter(Boolean).join(' · '), to: `/app/invoices?tab=invoices&open=${i.id}` }))))
  }
  if (usable.has('inventory')) {
    jobs.push(catalog(businessId, industry).then((r) => r.products.filter((p) => has(t, p.name, p.sku, p.barcode)).slice(0, LIMIT).map((p) => ({ key: `p${p.id}`, kind: p.tracksStock ? 'Product' : 'Service', label: p.name, sub: [p.sku, p.barcode].filter(Boolean).join(' · '), to: `/app/inventory?tab=products&open=${p.id}` }))))
  }
  const done = await Promise.allSettled(jobs)
  return done.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

// The product list is the heaviest source; keep it for a minute so typing does not reload it on every pause.
const cache = new Map<string, { at: number; data: ReturnType<typeof loadCatalog> }>()
function catalog(businessId: string, industry: IndustryCode) {
  const hit = cache.get(businessId)
  if (hit && Date.now() - hit.at < 60_000) return hit.data
  const data = loadCatalog(businessId, industry)
  cache.set(businessId, { at: Date.now(), data })
  data.catch(() => cache.delete(businessId))
  return data
}
