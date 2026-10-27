import { newId } from '@/demo/demoInventory'
import { getDemoState } from '@/demo/demoStore'
import { usageLimit } from '@/demo/demoUsage'
import { demoAllowed, demoInsertCustomer, getTrade } from '@/demo/demoTrade'

/**
 * Browser-only CRM for demo mode. Mirrors supabase/migrations/20261021000005_audit_crm_settings.sql:
 * a lead becomes "converted" only through convertLead(), which reuses an existing customer with the same
 * email or phone instead of creating a duplicate.
 */
export interface DLead { id: string; businessId: string; name: string; phone: string | null; email: string | null; source: string | null; notes: string; status: 'new' | 'contacted' | 'qualified' | 'lost' | 'converted'; customerId: string | null; createdAt: string; rating?: 'hot' | 'warm' | 'cold' | null; ownerId?: string | null }
export interface DInteraction { id: string; businessId: string; customerId: string | null; leadId: string | null; dealId?: string | null; kind: string; summary: string; at: string }
export type TaskKind = 'todo' | 'call' | 'meeting' | 'email'
export interface DTask { id: string; businessId: string; customerId: string | null; leadId: string | null; dealId?: string | null; kind?: TaskKind; title: string; dueAt: string | null; status: 'open' | 'done' | 'cancelled'; outcome?: string | null; assignedTo?: string | null; completedAt?: string | null; createdAt?: string }
export interface DTag { id: string; businessId: string; name: string }
export interface DEntityTag { tagId: string; customerId: string | null; leadId: string | null }

export type StageKind = 'open' | 'won' | 'lost'
export interface DStage { id: string; businessId: string; name: string; position: number; probability: number; kind: StageKind }
export interface DDeal { id: string; businessId: string; title: string; customerId: string | null; leadId: string | null; value: number; stageId: string; stageKind: StageKind; expectedClose: string | null; ownerId: string | null; nextStep: string; notes: string; lostReason: string | null; closedAt: string | null; createdAt: string; lastMovedAt: string }
export interface DDealEvent { id: string; businessId: string; dealId: string; from: string | null; to: string; note: string | null; at: string }
export interface DQuoteLine { description: string; quantity: number; unitPrice: number }
export interface DQuote { id: string; businessId: string; number: string; dealId: string | null; customerId: string | null; leadId: string | null; issuedOn: string; validUntil: string | null; status: 'draft' | 'sent' | 'accepted' | 'declined'; lines: DQuoteLine[]; discount: number; subtotal: number; total: number; notes: string; createdAt: string }

interface Crm { leads: DLead[]; interactions: DInteraction[]; tasks: DTask[]; tags: DTag[]; entityTags: DEntityTag[]; seeded: string[]; deals: DDeal[]; dealEvents: DDealEvent[]; quotes: DQuote[]; quoteCount: Record<string, number>; stages: DStage[] }
const KEY = 'doa.demo.crm.v1'
const empty = (): Crm => ({ leads: [], interactions: [], tasks: [], tags: [], entityTags: [], seeded: [], deals: [], dealEvents: [], quotes: [], quoteCount: {}, stages: [] })
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

const DEFAULT_STAGES: [string, number, StageKind][] = [['New', 10, 'open'], ['Qualified', 25, 'open'], ['Proposal', 50, 'open'], ['Negotiation', 75, 'open'], ['Won', 100, 'won'], ['Lost', 0, 'lost']]
/** Every business starts with six stages (the database does the same on first use). */
function ensureStages(biz: string): DStage[] {
  if (!state.stages.some((s) => s.businessId === biz)) {
    commit({ ...state, stages: [...state.stages, ...DEFAULT_STAGES.map(([name, probability, kind], i) => ({ id: newId('stg'), businessId: biz, name, position: kind === 'open' ? i + 1 : kind === 'won' ? 1000 : 1001, probability, kind }))] })
  }
  return state.stages.filter((s) => s.businessId === biz).sort((a, b) => a.position - b.position)
}
const openStages = (biz: string) => ensureStages(biz).filter((s) => s.kind === 'open')

