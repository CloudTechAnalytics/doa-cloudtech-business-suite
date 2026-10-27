import * as demo from '@/demo/demoCrm'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { searchCustomers, searchLeads } from './crmApi'

/** Pipeline stages, deals, activities, import, quotes and the CRM report. Live mode goes through the database functions; demo mode runs the browser mirror. */

export type StageKind = demo.StageKind
export interface StageRow { id: string; name: string; position: number; probability: number; kind: StageKind; deals: number }
export interface DealRow {
  id: string; title: string; customerId: string | null; leadId: string | null; contact: string; contactPhone: string | null; contactEmail: string | null; value: number
  stageId: string; stageName: string; stageKind: StageKind; probability: number; ownerId: string | null; ownerName: string | null; expectedClose: string | null; nextStep: string
  notes: string; lostReason: string | null; closedAt: string | null; createdAt: string; lastMovedAt: string; stale: boolean
}
export interface DealInput { id: string | null; title: string; customerId: string | null; leadId: string | null; value: number; expectedClose: string | null; ownerId: string | null; notes: string }
export interface DealEvent { from: string | null; to: string; note: string | null; at: string }
export interface TeamMember { userId: string; name: string }
export type ActivityKind = demo.TaskKind
export const ACTIVITY_KINDS: { value: ActivityKind; label: string }[] = [{ value: 'todo', label: 'To do' }, { value: 'call', label: 'Call' }, { value: 'meeting', label: 'Meeting' }, { value: 'email', label: 'Email' }]
export interface ActivityRow {
  id: string; kind: ActivityKind; title: string; dueAt: string | null; status: 'open' | 'done' | 'cancelled'; outcome: string | null; assignedTo: string | null; assignee: string | null
  customerId: string | null; leadId: string | null; dealId: string | null; subject: string; subjectPhone: string | null; subjectEmail: string | null; completedAt: string | null
}
export interface ActivityParent { customerId?: string; leadId?: string; dealId?: string }
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined'
export interface QuoteLine { description: string; quantity: number; unitPrice: number }
export interface QuoteRow { id: string; number: string; dealId: string | null; customerId: string | null; leadId: string | null; contact: string; issuedOn: string; validUntil: string | null; status: QuoteStatus; lines: QuoteLine[]; discount: number; subtotal: number; total: number; notes: string }
export interface QuoteInput { id: string | null; dealId: string | null; customerId: string | null; leadId: string | null; validUntil: string | null; lines: QuoteLine[]; discount: number; notes: string }
export interface CrmReport {
  stages: { id: string; stage: string; kind: StageKind; probability: number; deals: number; value: number }[]
  openValue: number; openDeals: number; weightedValue: number; wonThisMonth: number; wonDealsThisMonth: number; winRate: number | null; avgCycleDays: number | null
  leads: Record<string, number>; overdueTasks: number; dueToday: number; activitiesDone30d: number; staleDeals: number; lostReasons: { reason: string; deals: number }[]
  forecast: { month: string; deals: number; value: number; weighted: number }[]
  byOwner: { owner: string; openDeals: number; openValue: number; wonThisMonth: number }[]
  bySource: { source: string; leads: number; deals: number; won: number; wonValue: number }[]
}
export interface Contact { kind: 'customer' | 'lead'; id: string; name: string; phone: string | null; email: string | null }
export interface ImportRow { name?: string; phone?: string; email?: string; company?: string; city?: string; source?: string; category?: string; notes?: string }
export interface ImportResult { created: number; duplicates: number[]; invalid: { row: number; reason: string }[] }

const db = () => supabase!
const n = (v: unknown) => Number(v ?? 0)
const err = (e: { message: string } | null) => e?.message ?? null
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null)
const STALE_DAYS = 14

