import * as demo from '@/demo/demoCrm'
import * as trade from '@/demo/demoTrade'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'

/** CRM data access. Live mode uses row-level-secured tables and database functions; demo mode runs a browser mirror. */

export interface CustomerSummary { orders: number; lifetimeSpend: number; paid: number; firstPurchaseAt: string | null; lastPurchaseAt: string | null }
export interface CustomerRow {
  id: string; name: string; phone: string | null; email: string | null; source: string | null; category: string | null; creditLimit: number; outstanding: number; createdAt: string
  company: string | null; contactPerson: string | null; city: string | null; address: string | null; notes: string | null; summary: CustomerSummary
}
export interface CustomerInput { name: string; phone: string; email: string; source: string; category: string; company?: string; contactPerson?: string; city?: string; address?: string; notes?: string }
const NO_SUMMARY: CustomerSummary = { orders: 0, lifetimeSpend: 0, paid: 0, firstPurchaseAt: null, lastPurchaseAt: null }
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'lost', 'converted'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]
export interface LeadRow { id: string; name: string; phone: string | null; email: string | null; source: string | null; notes: string; status: LeadStatus; customerId: string | null; createdAt: string; rating: 'hot' | 'warm' | 'cold' | null; ownerId: string | null }
export interface Paged<T> { rows: T[]; total: number }
export interface HistoryEntry { kind: 'interaction' | 'task' | 'sale'; at: string; label: string; detail: string; amount?: number; balance?: number }
export interface TaskRow { id: string; title: string; dueAt: string | null; status: string; customerId: string | null; leadId: string | null }
export interface TagRow { id: string; name: string }
export interface Parent { customerId?: string; leadId?: string }
export interface CustomerDetail { customer: CustomerRow; history: HistoryEntry[]; tasks: TaskRow[]; tags: TagRow[] }
export interface LeadDetail { lead: LeadRow; interactions: HistoryEntry[]; tasks: TaskRow[]; tags: TagRow[] }

const db = () => supabase!
const n = (v: unknown) => Number(v ?? 0)
const err = (e: { message: string } | null) => e?.message ?? null
/** Keeps user text from breaking PostgREST filter syntax. */
const safe = (q: string) => q.replace(/[,()%*_\\"']/g, ' ').trim()

const custFromRow = (r: Record<string, unknown>, outstanding = 0): CustomerRow => ({ id: String(r.id), name: String(r.name), phone: (r.phone as string | null) ?? null, email: (r.email as string | null) ?? null, source: (r.source as string | null) ?? null, category: (r.category as string | null) ?? null, creditLimit: n(r.credit_limit), outstanding, createdAt: String(r.created_at),
  company: (r.company as string | null) ?? null, contactPerson: (r.contact_person as string | null) ?? null, city: (r.city as string | null) ?? null, address: (r.address as string | null) ?? null, notes: (r.notes as string | null) ?? null, summary: NO_SUMMARY })
const leadFromRow = (r: Record<string, unknown>): LeadRow => ({ id: String(r.id), name: String(r.name), phone: (r.phone as string | null) ?? null, email: (r.email as string | null) ?? null, source: (r.source as string | null) ?? null, notes: String(r.notes ?? ''), status: r.status as LeadStatus, customerId: (r.customer_id as string | null) ?? null, createdAt: String(r.created_at), rating: (r.rating as 'hot' | 'warm' | 'cold' | null) ?? null, ownerId: (r.owner_id as string | null) ?? null })
const taskFromRow = (r: Record<string, unknown>): TaskRow => ({ id: String(r.id), title: String(r.title), dueAt: (r.due_at as string | null) ?? null, status: String(r.status), customerId: (r.customer_id as string | null) ?? null, leadId: (r.lead_id as string | null) ?? null })

export async function searchCustomers(b: string, o: { q: string; category: string; page: number; pageSize: number }): Promise<Paged<CustomerRow>> {
  if (isDemoMode) {
    demo.ensureDemoCrm(b); trade.ensureDemoTrade(b)
    const t = trade.getTrade()
    const q = o.q.trim().toLowerCase()
    const all = t.customers.filter((c) => c.businessId === b && (!q || [c.name, c.phone, c.email].some((v) => v?.toLowerCase().includes(q))) && (!o.category || c.category === o.category))
    const rows = all.slice(o.page * o.pageSize, (o.page + 1) * o.pageSize).map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, source: c.source, category: c.category, creditLimit: c.creditLimit, createdAt: c.createdAt, outstanding: t.sales.filter((s) => s.customerId === c.id && s.status !== 'voided').reduce((a, s) => a + s.balanceDue, 0),
      company: c.company ?? null, contactPerson: c.contactPerson ?? null, city: c.city ?? null, address: c.address ?? null, notes: c.notes ?? null, summary: trade.demoCustomerSummary(b, c.id) }))
    return { rows, total: all.length }
  }
  let query = db().from('customers').select('*', { count: 'exact' }).eq('business_id', b).eq('status', 'active')
  const q = safe(o.q)
  if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
  if (o.category) query = query.eq('category', o.category)
  const r = await query.order('name').range(o.page * o.pageSize, (o.page + 1) * o.pageSize - 1)
  if (r.error) throw new Error(r.error.message)
  const ids = (r.data ?? []).map((x) => x.id)
  const sales = ids.length ? await db().from('sales').select('customer_id, balance_due').in('customer_id', ids).neq('status', 'voided') : { data: [] }
  const sums = ids.length ? await db().from('customer_summary').select('*').in('customer_id', ids) : { data: [] }
  const summaryOf = (id: string): CustomerSummary => { const s = (sums.data ?? []).find((x) => x.customer_id === id); return s ? { orders: n(s.orders), lifetimeSpend: n(s.lifetime_spend), paid: n(s.paid), firstPurchaseAt: s.first_purchase_at ?? null, lastPurchaseAt: s.last_purchase_at ?? null } : NO_SUMMARY }
  return { rows: (r.data ?? []).map((x) => ({ ...custFromRow(x, (sales.data ?? []).filter((s) => s.customer_id === x.id).reduce((a, s) => a + n(s.balance_due), 0)), summary: summaryOf(x.id) })), total: r.count ?? 0 }
}