export function ensureDemoCrm(businessId: string) {
  if (state.seeded.includes(businessId)) return
  const stages = ensureStages(businessId); const stageNamed = (n: string) => stages.find((s) => s.name === n)!
  const now = new Date().toISOString()
  const bola = newId('lead'); const ngozi = newId('lead')
  const deal = (title: string, leadId: string, value: number, stage: string): DDeal => { const s = stageNamed(stage); return { id: newId('deal'), businessId, title, customerId: null, leadId, value, stageId: s.id, stageKind: s.kind, expectedClose: null, ownerId: getDemoState().userId, nextStep: '', notes: '', lostReason: null, closedAt: s.kind === 'won' ? now : null, createdAt: now, lastMovedAt: now } }
  const deals = [deal('Weekly supply to Bola Supermarket', bola, 450000, 'Proposal'), deal('Ngozi Events party order', ngozi, 120000, 'New')]
  commit({
    ...state,
    seeded: [...state.seeded, businessId],
    leads: [
      ...state.leads,
      { id: bola, businessId, name: 'Bola Supermarket', phone: '0805 000 0003', email: 'bola@example.com', source: 'referral', notes: 'Wants weekly delivery.', status: 'qualified', customerId: null, createdAt: now },
      { id: ngozi, businessId, name: 'Ngozi Events', phone: '0806 000 0004', email: null, source: 'instagram', notes: '', status: 'new', customerId: null, createdAt: now },
    ],
    deals: [...state.deals, ...deals],
    dealEvents: [...state.dealEvents, ...deals.map((d) => ({ id: newId('dev'), businessId, dealId: d.id, from: null, to: stageNamed('New').name, note: null, at: now }))],
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

export function demoAddInteraction(biz: string, parent: { customerId?: string; leadId?: string; dealId?: string }, kind: string, summary: string): string | null {
  return guarded(biz, () => {
    if (!summary.trim()) throw new Error('Write a short summary.')
    if (!['note', 'call', 'visit', 'message', 'meeting', 'email', 'other'].includes(kind)) throw new Error('choose a type')
    commit({ ...state, interactions: [...state.interactions, { id: newId('int'), businessId: biz, customerId: parent.customerId ?? null, leadId: parent.leadId ?? null, dealId: parent.dealId ?? null, kind, summary: summary.trim(), at: new Date().toISOString() }] })
  })
}

export function demoAddTask(biz: string, parent: { customerId?: string; leadId?: string; dealId?: string }, title: string, dueAt: string | null, kind: TaskKind = 'todo', assignedTo: string | null = null): string | null {
  return guarded(biz, () => {
    if (!title.trim()) throw new Error('Enter what needs to be done.')
    if (!['todo', 'call', 'meeting', 'email'].includes(kind)) throw new Error('choose a type')
    if (!parent.customerId && !parent.leadId && !parent.dealId) throw new Error('choose who or what this is about')
    commit({ ...state, tasks: [...state.tasks, { id: newId('task'), businessId: biz, customerId: parent.customerId ?? null, leadId: parent.leadId ?? null, dealId: parent.dealId ?? null, kind, title: title.trim(), dueAt, status: 'open', outcome: null, assignedTo, completedAt: null, createdAt: new Date().toISOString() }] })
  })
}

export function demoSetTaskStatus(biz: string, taskId: string, status: DTask['status'], outcome: string | null = null): string | null {
  return guarded(biz, () => commit({ ...state, tasks: state.tasks.map((t) => (t.id === taskId && t.businessId === biz ? { ...t, status, outcome: outcome?.trim() || t.outcome || null, completedAt: status === 'done' ? new Date().toISOString() : null } : t)) }))
}

/** Moves a task to a new time (rescheduling). */
export function demoRescheduleTask(biz: string, taskId: string, dueAt: string | null): string | null {
  return guarded(biz, () => commit({ ...state, tasks: state.tasks.map((t) => (t.id === taskId && t.businessId === biz ? { ...t, dueAt } : t)) }))
}

/** Rating and owner of a lead (hot, warm or cold; owner must be on the business). */
export function demoSetLeadMeta(biz: string, leadId: string, v: { rating: 'hot' | 'warm' | 'cold' | null; ownerId: string | null }): string | null {
  return guarded(biz, () => {
    if (v.rating && !['hot', 'warm', 'cold'].includes(v.rating)) throw new Error('choose hot, warm or cold')
    if (v.ownerId && !getDemoState().members.some((m) => m.businessId === biz && m.userId === v.ownerId && m.status === 'active')) throw new Error('that person is not on this business')
    if (!state.leads.some((l) => l.id === leadId && l.businessId === biz)) throw new Error('lead not found')
    commit({ ...state, leads: state.leads.map((l) => (l.id === leadId ? { ...l, rating: v.rating, ownerId: v.ownerId } : l)) })
  })
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
/** Name, phone and email of a customer or lead, for the one-click call, WhatsApp and email buttons. */
export function demoContact(biz: string, customerId: string | null, leadId: string | null): { name: string; phone: string | null; email: string | null } {
  const c = getTrade().customers.find((x) => x.businessId === biz && x.id === customerId)
  if (c) return { name: c.name, phone: c.phone, email: c.email }
  const l = state.leads.find((x) => x.businessId === biz && x.id === leadId)
  return l ? { name: l.name, phone: l.phone, email: l.email } : { name: '', phone: null, email: null }
}
/** Who an activity is about: its deal (with the deal's contact) or its customer or lead. */
export function demoSubject(biz: string, customerId: string | null, leadId: string | null, dealId: string | null): { name: string; phone: string | null; email: string | null } {
  const d = dealId ? state.deals.find((x) => x.id === dealId && x.businessId === biz) : undefined
  const c = demoContact(biz, customerId ?? d?.customerId ?? null, leadId ?? d?.leadId ?? null)
  return d ? { ...c, name: c.name ? `${d.title} · ${c.name}` : d.title } : c
}
export const demoDeals = (biz: string) => state.deals.filter((d) => d.businessId === biz)
export const demoDealEvents = (biz: string, dealId: string) => state.dealEvents.filter((e) => e.businessId === biz && e.dealId === dealId)
export const demoQuotes = (biz: string) => state.quotes.filter((q) => q.businessId === biz)

const memberOk = (biz: string, userId: string) => getDemoState().members.some((m) => m.businessId === biz && m.userId === userId && m.status === 'active')
export const demoTeam = (biz: string) => getDemoState().members.filter((m) => m.businessId === biz && m.status === 'active' && m.userId).map((m) => ({ userId: m.userId as string, name: m.name }))
export const demoStageList = (biz: string) => ensureStages(biz).map((s) => ({ ...s, deals: state.deals.filter((d) => d.stageId === s.id).length }))

export function demoSaveDeal(biz: string, d: { id: string | null; title: string; customerId: string | null; leadId: string | null; value: number; expectedClose: string | null; ownerId: string | null; notes: string }): string | null {
  return guarded(biz, () => {
    const first = openStages(biz)[0]
    if (!d.title.trim()) throw new Error('enter what the deal is for')
    if (!d.customerId && !d.leadId) throw new Error('choose the customer or lead this deal is with')
    if (!(d.value >= 0)) throw new Error('the deal value cannot be negative')
    if (d.customerId && !getTrade().customers.some((c) => c.businessId === biz && c.id === d.customerId)) throw new Error('customer not found')
    if (d.leadId && !state.leads.some((l) => l.businessId === biz && l.id === d.leadId)) throw new Error('lead not found')
    if (d.ownerId && !memberOk(biz, d.ownerId)) throw new Error('that person is not on this business')
    const now = new Date().toISOString()
    if (d.id === null) {
      const deal: DDeal = { id: newId('deal'), businessId: biz, title: d.title.trim(), customerId: d.customerId, leadId: d.leadId, value: money(d.value), stageId: first.id, stageKind: 'open', expectedClose: d.expectedClose, ownerId: d.ownerId ?? getDemoState().userId, nextStep: '', notes: d.notes, lostReason: null, closedAt: null, createdAt: now, lastMovedAt: now }
      commit({ ...state, deals: [...state.deals, deal], dealEvents: [...state.dealEvents, { id: newId('dev'), businessId: biz, dealId: deal.id, from: null, to: first.name, note: null, at: now }] })
    } else {
      if (!state.deals.some((x) => x.id === d.id && x.businessId === biz)) throw new Error('deal not found')
      commit({ ...state, deals: state.deals.map((x) => (x.id === d.id ? { ...x, title: d.title.trim(), customerId: d.customerId, leadId: d.leadId, value: money(d.value), expectedClose: d.expectedClose, ownerId: d.ownerId, notes: d.notes } : x)) })
    }
  })
}

export function demoMoveDeal(biz: string, dealId: string, stageId: string, reason: string): string | null {
  return guarded(biz, () => {
    const d = state.deals.find((x) => x.id === dealId && x.businessId === biz)
    if (!d) throw new Error('deal not found')
    const s = ensureStages(biz).find((x) => x.id === stageId)
    if (!s) throw new Error("choose one of this pipeline's stages")
    if (d.stageId === stageId) return
    if (s.kind === 'lost' && !reason.trim()) throw new Error('say why the deal was lost')
    const from = state.stages.find((x) => x.id === d.stageId)?.name ?? null; const at = new Date().toISOString()
    commit({
      ...state,
      deals: state.deals.map((x) => (x.id === dealId ? { ...x, stageId, stageKind: s.kind, lastMovedAt: at, lostReason: s.kind === 'lost' ? reason.trim() : null, closedAt: s.kind === 'won' || s.kind === 'lost' ? at : null } : x)),
      dealEvents: [...state.dealEvents, { id: newId('dev'), businessId: biz, dealId, from, to: s.name, note: reason.trim() || null, at }],
    })
  })
}

export function demoSetNextStep(biz: string, dealId: string, text: string): string | null {
  return guarded(biz, () => {
    if (!state.deals.some((x) => x.id === dealId && x.businessId === biz)) throw new Error('deal not found')
    if (text.length > 300) throw new Error('the next step is too long')
    commit({ ...state, deals: state.deals.map((x) => (x.id === dealId ? { ...x, nextStep: text.trim() } : x)) })
  })
}

export function demoSaveStage(biz: string, v: { id: string | null; name: string; probability: number }): string | null {
  return guarded(biz, () => {
    const list = ensureStages(biz)
    const name = v.name.trim()
    if (!name) throw new Error('enter a name for the stage')
    if (name.length > 40) throw new Error('the stage name is too long')
    if (!(v.probability >= 0 && v.probability <= 100)) throw new Error('the chance of winning must be between 0 and 100')
    if (list.some((s) => s.id !== v.id && s.name.toLowerCase() === name.toLowerCase())) throw new Error('there is already a stage with this name')
    if (v.id === null) {
      const pos = Math.max(0, ...list.filter((s) => s.kind === 'open').map((s) => s.position)) + 1
      commit({ ...state, stages: [...state.stages, { id: newId('stg'), businessId: biz, name, position: pos, probability: Math.round(v.probability), kind: 'open' }] })
    } else {
      const cur = list.find((s) => s.id === v.id)
      if (!cur) throw new Error('stage not found')
      commit({ ...state, stages: state.stages.map((s) => (s.id === v.id ? { ...s, name, probability: cur.kind === 'won' ? 100 : cur.kind === 'lost' ? 0 : Math.round(v.probability) } : s)) })
    }
  })
}

export function demoReorderStages(biz: string, ids: string[]): string | null {
  return guarded(biz, () => {
    const open = openStages(biz)
    if (ids.length !== open.length || new Set(ids).size !== open.length || ids.some((id) => !open.some((s) => s.id === id))) throw new Error('list every open stage once, in the order you want')
    commit({ ...state, stages: state.stages.map((s) => (ids.includes(s.id) ? { ...s, position: ids.indexOf(s.id) + 1 } : s)) })
  })
}

export function demoDeleteStage(biz: string, stageId: string): string | null {
  return guarded(biz, () => {
    const list = ensureStages(biz); const s = list.find((x) => x.id === stageId)
    if (!s) throw new Error('stage not found')
    if (s.kind !== 'open') throw new Error('Won and Lost are always part of the pipeline')
    if (state.deals.some((d) => d.stageId === stageId)) throw new Error('move the deals out of this stage before removing it')
    if (list.filter((x) => x.kind === 'open').length <= 1) throw new Error('a pipeline needs at least one open stage')
    commit({ ...state, stages: state.stages.filter((x) => x.id !== stageId) })
  })
}

export interface DImportResult { created: number; duplicates: number[]; invalid: { row: number; reason: string }[] }
/** Mirrors crm_import(): up to 500 rows, duplicates by email or phone are skipped (against what exists and inside the file), and a plan limit stops it with nothing imported. */
export function demoImport(biz: string, kind: 'customers' | 'leads', rows: { name?: string; phone?: string; email?: string; company?: string; city?: string; source?: string; category?: string; notes?: string }[]): { error: string | null; result?: DImportResult } {
  try {
    need(biz)
    if (!rows.length) throw new Error('there are no rows to import')
    if (rows.length > 500) throw new Error('import at most 500 rows at a time')
    const trade = getTrade(); const seenEmail = new Set<string>(); const seenPhone = new Set<string>()
    const dups: number[] = []; const bad: { row: number; reason: string }[] = []; const toAdd: typeof rows = []
    rows.forEach((r, idx) => {
      const i = idx + 1; const name = (r.name ?? '').trim(); const phone = (r.phone ?? '').trim() || null; const email = (r.email ?? '').trim().toLowerCase() || null
      if (!name) return void bad.push({ row: i, reason: 'no name' })
      if (name.length > 200) return void bad.push({ row: i, reason: 'name is too long' })
      if (email && !/^\S+@\S+\.\S+$/.test(email)) return void bad.push({ row: i, reason: 'email is not valid' })
      const exists = trade.customers.some((c) => c.businessId === biz && ((email && c.email?.toLowerCase() === email) || (phone && c.phone === phone)))
        || (kind === 'leads' && state.leads.some((l) => l.businessId === biz && ((email && l.email?.toLowerCase() === email) || (phone && l.phone === phone))))
      if ((email && seenEmail.has(email)) || (phone && seenPhone.has(phone)) || exists) return void dups.push(i)
      if (email) seenEmail.add(email)
      if (phone) seenPhone.add(phone)
      toAdd.push({ ...r, name, phone: phone ?? '', email: email ?? '' })
    })
    // A plan limit stops the whole import before anything is added.
    if (kind === 'customers') {
      const limit = demoUsageLimitFor(biz); const have = trade.customers.filter((c) => c.businessId === biz).length
      if (limit !== null && have + toAdd.length > limit) throw new Error(`plan limit reached: your plan allows ${limit} customers. Upgrade the plan to add more; everything you already have is kept.`)
    }
    const now = new Date().toISOString()
    if (kind === 'customers') {
      for (const r of toAdd) demoInsertCustomer({ id: newId('c'), businessId: biz, name: r.name!, phone: r.phone || null, email: r.email || null, source: r.source?.trim() || 'import', category: r.category?.trim() || null, creditLimit: 0, createdAt: now, company: r.company?.trim() || null, city: r.city?.trim() || null, notes: r.notes?.trim() || null } as Parameters<typeof demoInsertCustomer>[0])
    } else {
      commit({ ...state, leads: [...state.leads, ...toAdd.map((r): DLead => ({ id: newId('lead'), businessId: biz, name: r.name!, phone: r.phone || null, email: r.email || null, source: r.source?.trim() || 'import', notes: r.notes?.trim() ?? '', status: 'new', customerId: null, createdAt: now }))] })
    }
    return { error: null, result: { created: toAdd.length, duplicates: dups, invalid: bad } }
  } catch (e) { return { error: (e as Error).message } }
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

export interface DCrmReport {
  stages: { id: string; stage: string; kind: StageKind; probability: number; deals: number; value: number }[]
  openValue: number; openDeals: number; weightedValue: number; wonThisMonth: number; wonDealsThisMonth: number; winRate: number | null; avgCycleDays: number | null
  leads: Record<string, number>; overdueTasks: number; dueToday: number; activitiesDone30d: number; staleDeals: number; lostReasons: { reason: string; deals: number }[]
  forecast: { month: string; deals: number; value: number; weighted: number }[]
  byOwner: { owner: string; openDeals: number; openValue: number; wonThisMonth: number }[]
  bySource: { source: string; leads: number; deals: number; won: number; wonValue: number }[]
}
export function demoCrmReport(biz: string): DCrmReport {
  if (!demoAllowed(biz, 'customers', 'customers.read')) throw new Error('permission denied')
  const stages = ensureStages(biz); const deals = demoDeals(biz); const month = new Date().toISOString().slice(0, 7); const now = Date.now(); const today = new Date().toISOString().slice(0, 10)
  const prob = (d: DDeal) => stages.find((s) => s.id === d.stageId)?.probability ?? 0
  const open = deals.filter((d) => d.stageKind === 'open'); const won = deals.filter((d) => d.stageKind === 'won'); const lost = deals.filter((d) => d.stageKind === 'lost')
  const wonMonth = won.filter((d) => d.closedAt?.slice(0, 7) === month)
  const tasks = state.tasks.filter((t) => t.businessId === biz)
  const leads: Record<string, number> = {}
  for (const l of state.leads.filter((x) => x.businessId === biz)) leads[l.status] = (leads[l.status] ?? 0) + 1
  const reasons = new Map<string, number>(); for (const d of lost) reasons.set(d.lostReason ?? '', (reasons.get(d.lostReason ?? '') ?? 0) + 1)
  const fc = new Map<string, { deals: number; value: number; weighted: number }>()
  for (const d of open) { const m = d.expectedClose?.slice(0, 7) ?? 'none'; const c = fc.get(m) ?? { deals: 0, value: 0, weighted: 0 }; fc.set(m, { deals: c.deals + 1, value: c.value + d.value, weighted: money(c.weighted + (d.value * prob(d)) / 100) }) }
  const names = new Map(getDemoState().members.filter((m) => m.businessId === biz && m.userId).map((m) => [m.userId as string, m.name]))
  const owners = new Map<string, { openDeals: number; openValue: number; wonThisMonth: number }>()
  for (const d of deals) { const o = d.ownerId ? names.get(d.ownerId) ?? 'Unassigned' : 'Unassigned'; const c = owners.get(o) ?? { openDeals: 0, openValue: 0, wonThisMonth: 0 }; owners.set(o, { openDeals: c.openDeals + (d.stageKind === 'open' ? 1 : 0), openValue: c.openValue + (d.stageKind === 'open' ? d.value : 0), wonThisMonth: c.wonThisMonth + (d.stageKind === 'won' && d.closedAt?.slice(0, 7) === month ? d.value : 0) }) }
  const sources = new Map<string, { leads: number; deals: number; won: number; wonValue: number }>()
  for (const l of state.leads.filter((x) => x.businessId === biz)) { const s = l.source ?? 'Not recorded'; const ds = deals.filter((d) => d.leadId === l.id); const c = sources.get(s) ?? { leads: 0, deals: 0, won: 0, wonValue: 0 }; sources.set(s, { leads: c.leads + 1, deals: c.deals + ds.length, won: c.won + ds.filter((d) => d.stageKind === 'won').length, wonValue: c.wonValue + ds.filter((d) => d.stageKind === 'won').reduce((a, d) => a + d.value, 0) }) }
  const cycle = won.length ? Math.round((won.reduce((a, d) => a + (new Date(d.closedAt!).getTime() - new Date(d.createdAt).getTime()) / 86400000, 0) / won.length) * 10) / 10 : null
  return {
    stages: stages.map((s) => ({ id: s.id, stage: s.name, kind: s.kind, probability: s.probability, deals: deals.filter((d) => d.stageId === s.id).length, value: deals.filter((d) => d.stageId === s.id).reduce((a, d) => a + d.value, 0) })),
    openValue: open.reduce((a, d) => a + d.value, 0), openDeals: open.length, weightedValue: money(open.reduce((a, d) => a + (d.value * prob(d)) / 100, 0)),
    wonThisMonth: wonMonth.reduce((a, d) => a + d.value, 0), wonDealsThisMonth: wonMonth.length, winRate: won.length + lost.length ? Math.round((won.length * 1000) / (won.length + lost.length)) / 10 : null, avgCycleDays: cycle, leads,
    overdueTasks: tasks.filter((t) => t.status === 'open' && t.dueAt && new Date(t.dueAt).getTime() < now).length, dueToday: tasks.filter((t) => t.status === 'open' && t.dueAt?.slice(0, 10) === today).length,
    activitiesDone30d: tasks.filter((t) => t.status === 'done' && t.completedAt && new Date(t.completedAt).getTime() >= now - 30 * 86400000).length,
    staleDeals: open.filter((d) => new Date(d.lastMovedAt).getTime() < now - 14 * 86400000 && !state.interactions.some((i) => i.dealId === d.id && new Date(i.at).getTime() >= now - 14 * 86400000)).length,
    lostReasons: [...reasons].map(([reason, n]) => ({ reason, deals: n })).sort((a, z) => z.deals - a.deals).slice(0, 5),
    forecast: [...fc].map(([m, v]) => ({ month: m, ...v })).sort((a, z) => a.month.localeCompare(z.month)),
    byOwner: [...owners].map(([owner, v]) => ({ owner, ...v })).sort((a, z) => z.openValue - a.openValue),
    bySource: [...sources].map(([source, v]) => ({ source, ...v })).sort((a, z) => z.leads - a.leads),
  }
}

const demoUsageLimitFor = (biz: string) => usageLimit(biz, 'customers')