/** Customers and open leads, for choosing who a deal, activity or quote is with. */
export async function listContacts(b: string): Promise<Contact[]> {
  const [c, l] = await Promise.all([searchCustomers(b, { q: '', category: '', page: 0, pageSize: 500 }), searchLeads(b, { q: '', status: '', page: 0, pageSize: 500 })])
  return [
    ...c.rows.map((x): Contact => ({ kind: 'customer', id: x.id, name: x.name, phone: x.phone, email: x.email })),
    ...l.rows.filter((x) => x.status !== 'converted').map((x): Contact => ({ kind: 'lead', id: x.id, name: x.name, phone: x.phone, email: x.email })),
  ].sort((a, z) => a.name.localeCompare(z.name))
}

/** People on the business, for choosing an owner. */
export async function listTeam(b: string): Promise<TeamMember[]> {
  if (isDemoMode) return demo.demoTeam(b)
  const r = await db().from('business_members').select('user_id, profiles!business_members_user_id_fkey(display_name)').eq('business_id', b).eq('status', 'active')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ userId: String(x.user_id), name: String((x.profiles as unknown as { display_name: string } | null)?.display_name ?? 'Member') })).sort((a, z) => a.name.localeCompare(z.name))
}

type Who = { name: string; phone: string | null; email: string | null }
async function whoMap(b: string, rows: { customerId: string | null; leadId: string | null }[]): Promise<(r: { customerId: string | null; leadId: string | null }) => Who> {
  const cust = [...new Set(rows.map((x) => x.customerId).filter(Boolean))] as string[]
  const lead = [...new Set(rows.map((x) => x.leadId).filter(Boolean))] as string[]
  const [cs, ls] = await Promise.all([
    cust.length ? db().from('customers').select('id, name, phone, email').eq('business_id', b).in('id', cust) : { data: [] },
    lead.length ? db().from('crm_leads').select('id, name, phone, email').eq('business_id', b).in('id', lead) : { data: [] },
  ])
  const map = new Map<string, Who>([...(cs.data ?? []), ...(ls.data ?? [])].map((x) => [String(x.id), { name: String(x.name), phone: (x.phone as string | null) ?? null, email: (x.email as string | null) ?? null }]))
  return (r) => map.get(r.customerId ?? r.leadId ?? '') ?? { name: '', phone: null, email: null }
}

// ------------------------------------------------------------------- stages
export async function listStages(b: string): Promise<StageRow[]> {
  if (isDemoMode) { demo.ensureDemoCrm(b); return demo.demoStageList(b) }
  const { data, error } = await db().rpc('crm_list_stages', { p_business: b })
  if (error) throw new Error(error.message)
  return (data as { id: string; name: string; position: number; probability: number; kind: StageKind; deals: number }[]).map((s) => ({ id: s.id, name: s.name, position: n(s.position), probability: n(s.probability), kind: s.kind, deals: n(s.deals) }))
}
export async function saveStage(b: string, v: { id: string | null; name: string; probability: number }) {
  if (isDemoMode) return demo.demoSaveStage(b, v)
  return err((await db().rpc('crm_save_stage', { p_business: b, p_id: v.id, p_name: v.name, p_probability: v.probability })).error)
}
export async function reorderStages(b: string, ids: string[]) {
  if (isDemoMode) return demo.demoReorderStages(b, ids)
  return err((await db().rpc('crm_reorder_stages', { p_business: b, p_ids: ids })).error)
}
export async function deleteStage(b: string, id: string) {
  if (isDemoMode) return demo.demoDeleteStage(b, id)
  return err((await db().rpc('crm_delete_stage', { p_stage: id })).error)
}

