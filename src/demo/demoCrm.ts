import { newId } from '@/demo/demoInventory'
import { demoAllowed, demoInsertCustomer, getTrade } from '@/demo/demoTrade'

/**
 * Browser-only CRM for demo mode. Mirrors supabase/migrations/20261021000005_audit_crm_settings.sql:
 * a lead becomes "converted" only through convertLead(), which reuses an existing customer with the same
 * email or phone instead of creating a duplicate.
 */
export interface DLead { id: string; businessId: string; name: string; phone: string | null; email: string | null; source: string | null; notes: string; status: 'new' | 'contacted' | 'qualified' | 'lost' | 'converted'; customerId: string | null; createdAt: string }
export interface DInteraction { id: string; businessId: string; customerId: string | null; leadId: string | null; kind: string; summary: string; at: string }
export interface DTask { id: string; businessId: string; customerId: string | null; leadId: string | null; title: string; dueAt: string | null; status: 'open' | 'done' | 'cancelled' }
export interface DTag { id: string; businessId: string; name: string }
export interface DEntityTag { tagId: string; customerId: string | null; leadId: string | null }

interface Crm { leads: DLead[]; interactions: DInteraction[]; tasks: DTask[]; tags: DTag[]; entityTags: DEntityTag[]; seeded: string[] }
const KEY = 'doa.demo.crm.v1'
const empty = (): Crm => ({ leads: [], interactions: [], tasks: [], tags: [], entityTags: [], seeded: [] })
function load(): Crm {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...(JSON.parse(raw) as Crm) } } catch { /* fresh */ }
  return empty()
}
let state = load()
function commit(next: Crm) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}
export const getCrm = () => state
export const resetDemoCrm = () => commit(empty())

export function ensureDemoCrm(businessId: string) {
  if (state.seeded.includes(businessId)) return
  const now = new Date().toISOString()
  commit({
    ...state,
    seeded: [...state.seeded, businessId],
    leads: [
      ...state.leads,
      { id: newId('lead'), businessId, name: 'Bola Supermarket', phone: '0805 000 0003', email: 'bola@example.com', source: 'referral', notes: 'Wants weekly delivery.', status: 'qualified', customerId: null, createdAt: now },
      { id: newId('lead'), businessId, name: 'Ngozi Events', phone: '0806 000 0004', email: null, source: 'instagram', notes: '', status: 'new', customerId: null, createdAt: now },
    ],
  })
}

const need = (biz: string, perm = 'customers.manage') => {
  if (!demoAllowed(biz, 'customers', perm)) throw new Error('permission denied')
}
const guarded = (biz: string, fn: () => void): string | null => {
  try { need(biz); fn(); return null } catch (e) { return (e as Error).message }
}

export function demoCreateLead(biz: string, l: { name: string; phone: string; email: string; source: string; notes: string }): string | null {
  return guarded(biz, () => {
    if (!l.name.trim()) throw new Error('Enter the lead name.')
    commit({ ...state, leads: [...state.leads, { id: newId('lead'), businessId: biz, name: l.name.trim(), phone: l.phone.trim() || null, email: l.email.trim() || null, source: l.source.trim() || null, notes: l.notes, status: 'new', customerId: null, createdAt: new Date().toISOString() }] })
  })
}

export function demoSetLeadStatus(biz: string, leadId: string, status: DLead['status']): string | null {
  return guarded(biz, () => {
    if (status === 'converted') throw new Error('Use convert to turn a lead into a customer.')
    const lead = state.leads.find((x) => x.id === leadId && x.businessId === biz)
    if (!lead) throw new Error('lead not found')
    if (lead.status === 'converted') throw new Error('a converted lead cannot change status')
    commit({ ...state, leads: state.leads.map((x) => (x.id === leadId ? { ...x, status } : x)) })
  })
}