export async function listCategories(b: string): Promise<string[]> {
  if (isDemoMode) { trade.ensureDemoTrade(b); return [...new Set(trade.getTrade().customers.filter((c) => c.businessId === b && c.category).map((c) => c.category!))].sort() }
  const r = await db().from('customers').select('category').eq('business_id', b).not('category', 'is', null)
  return [...new Set((r.data ?? []).map((x) => String(x.category)))].sort()
}

const cols = (c: CustomerInput) => ({ name: c.name.trim(), phone: c.phone.trim() || null, email: c.email.trim() || null, source: c.source.trim() || null, category: c.category.trim() || null, company: c.company?.trim() || null, contact_person: c.contactPerson?.trim() || null, city: c.city?.trim() || null, address: c.address?.trim() || null, notes: c.notes?.trim() || null })

export async function updateCustomer(b: string, id: string, c: CustomerInput) {
  if (isDemoMode) return trade.demoUpdateCustomer(b, id, c)
  if (!c.name.trim()) return 'Enter the customer name.'
  return err((await db().from('customers').update(cols(c)).eq('id', id).eq('business_id', b)).error)
}

export async function customerTopProducts(b: string, id: string): Promise<{ product: string; units: number; revenue: number }[]> {
  if (isDemoMode) return trade.demoCustomerTopProducts(b, id)
  const r = await db().rpc('customer_top_products', { p_customer: id, p_limit: 5 })
  if (r.error) return []
  return (r.data as { product: string; units: number; revenue: number }[]).map((x) => ({ product: x.product, units: n(x.units), revenue: n(x.revenue) }))
}

export async function createCustomer(b: string, c: CustomerInput) {
  if (isDemoMode) return trade.demoCreateCustomer(b, c.name, c.phone, { email: c.email, source: c.source, category: c.category, company: c.company, contactPerson: c.contactPerson, city: c.city, address: c.address, notes: c.notes })
  return err((await db().from('customers').insert({ business_id: b, ...cols(c) })).error)
}

export async function searchLeads(b: string, o: { q: string; status: string; page: number; pageSize: number }): Promise<Paged<LeadRow>> {
  if (isDemoMode) {
    demo.ensureDemoCrm(b)
    const q = o.q.trim().toLowerCase()
    const all = demo.getCrm().leads.filter((l) => l.businessId === b && (!o.status || l.status === o.status) && (!q || [l.name, l.phone, l.email].some((v) => v?.toLowerCase().includes(q))))
    return { rows: all.slice(o.page * o.pageSize, (o.page + 1) * o.pageSize).map((l) => ({ ...l, rating: l.rating ?? null, ownerId: l.ownerId ?? null })), total: all.length }
  }
  let query = db().from('crm_leads').select('*', { count: 'exact' }).eq('business_id', b)
  const q = safe(o.q)
  if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
  if (o.status) query = query.eq('status', o.status)
  const r = await query.order('created_at', { ascending: false }).range(o.page * o.pageSize, (o.page + 1) * o.pageSize - 1)
  if (r.error) throw new Error(r.error.message)
  return { rows: (r.data ?? []).map(leadFromRow), total: r.count ?? 0 }
}