// -------------------------------------------------------------------- deals
export async function listDeals(b: string): Promise<DealRow[]> {
  const stages = await listStages(b); const team = await listTeam(b)
  const stageOf = (id: string) => stages.find((s) => s.id === id)
  const ownerName = (id: string | null) => (id ? team.find((m) => m.userId === id)?.name ?? null : null)
  const stale = (kind: StageKind, lastMoved: string, quietSince: boolean) => kind === 'open' && Date.now() - new Date(lastMoved).getTime() > STALE_DAYS * 86400000 && quietSince
  if (isDemoMode) {
    demo.ensureDemoCrm(b)
    const crm = demo.getCrm()
    return demo.demoDeals(b).map((d): DealRow => {
      const s = stageOf(d.stageId); const c = demo.demoContact(b, d.customerId, d.leadId)
      const quiet = !crm.interactions.some((i) => i.dealId === d.id && Date.now() - new Date(i.at).getTime() < STALE_DAYS * 86400000)
      return { id: d.id, title: d.title, customerId: d.customerId, leadId: d.leadId, contact: c.name, contactPhone: c.phone, contactEmail: c.email, value: d.value, stageId: d.stageId, stageName: s?.name ?? '', stageKind: d.stageKind, probability: s?.probability ?? 0,
        ownerId: d.ownerId, ownerName: ownerName(d.ownerId), expectedClose: d.expectedClose, nextStep: d.nextStep, notes: d.notes, lostReason: d.lostReason, closedAt: d.closedAt, createdAt: d.createdAt, lastMovedAt: d.lastMovedAt, stale: stale(d.stageKind, d.lastMovedAt, quiet) }
    }).sort((a, z) => z.createdAt.localeCompare(a.createdAt))
  }
  const r = await db().from('crm_deals').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(1000)
  if (r.error) throw new Error(r.error.message)
  const refs = (r.data ?? []).map((x) => ({ customerId: (x.customer_id as string | null) ?? null, leadId: (x.lead_id as string | null) ?? null }))
  const who = await whoMap(b, refs)
  const since = new Date(Date.now() - STALE_DAYS * 86400000).toISOString()
  const touched = new Set(((await db().from('crm_interactions').select('deal_id').eq('business_id', b).not('deal_id', 'is', null).gte('occurred_at', since)).data ?? []).map((x) => String(x.deal_id)))
  return (r.data ?? []).map((x, i): DealRow => {
    const s = stageOf(String(x.stage_id)); const w = who(refs[i]); const kind = x.stage_kind as StageKind
    return { id: String(x.id), title: String(x.title), customerId: refs[i].customerId, leadId: refs[i].leadId, contact: w.name, contactPhone: w.phone, contactEmail: w.email, value: n(x.value), stageId: String(x.stage_id), stageName: s?.name ?? '', stageKind: kind, probability: s?.probability ?? 0,
      ownerId: (x.owner_id as string | null) ?? null, ownerName: ownerName((x.owner_id as string | null) ?? null), expectedClose: day(x.expected_close), nextStep: String(x.next_step ?? ''), notes: String(x.notes ?? ''), lostReason: (x.lost_reason as string | null) ?? null,
      closedAt: (x.closed_at as string | null) ?? null, createdAt: String(x.created_at), lastMovedAt: String(x.last_moved_at), stale: stale(kind, String(x.last_moved_at), !touched.has(String(x.id))) }
  })
}

export async function saveDeal(b: string, d: DealInput) {
  if (isDemoMode) return demo.demoSaveDeal(b, d)
  return err((await db().rpc('crm_save_deal', { p_business: b, p_id: d.id, p_title: d.title, p_customer: d.customerId, p_lead: d.leadId, p_value: d.value, p_expected: d.expectedClose, p_owner: d.ownerId, p_notes: d.notes })).error)
}
export async function moveDeal(b: string, id: string, stageId: string, reason = '') {
  if (isDemoMode) return demo.demoMoveDeal(b, id, stageId, reason)
  return err((await db().rpc('crm_move_deal', { p_deal: id, p_stage: stageId, p_reason: reason })).error)
}
export async function setNextStep(b: string, id: string, text: string) {
  if (isDemoMode) return demo.demoSetNextStep(b, id, text)
  return err((await db().rpc('crm_set_next_step', { p_deal: id, p_text: text })).error)
}
export async function dealEvents(b: string, id: string): Promise<DealEvent[]> {
  if (isDemoMode) return demo.demoDealEvents(b, id).map((e) => ({ from: e.from, to: e.to, note: e.note, at: e.at }))
  const r = await db().from('crm_deal_events').select('from_stage, to_stage, note, at').eq('business_id', b).eq('deal_id', id).order('at')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ from: (x.from_stage as string | null) ?? null, to: String(x.to_stage), note: (x.note as string | null) ?? null, at: String(x.at) }))
}

