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

export const DEAL_STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const
export type DealStage = (typeof DEAL_STAGES)[number]
export interface DDeal { id: string; businessId: string; title: string; customerId: string | null; leadId: string | null; value: number; stage: DealStage; expectedClose: string | null; notes: string; lostReason: string | null; closedAt: string | null; createdAt: string }
export interface DDealEvent { id: string; businessId: string; dealId: string; from: DealStage | null; to: DealStage; note: string | null; at: string }
export interface DQuoteLine { description: string; quantity: number; unitPrice: number }
export interface DQuote { id: string; businessId: string; number: string; dealId: string | null; customerId: string | null; leadId: string | null; issuedOn: string; validUntil: string | null; status: 'draft' | 'sent' | 'accepted' | 'declined'; lines: DQuoteLine[]; discount: number; subtotal: number; total: number; notes: string; createdAt: string }

interface Crm { leads: DLead[]; interactions: DInteraction[]; tasks: DTask[]; tags: DTag[]; entityTags: DEntityTag[]; seeded: string[]; deals: DDeal[]; dealEvents: DDealEvent[]; quotes: DQuote[]; quoteCount: Record<string, number> }
const KEY = 'doa.demo.crm.v1'
const empty = (): Crm => ({ leads: [], interactions: [], tasks: [], tags: [], entityTags: [], seeded: [], deals: [], dealEvents: [], quotes: [], quoteCount: {} })
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
  const bola = newId('lead'); const ngozi = newId('lead')
  const deal = (title: string, leadId: string, value: number, stage: DealStage): DDeal => ({ id: newId('deal'), businessId, title, customerId: null, leadId, value, stage, expectedClose: null, notes: '', lostReason: null, closedAt: stage === 'won' ? now : null, createdAt: now })
  const deals = [deal('Weekly supply to Bola Supermarket', bola, 450000, 'proposal'), deal('Ngozi Events party order', ngozi, 120000, 'new')]
  commit({
    ...state,
    seeded: [...state.seeded, businessId],
    leads: [
      ...state.leads,
      { id: bola, businessId, name: 'Bola Supermarket', phone: '0805 000 0003', email: 'bola@example.com', source: 'referral', notes: 'Wants weekly delivery.', status: 'qualified', customerId: null, createdAt: now },
      { id: ngozi, businessId, name: 'Ngozi Events', phone: '0806 000 0004', email: null, source: 'instagram', notes: '', status: 'new', customerId: null, createdAt: now },
    ],
    deals: [...state.deals, ...deals],
    dealEvents: [...state.dealEvents, ...deals.map((d) => ({ id: newId('dev'), businessId, dealId: d.id, from: null, to: 'new' as DealStage, note: null, at: now }))],
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

// ------------------------------------------------------------------- deals and quotes (mirror 20261021000046_crm_deals_general.sql)
const money = (n: number) => Math.round(n * 100) / 100
export const demoContactName = (biz: string, customerId: string | null, leadId: string | null) =>
  getTrade().customers.find((c) => c.businessId === biz && c.id === customerId)?.name ?? state.leads.find((l) => l.businessId === biz && l.id === leadId)?.name ?? ''
export const demoDeals = (biz: string) => state.deals.filter((d) => d.businessId === biz)
export const demoDealEvents = (biz: string, dealId: string) => state.dealEvents.filter((e) => e.businessId === biz && e.dealId === dealId)
export const demoQuotes = (biz: string) => state.quotes.filter((q) => q.businessId === biz)

export function demoSaveDeal(biz: string, d: { id: string | null; title: string; customerId: string | null; leadId: string | null; value: number; expectedClose: string | null; notes: string }): string | null {
  return guarded(biz, () => {
    if (!d.title.trim()) throw new Error('enter what the deal is for')
    if (!d.customerId && !d.leadId) throw new Error('choose the customer or lead this deal is with')
    if (!(d.value >= 0)) throw new Error('the deal value cannot be negative')
    if (d.customerId && !getTrade().customers.some((c) => c.businessId === biz && c.id === d.customerId)) throw new Error('customer not found')
    if (d.leadId && !state.leads.some((l) => l.businessId === biz && l.id === d.leadId)) throw new Error('lead not found')
    if (d.id === null) {
      const deal: DDeal = { id: newId('deal'), businessId: biz, title: d.title.trim(), customerId: d.customerId, leadId: d.leadId, value: money(d.value), stage: 'new', expectedClose: d.expectedClose, notes: d.notes, lostReason: null, closedAt: null, createdAt: new Date().toISOString() }
      commit({ ...state, deals: [...state.deals, deal], dealEvents: [...state.dealEvents, { id: newId('dev'), businessId: biz, dealId: deal.id, from: null, to: 'new', note: null, at: deal.createdAt }] })
    } else {
      if (!state.deals.some((x) => x.id === d.id && x.businessId === biz)) throw new Error('deal not found')
      commit({ ...state, deals: state.deals.map((x) => (x.id === d.id ? { ...x, title: d.title.trim(), customerId: d.customerId, leadId: d.leadId, value: money(d.value), expectedClose: d.expectedClose, notes: d.notes } : x)) })
    }
  })
}

export function demoMoveDeal(biz: string, dealId: string, stage: DealStage, reason: string): string | null {
  return guarded(biz, () => {
    const d = state.deals.find((x) => x.id === dealId && x.businessId === biz)
    if (!d) throw new Error('deal not found')
    if (!DEAL_STAGES.includes(stage)) throw new Error('choose a stage: new, qualified, proposal, negotiation, won or lost')
    if (d.stage === stage) return
    if (stage === 'lost' && !reason.trim()) throw new Error('say why the deal was lost')
    const at = new Date().toISOString()
    commit({
      ...state,
      deals: state.deals.map((x) => (x.id === dealId ? { ...x, stage, lostReason: stage === 'lost' ? reason.trim() : null, closedAt: stage === 'won' || stage === 'lost' ? at : null } : x)),
      dealEvents: [...state.dealEvents, { id: newId('dev'), businessId: biz, dealId, from: d.stage, to: stage, note: reason.trim() || null, at }],
    })
  })
}

export function demoSaveQuote(biz: string, q: { id: string | null; dealId: string | null; customerId: string | null; leadId: string | null; validUntil: string | null; lines: DQuoteLine[]; discount: number; notes: string }): string | null {
  return guarded(biz, () => {
    if (!q.dealId && !q.customerId && !q.leadId) throw new Error('choose the customer, lead or deal this quote is for')
    if (q.dealId && !state.deals.some((d) => d.id === q.dealId && d.businessId === biz)) throw new Error('deal not found')
    if (!q.lines.length) throw new Error('add at least one line to the quote')
    if (q.lines.length > 100) throw new Error('a quote can have at most 100 lines')
    for (const l of q.lines) {
      if (!l.description.trim()) throw new Error('every line needs a description')
      if (!(l.quantity > 0) || !(l.unitPrice >= 0)) throw new Error('every line needs a quantity above zero and a price of zero or more')
    }
    const lines = q.lines.map((l) => ({ description: l.description.trim(), quantity: l.quantity, unitPrice: money(l.unitPrice) }))
    const subtotal = money(lines.reduce((a, l) => a + money(l.quantity * l.unitPrice), 0))
    const discount = money(q.discount || 0)
    if (discount < 0 || discount > subtotal) throw new Error('the discount cannot be more than the quote total')
    if (q.id === null) {
      const n = (state.quoteCount[biz] ?? 0) + 1
      const quote: DQuote = { id: newId('quo'), businessId: biz, number: `QUO-${String(n).padStart(6, '0')}`, dealId: q.dealId, customerId: q.customerId, leadId: q.leadId, issuedOn: new Date().toISOString().slice(0, 10), validUntil: q.validUntil, status: 'draft', lines, discount, subtotal, total: money(subtotal - discount), notes: q.notes, createdAt: new Date().toISOString() }
      commit({ ...state, quotes: [...state.quotes, quote], quoteCount: { ...state.quoteCount, [biz]: n } })
    } else {
      const cur = state.quotes.find((x) => x.id === q.id && x.businessId === biz)
      if (!cur) throw new Error('quote not found')
      if (cur.status !== 'draft') throw new Error('a quote that has been sent can no longer be changed; make a new one')
      commit({ ...state, quotes: state.quotes.map((x) => (x.id === q.id ? { ...x, dealId: q.dealId, customerId: q.customerId, leadId: q.leadId, validUntil: q.validUntil, lines, discount, subtotal, total: money(subtotal - discount), notes: q.notes } : x)) })
    }
  })
}

export function demoSetQuoteStatus(biz: string, quoteId: string, status: 'sent' | 'accepted' | 'declined'): string | null {
  return guarded(biz, () => {
    const q = state.quotes.find((x) => x.id === quoteId && x.businessId === biz)
    if (!q) throw new Error('quote not found')
    if ((q.status === 'draft' && status !== 'sent') || (q.status === 'sent' && status === 'sent') || q.status === 'accepted' || q.status === 'declined') throw new Error(`a ${q.status} quote cannot be marked ${status}`)
    commit({ ...state, quotes: state.quotes.map((x) => (x.id === quoteId ? { ...x, status } : x)) })
  })
}

export interface DCrmReport { stages: { stage: DealStage; deals: number; value: number }[]; openValue: number; openDeals: number; wonThisMonth: number; wonDealsThisMonth: number; winRate: number | null; leads: Record<string, number>; overdueTasks: number; dueToday: number; lostReasons: { reason: string; deals: number }[] }
export function demoCrmReport(biz: string): DCrmReport {
  if (!demoAllowed(biz, 'customers', 'customers.read')) throw new Error('permission denied')
  const deals = demoDeals(biz); const month = new Date().toISOString().slice(0, 7); const now = Date.now(); const today = new Date().toISOString().slice(0, 10)
  const won = deals.filter((d) => d.stage === 'won'); const lost = deals.filter((d) => d.stage === 'lost'); const open = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost')
  const wonMonth = won.filter((d) => d.closedAt?.slice(0, 7) === month)
  const tasks = state.tasks.filter((t) => t.businessId === biz && t.status === 'open')
  const leads: Record<string, number> = {}
  for (const l of state.leads.filter((x) => x.businessId === biz)) leads[l.status] = (leads[l.status] ?? 0) + 1
  const reasons = new Map<string, number>()
  for (const d of lost) reasons.set(d.lostReason ?? '', (reasons.get(d.lostReason ?? '') ?? 0) + 1)
  return {
    stages: DEAL_STAGES.map((s) => ({ stage: s, deals: deals.filter((d) => d.stage === s).length, value: deals.filter((d) => d.stage === s).reduce((a, d) => a + d.value, 0) })),
    openValue: open.reduce((a, d) => a + d.value, 0), openDeals: open.length, wonThisMonth: wonMonth.reduce((a, d) => a + d.value, 0), wonDealsThisMonth: wonMonth.length,
    winRate: won.length + lost.length ? Math.round((won.length * 1000) / (won.length + lost.length)) / 10 : null, leads,
    overdueTasks: tasks.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now).length, dueToday: tasks.filter((t) => t.dueAt?.slice(0, 10) === today).length,
    lostReasons: [...reasons].map(([reason, n]) => ({ reason, deals: n })).sort((a, z) => z.deals - a.deals).slice(0, 5),
  }
}