export async function createLead(b: string, l: { name: string; phone: string; email: string; source: string; notes: string }) {
  if (isDemoMode) return demo.demoCreateLead(b, l)
  return err((await db().from('crm_leads').insert({ business_id: b, name: l.name.trim(), phone: l.phone.trim() || null, email: l.email.trim() || null, source: l.source.trim() || null, notes: l.notes })).error)
}

/** Rating (hot, warm or cold) and owner of a lead. */
export async function setLeadMeta(b: string, id: string, v: { rating: 'hot' | 'warm' | 'cold' | null; ownerId: string | null }) {
  if (isDemoMode) return demo.demoSetLeadMeta(b, id, v)
  return err((await db().from('crm_leads').update({ rating: v.rating, owner_id: v.ownerId }).eq('id', id).eq('business_id', b)).error)
}

export async function setLeadStatus(b: string, id: string, status: LeadStatus) {
  if (isDemoMode) return demo.demoSetLeadStatus(b, id, status)
  return err((await db().from('crm_leads').update({ status }).eq('id', id).eq('business_id', b)).error)
}

export async function convertLead(b: string, id: string, key: string): Promise<{ error: string | null; created?: boolean }> {
  if (isDemoMode) { const r = demo.demoConvertLead(b, id); return { error: r.error, created: r.created } }
  const { data, error } = await db().rpc('convert_lead', { p_lead: id, p_key: key })
  return error ? { error: error.message } : { error: null, created: (data as { created: boolean }).created }
}

const histFromInteraction = (kind: string, summary: string, at: string): HistoryEntry => ({ kind: 'interaction', at, label: kind, detail: summary })

async function tasksFor(b: string, p: Parent): Promise<TaskRow[]> {
  if (isDemoMode) return demo.getCrm().tasks.filter((t) => t.businessId === b && (p.customerId ? t.customerId === p.customerId : t.leadId === p.leadId)).map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt, status: t.status, customerId: t.customerId, leadId: t.leadId }))
  const r = await db().from('crm_tasks').select('*').eq(p.customerId ? 'customer_id' : 'lead_id', (p.customerId ?? p.leadId)!).order('due_at', { nullsFirst: false })
  return (r.data ?? []).map(taskFromRow)
}

async function tagsFor(b: string, p: Parent): Promise<TagRow[]> {
  if (isDemoMode) {
    const c = demo.getCrm()
    return c.entityTags.filter((e) => (p.customerId ? e.customerId === p.customerId : e.leadId === p.leadId)).map((e) => c.tags.find((t) => t.id === e.tagId)!).filter(Boolean).map((t) => ({ id: t.id, name: t.name }))
  }
  const links = await db().from('crm_entity_tags').select('tag_id').eq(p.customerId ? 'customer_id' : 'lead_id', (p.customerId ?? p.leadId)!)
  const ids = (links.data ?? []).map((x) => x.tag_id)
  if (!ids.length) return []
  const tags = await db().from('crm_tags').select('id, name').in('id', ids).eq('business_id', b)
  return (tags.data ?? []) as TagRow[]
}

export async function customerDetail(b: string, id: string): Promise<CustomerDetail> {
  const page = await searchCustomers(b, { q: '', category: '', page: 0, pageSize: 1000 })
  const customer = page.rows.find((c) => c.id === id)
  if (!customer) throw new Error('Customer not found.')
  let history: HistoryEntry[]
  if (isDemoMode) {
    const c = demo.getCrm()
    history = [
      ...c.interactions.filter((i) => i.customerId === id).map((i) => histFromInteraction(i.kind, i.summary, i.at)),
      ...c.tasks.filter((t) => t.customerId === id).map((t): HistoryEntry => ({ kind: 'task', at: t.dueAt ?? new Date().toISOString(), label: t.status, detail: t.title })),
      ...demo.demoSalesFor(id).map((s): HistoryEntry => ({ kind: 'sale', at: s.soldAt, label: s.status, detail: s.number, amount: s.grandTotal, balance: s.balanceDue })),
    ].sort((a, z) => z.at.localeCompare(a.at))
  } else {
    const r = await db().rpc('customer_history', { p_customer: id })
    if (r.error) throw new Error(r.error.message)
    history = (r.data as { kind: HistoryEntry['kind']; at: string; label: string; detail: string; amount?: number; balance?: number }[]).map((e) => ({ ...e }))
  }
  return { customer, history, tasks: await tasksFor(b, { customerId: id }), tags: await tagsFor(b, { customerId: id }) }
}