// --------------------------------------------------------------- activities
export async function listActivities(b: string): Promise<ActivityRow[]> {
  const team = await listTeam(b)
  const assignee = (id: string | null) => (id ? team.find((m) => m.userId === id)?.name ?? null : null)
  if (isDemoMode) {
    demo.ensureDemoCrm(b)
    return demo.getCrm().tasks.filter((t) => t.businessId === b).map((t): ActivityRow => {
      const subject = demo.demoSubject(b, t.customerId, t.leadId, t.dealId ?? null)
      return { id: t.id, kind: t.kind ?? 'todo', title: t.title, dueAt: t.dueAt, status: t.status, outcome: t.outcome ?? null, assignedTo: t.assignedTo ?? null, assignee: assignee(t.assignedTo ?? null), customerId: t.customerId, leadId: t.leadId, dealId: t.dealId ?? null, subject: subject.name, subjectPhone: subject.phone, subjectEmail: subject.email, completedAt: t.completedAt ?? null }
    })
  }
  const r = await db().from('crm_tasks').select('*').eq('business_id', b).in('status', ['open', 'done']).order('due_at', { ascending: true, nullsFirst: false }).limit(1000)
  if (r.error) throw new Error(r.error.message)
  const dealIds = [...new Set((r.data ?? []).map((x) => x.deal_id as string | null).filter(Boolean))] as string[]
  const deals = dealIds.length ? await db().from('crm_deals').select('id, title, customer_id, lead_id').eq('business_id', b).in('id', dealIds) : { data: [] }
  const dealBy = new Map((deals.data ?? []).map((d) => [String(d.id), d]))
  const refs = (r.data ?? []).map((x) => { const d = x.deal_id ? dealBy.get(String(x.deal_id)) : null; return { customerId: ((x.customer_id as string | null) ?? (d?.customer_id as string | null)) ?? null, leadId: ((x.lead_id as string | null) ?? (d?.lead_id as string | null)) ?? null } })
  const who = await whoMap(b, refs)
  return (r.data ?? []).map((x, i): ActivityRow => {
    const d = x.deal_id ? dealBy.get(String(x.deal_id)) : null; const w = who(refs[i])
    return { id: String(x.id), kind: x.kind as ActivityKind, title: String(x.title), dueAt: (x.due_at as string | null) ?? null, status: x.status as ActivityRow['status'], outcome: (x.outcome as string | null) ?? null, assignedTo: (x.assigned_to as string | null) ?? null, assignee: assignee((x.assigned_to as string | null) ?? null),
      customerId: (x.customer_id as string | null) ?? null, leadId: (x.lead_id as string | null) ?? null, dealId: (x.deal_id as string | null) ?? null, subject: d ? `${String(d.title)}${w.name ? ` · ${w.name}` : ''}` : w.name, subjectPhone: w.phone, subjectEmail: w.email, completedAt: (x.completed_at as string | null) ?? null }
  })
}

export async function createActivity(b: string, parent: ActivityParent, v: { kind: ActivityKind; title: string; dueAt: string | null; assignedTo: string | null }) {
  if (isDemoMode) return demo.demoAddTask(b, parent, v.title, v.dueAt, v.kind, v.assignedTo)
  if (!v.title.trim()) return 'Enter what needs to be done.'
  return err((await db().from('crm_tasks').insert({ business_id: b, customer_id: parent.customerId ?? null, lead_id: parent.leadId ?? null, deal_id: parent.dealId ?? null, kind: v.kind, title: v.title.trim(), due_at: v.dueAt, assigned_to: v.assignedTo })).error)
}