/** Returns the customer the lead now points at and whether it was newly created. */
export function demoConvertLead(biz: string, leadId: string): { error: string | null; customerId?: string; created?: boolean } {
  try {
    need(biz)
    const lead = state.leads.find((x) => x.id === leadId && x.businessId === biz)
    if (!lead) throw new Error('lead not found')
    if (lead.status === 'converted') throw new Error('lead is already converted')
    const trade = getTrade()
    const existing = trade.customers.find((c) => c.businessId === biz
      && ((lead.email && c.email && c.email.toLowerCase() === lead.email.toLowerCase()) || (lead.phone && c.phone === lead.phone)))
    let customerId = existing?.id
    let created = false
    if (!customerId) {
      customerId = newId('c')
      created = true
      demoInsertCustomer({ id: customerId, businessId: biz, name: lead.name, phone: lead.phone, email: lead.email, source: lead.source ?? 'lead', category: null, creditLimit: 0, createdAt: new Date().toISOString() })
    }
    const cid = customerId
    commit({
      ...state,
      leads: state.leads.map((x) => (x.id === leadId ? { ...x, status: 'converted', customerId: cid } : x)),
      interactions: state.interactions.map((i) => (i.leadId === leadId && !i.customerId ? { ...i, customerId: cid } : i)),
      tasks: state.tasks.map((t) => (t.leadId === leadId && !t.customerId ? { ...t, customerId: cid } : t)),
      entityTags: [...state.entityTags, ...state.entityTags.filter((e) => e.leadId === leadId && !e.customerId && !state.entityTags.some((x) => x.tagId === e.tagId && x.customerId === cid)).map((e) => ({ tagId: e.tagId, customerId: cid, leadId: null }))],
    })
    return { error: null, customerId: cid, created }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export function demoAddInteraction(biz: string, parent: { customerId?: string; leadId?: string }, kind: string, summary: string): string | null {
  return guarded(biz, () => {
    if (!summary.trim()) throw new Error('Write a short summary.')
    commit({ ...state, interactions: [...state.interactions, { id: newId('int'), businessId: biz, customerId: parent.customerId ?? null, leadId: parent.leadId ?? null, kind, summary: summary.trim(), at: new Date().toISOString() }] })
  })
}

export function demoAddTask(biz: string, parent: { customerId?: string; leadId?: string }, title: string, dueAt: string | null): string | null {
  return guarded(biz, () => {
    if (!title.trim()) throw new Error('Enter what needs to be done.')
    commit({ ...state, tasks: [...state.tasks, { id: newId('task'), businessId: biz, customerId: parent.customerId ?? null, leadId: parent.leadId ?? null, title: title.trim(), dueAt, status: 'open' }] })
  })
}

export function demoSetTaskStatus(biz: string, taskId: string, status: DTask['status']): string | null {
  return guarded(biz, () => commit({ ...state, tasks: state.tasks.map((t) => (t.id === taskId && t.businessId === biz ? { ...t, status } : t)) }))
}

export function demoAddTag(biz: string, parent: { customerId?: string; leadId?: string }, name: string): string | null {
  return guarded(biz, () => {
    const n = name.trim()
    if (!n) throw new Error('Enter a tag.')
    const next = { ...state, tags: [...state.tags], entityTags: [...state.entityTags] }
    let tag = next.tags.find((t) => t.businessId === biz && t.name.toLowerCase() === n.toLowerCase())
    if (!tag) { tag = { id: newId('tag'), businessId: biz, name: n }; next.tags.push(tag) }
    const dup = next.entityTags.some((e) => e.tagId === tag!.id && (parent.customerId ? e.customerId === parent.customerId : e.leadId === parent.leadId))
    if (dup) throw new Error('already tagged')
    next.entityTags.push({ tagId: tag.id, customerId: parent.customerId ?? null, leadId: parent.leadId ?? null })
    commit(next)
  })
}

export function demoRemoveTag(biz: string, parent: { customerId?: string; leadId?: string }, tagId: string): string | null {
  return guarded(biz, () => commit({ ...state, entityTags: state.entityTags.filter((e) => !(e.tagId === tagId && (parent.customerId ? e.customerId === parent.customerId : e.leadId === parent.leadId))) }))
}

/** Customers' sales history for the demo (sales live in the trade store). */
export const demoSalesFor = (customerId: string) => getTrade().sales.filter((s) => s.customerId === customerId)

/** For the delete mirror: change this store in one step. */
export function mutateCrm(fn: (s: typeof state) => typeof state) { commit(fn(state)) }