export async function leadDetail(b: string, id: string): Promise<LeadDetail> {
  const page = await searchLeads(b, { q: '', status: '', page: 0, pageSize: 1000 })
  const lead = page.rows.find((l) => l.id === id)
  if (!lead) throw new Error('Lead not found.')
  let interactions: HistoryEntry[]
  if (isDemoMode) interactions = demo.getCrm().interactions.filter((i) => i.leadId === id).map((i) => histFromInteraction(i.kind, i.summary, i.at)).reverse()
  else {
    const r = await db().from('crm_interactions').select('kind, summary, occurred_at').eq('lead_id', id).order('occurred_at', { ascending: false })
    interactions = (r.data ?? []).map((x) => histFromInteraction(x.kind, x.summary, x.occurred_at))
  }
  return { lead, interactions, tasks: await tasksFor(b, { leadId: id }), tags: await tagsFor(b, { leadId: id }) }
}

export async function addInteraction(b: string, p: Parent, kind: string, summary: string) {
  if (isDemoMode) return demo.demoAddInteraction(b, p, kind, summary)
  return err((await db().from('crm_interactions').insert({ business_id: b, customer_id: p.customerId ?? null, lead_id: p.leadId ?? null, kind, summary: summary.trim() })).error)
}

export async function addTask(b: string, p: Parent, title: string, dueAt: string | null) {
  if (isDemoMode) return demo.demoAddTask(b, p, title, dueAt)
  return err((await db().from('crm_tasks').insert({ business_id: b, customer_id: p.customerId ?? null, lead_id: p.leadId ?? null, title: title.trim(), due_at: dueAt })).error)
}

export async function setTaskStatus(b: string, id: string, status: 'open' | 'done' | 'cancelled') {
  if (isDemoMode) return demo.demoSetTaskStatus(b, id, status)
  return err((await db().from('crm_tasks').update({ status }).eq('id', id).eq('business_id', b)).error)
}

export async function listOpenTasks(b: string): Promise<(TaskRow & { subject: string })[]> {
  if (isDemoMode) {
    demo.ensureDemoCrm(b); trade.ensureDemoTrade(b)
    const c = demo.getCrm(); const t = trade.getTrade()
    return c.tasks.filter((x) => x.businessId === b && x.status === 'open').map((x) => ({ id: x.id, title: x.title, dueAt: x.dueAt, status: x.status, customerId: x.customerId, leadId: x.leadId, subject: t.customers.find((y) => y.id === x.customerId)?.name ?? c.leads.find((y) => y.id === x.leadId)?.name ?? '' }))
  }
  const r = await db().from('crm_tasks').select('*').eq('business_id', b).eq('status', 'open').order('due_at', { nullsFirst: false }).limit(200)
  if (r.error) throw new Error(r.error.message)
  const rows = (r.data ?? []).map(taskFromRow)
  const cust = rows.map((x) => x.customerId).filter(Boolean) as string[]
  const lead = rows.map((x) => x.leadId).filter(Boolean) as string[]
  const [cs, ls] = await Promise.all([
    cust.length ? db().from('customers').select('id, name').in('id', cust) : { data: [] },
    lead.length ? db().from('crm_leads').select('id, name').in('id', lead) : { data: [] },
  ])
  const names = new Map<string, string>([...(cs.data ?? []), ...(ls.data ?? [])].map((x) => [String(x.id), String(x.name)]))
  return rows.map((x) => ({ ...x, subject: names.get(x.customerId ?? x.leadId ?? '') ?? '' }))
}

export async function addTag(b: string, p: Parent, name: string) {
  if (isDemoMode) return demo.demoAddTag(b, p, name)
  const clean = name.trim()
  if (!clean) return 'Enter a tag.'
  const existing = await db().from('crm_tags').select('id').eq('business_id', b).ilike('name', clean.replace(/[%_]/g, '')).maybeSingle()
  let tagId = existing.data?.id as string | undefined
  if (!tagId) {
    const ins = await db().from('crm_tags').insert({ business_id: b, name: clean }).select('id').single()
    if (ins.error) return ins.error.message
    tagId = ins.data.id
  }
  return err((await db().from('crm_entity_tags').insert({ business_id: b, tag_id: tagId, customer_id: p.customerId ?? null, lead_id: p.leadId ?? null })).error)
}

export async function removeTag(b: string, p: Parent, tagId: string) {
  if (isDemoMode) return demo.demoRemoveTag(b, p, tagId)
  return err((await db().from('crm_entity_tags').delete().eq('tag_id', tagId).eq(p.customerId ? 'customer_id' : 'lead_id', (p.customerId ?? p.leadId)!)).error)
}