/** Marks an activity done with what happened. A call, meeting or email also goes on the timeline of whoever it was about. */
export async function completeActivity(b: string, a: ActivityRow, outcome: string) {
  if (isDemoMode) {
    const e = demo.demoSetTaskStatus(b, a.id, 'done', outcome)
    if (!e && outcome.trim() && a.kind !== 'todo') demo.demoAddInteraction(b, { customerId: a.customerId ?? undefined, leadId: a.leadId ?? undefined, dealId: a.dealId ?? undefined }, a.kind, outcome)
    return e
  }
  const e = err((await db().from('crm_tasks').update({ status: 'done', outcome: outcome.trim() || null }).eq('id', a.id).eq('business_id', b)).error)
  if (!e && outcome.trim() && a.kind !== 'todo') await db().from('crm_interactions').insert({ business_id: b, customer_id: a.customerId, lead_id: a.leadId, deal_id: a.dealId, kind: a.kind, summary: outcome.trim() })
  return e
}
export async function rescheduleActivity(b: string, id: string, dueAt: string | null) {
  if (isDemoMode) return demo.demoRescheduleTask(b, id, dueAt)
  return err((await db().from('crm_tasks').update({ due_at: dueAt }).eq('id', id).eq('business_id', b)).error)
}
export async function cancelActivity(b: string, id: string) {
  if (isDemoMode) return demo.demoSetTaskStatus(b, id, 'cancelled')
  return err((await db().from('crm_tasks').update({ status: 'cancelled' }).eq('id', id).eq('business_id', b)).error)
}

/** Everything that happened on a deal: logged calls, meetings and notes, newest first. */
export async function dealInteractions(b: string, dealId: string): Promise<{ kind: string; summary: string; at: string }[]> {
  if (isDemoMode) return demo.getCrm().interactions.filter((i) => i.businessId === b && i.dealId === dealId).map((i) => ({ kind: i.kind, summary: i.summary, at: i.at })).sort((a, z) => z.at.localeCompare(a.at))
  const r = await db().from('crm_interactions').select('kind, summary, occurred_at').eq('business_id', b).eq('deal_id', dealId).order('occurred_at', { ascending: false })
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ kind: String(x.kind), summary: String(x.summary), at: String(x.occurred_at) }))
}
export async function logOnDeal(b: string, dealId: string, kind: string, summary: string) {
  if (isDemoMode) return demo.demoAddInteraction(b, { dealId }, kind, summary)
  if (!summary.trim()) return 'Write a short summary.'
  return err((await db().from('crm_interactions').insert({ business_id: b, deal_id: dealId, kind, summary: summary.trim() })).error)
}

// ------------------------------------------------------------------- import
/** Imports customers or leads from parsed rows. Duplicates (same email or phone) are skipped and reported; a plan limit imports nothing. */
export async function importContacts(b: string, kind: 'customers' | 'leads', rows: ImportRow[]): Promise<{ error: string | null; result?: ImportResult }> {
  if (isDemoMode) return demo.demoImport(b, kind, rows)
  const { data, error } = await db().rpc('crm_import', { p_business: b, p_kind: kind, p_rows: rows })
  if (error) return { error: error.message }
  const x = data as { created: number; duplicates: number[]; invalid: { row: number; reason: string }[] }
  return { error: null, result: { created: n(x.created), duplicates: x.duplicates ?? [], invalid: x.invalid ?? [] } }
}

// ------------------------------------------------------------------- quotes
const quoteFrom = (r: Record<string, unknown>, contact: string): QuoteRow => ({
  id: String(r.id), number: String(r.number), dealId: (r.deal_id as string | null) ?? null, customerId: (r.customer_id as string | null) ?? null, leadId: (r.lead_id as string | null) ?? null, contact,
  issuedOn: String(r.issued_on).slice(0, 10), validUntil: day(r.valid_until), status: r.status as QuoteStatus, discount: n(r.discount), subtotal: n(r.subtotal), total: n(r.total), notes: String(r.notes ?? ''),
  lines: (r.lines as { description: string; quantity: number; unit_price: number }[]).map((l) => ({ description: l.description, quantity: n(l.quantity), unitPrice: n(l.unit_price) })),
})

export async function listQuotes(b: string): Promise<QuoteRow[]> {
  if (isDemoMode) {
    demo.ensureDemoCrm(b)
    return demo.demoQuotes(b).map((q) => {
      const deal = q.dealId ? demo.demoDeals(b).find((d) => d.id === q.dealId) : undefined
      return { ...q, contact: demo.demoContact(b, q.customerId ?? deal?.customerId ?? null, q.leadId ?? deal?.leadId ?? null).name }
    }).sort((a, z) => z.number.localeCompare(a.number))
  }
  const r = await db().from('crm_quotes').select('*').eq('business_id', b).order('number', { ascending: false }).limit(500)
  if (r.error) throw new Error(r.error.message)
  const deals = (r.data ?? []).filter((x) => x.deal_id && !x.customer_id && !x.lead_id).map((x) => x.deal_id as string)
  const dealContacts = deals.length ? await db().from('crm_deals').select('id, customer_id, lead_id').eq('business_id', b).in('id', deals) : { data: [] }
  const viaDeal = new Map((dealContacts.data ?? []).map((d) => [String(d.id), { customerId: (d.customer_id as string | null) ?? null, leadId: (d.lead_id as string | null) ?? null }]))
  const refs = (r.data ?? []).map((x) => (x.customer_id || x.lead_id ? { customerId: (x.customer_id as string | null) ?? null, leadId: (x.lead_id as string | null) ?? null } : viaDeal.get(x.deal_id as string) ?? { customerId: null, leadId: null }))
  const who = await whoMap(b, refs)
  return (r.data ?? []).map((x, i) => quoteFrom(x, who(refs[i]).name))
}

export async function saveQuote(b: string, q: QuoteInput) {
  if (isDemoMode) return demo.demoSaveQuote(b, q)
  return err((await db().rpc('crm_save_quote', { p_business: b, p_id: q.id, p_deal: q.dealId, p_customer: q.customerId, p_lead: q.leadId, p_valid: q.validUntil, p_lines: q.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unitPrice })), p_discount: q.discount, p_notes: q.notes })).error)
}
export async function setQuoteStatus(b: string, id: string, status: 'sent' | 'accepted' | 'declined') {
  if (isDemoMode) return demo.demoSetQuoteStatus(b, id, status)
  return err((await db().rpc('crm_set_quote_status', { p_quote: id, p_status: status })).error)
}

// ------------------------------------------------------------------- report
export async function crmReport(b: string): Promise<CrmReport> {
  if (isDemoMode) { demo.ensureDemoCrm(b); return demo.demoCrmReport(b) }
  const { data, error } = await db().rpc('crm_report', { p_business: b })
  if (error) throw new Error(error.message)
  const x = data as Record<string, unknown> & { stages: { id: string; stage: string; kind: StageKind; probability: number; deals: number; value: number }[] }
  const arr = <T,>(v: unknown) => (v as T[] | null) ?? []
  return {
    stages: x.stages.map((s) => ({ id: s.id, stage: s.stage, kind: s.kind, probability: n(s.probability), deals: n(s.deals), value: n(s.value) })),
    openValue: n(x.open_value), openDeals: n(x.open_deals), weightedValue: n(x.weighted_value), wonThisMonth: n(x.won_this_month), wonDealsThisMonth: n(x.won_deals_this_month), winRate: x.win_rate === null ? null : n(x.win_rate),
    avgCycleDays: x.avg_cycle_days === null ? null : n(x.avg_cycle_days), leads: x.leads as Record<string, number>, overdueTasks: n(x.overdue_tasks), dueToday: n(x.due_today), activitiesDone30d: n(x.activities_done_30d), staleDeals: n(x.stale_deals),
    lostReasons: arr<{ reason: string; deals: number }>(x.lost_reasons).map((l) => ({ reason: l.reason, deals: n(l.deals) })),
    forecast: arr<{ month: string; deals: number; value: number; weighted: number }>(x.forecast).map((f) => ({ month: f.month, deals: n(f.deals), value: n(f.value), weighted: n(f.weighted) })),
    byOwner: arr<{ owner: string; open_deals: number; open_value: number; won_this_month: number }>(x.by_owner).map((o) => ({ owner: o.owner, openDeals: n(o.open_deals), openValue: n(o.open_value), wonThisMonth: n(o.won_this_month) })),
    bySource: arr<{ source: string; leads: number; deals: number; won: number; won_value: number }>(x.by_source).map((s) => ({ source: s.source, leads: n(s.leads), deals: n(s.deals), won: n(s.won), wonValue: n(s.won_value) })),
  }
}
