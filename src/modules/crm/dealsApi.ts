import * as demo from '@/demo/demoCrm'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import { searchCustomers, searchLeads } from './crmApi'

/** Deals, quotes and the CRM report. Live mode goes through the database functions; demo mode runs the browser mirror. */

export const DEAL_STAGES = demo.DEAL_STAGES
export type DealStage = demo.DealStage
export const OPEN_STAGES: DealStage[] = ['new', 'qualified', 'proposal', 'negotiation']
export interface DealRow { id: string; title: string; customerId: string | null; leadId: string | null; contact: string; value: number; stage: DealStage; expectedClose: string | null; notes: string; lostReason: string | null; closedAt: string | null; createdAt: string }
export interface DealInput { id: string | null; title: string; customerId: string | null; leadId: string | null; value: number; expectedClose: string | null; notes: string }
export interface DealEvent { from: DealStage | null; to: DealStage; note: string | null; at: string }
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined'
export interface QuoteLine { description: string; quantity: number; unitPrice: number }
export interface QuoteRow { id: string; number: string; dealId: string | null; customerId: string | null; leadId: string | null; contact: string; issuedOn: string; validUntil: string | null; status: QuoteStatus; lines: QuoteLine[]; discount: number; subtotal: number; total: number; notes: string }
export interface QuoteInput { id: string | null; dealId: string | null; customerId: string | null; leadId: string | null; validUntil: string | null; lines: QuoteLine[]; discount: number; notes: string }
export interface CrmReport { stages: { stage: DealStage; deals: number; value: number }[]; openValue: number; openDeals: number; wonThisMonth: number; wonDealsThisMonth: number; winRate: number | null; leads: Record<string, number>; overdueTasks: number; dueToday: number; lostReasons: { reason: string; deals: number }[] }
export interface Contact { kind: 'customer' | 'lead'; id: string; name: string }

const db = () => supabase!
const n = (v: unknown) => Number(v ?? 0)
const err = (e: { message: string } | null) => e?.message ?? null
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null)

/** Customers and open leads, for choosing who a deal or quote is with. */
export async function listContacts(b: string): Promise<Contact[]> {
  const [c, l] = await Promise.all([searchCustomers(b, { q: '', category: '', page: 0, pageSize: 500 }), searchLeads(b, { q: '', status: '', page: 0, pageSize: 500 })])
  return [
    ...c.rows.map((x): Contact => ({ kind: 'customer', id: x.id, name: x.name })),
    ...l.rows.filter((x) => x.status !== 'converted').map((x): Contact => ({ kind: 'lead', id: x.id, name: x.name })),
  ].sort((a, z) => a.name.localeCompare(z.name))
}

async function names(b: string, rows: { customerId: string | null; leadId: string | null }[]): Promise<(r: { customerId: string | null; leadId: string | null }) => string> {
  const cust = [...new Set(rows.map((x) => x.customerId).filter(Boolean))] as string[]
  const lead = [...new Set(rows.map((x) => x.leadId).filter(Boolean))] as string[]
  const [cs, ls] = await Promise.all([
    cust.length ? db().from('customers').select('id, name').eq('business_id', b).in('id', cust) : { data: [] },
    lead.length ? db().from('crm_leads').select('id, name').eq('business_id', b).in('id', lead) : { data: [] },
  ])
  const map = new Map<string, string>([...(cs.data ?? []), ...(ls.data ?? [])].map((x) => [String(x.id), String(x.name)]))
  return (r) => map.get(r.customerId ?? r.leadId ?? '') ?? ''
}

const dealFrom = (r: Record<string, unknown>, contact: string): DealRow => ({ id: String(r.id), title: String(r.title), customerId: (r.customer_id as string | null) ?? null, leadId: (r.lead_id as string | null) ?? null, contact, value: n(r.value), stage: r.stage as DealStage, expectedClose: day(r.expected_close), notes: String(r.notes ?? ''), lostReason: (r.lost_reason as string | null) ?? null, closedAt: (r.closed_at as string | null) ?? null, createdAt: String(r.created_at) })

export async function listDeals(b: string): Promise<DealRow[]> {
  if (isDemoMode) { demo.ensureDemoCrm(b); return demo.demoDeals(b).map((d) => ({ ...d, contact: demo.demoContactName(b, d.customerId, d.leadId) })).sort((a, z) => z.createdAt.localeCompare(a.createdAt)) }
  const r = await db().from('crm_deals').select('*').eq('business_id', b).order('created_at', { ascending: false }).limit(1000)
  if (r.error) throw new Error(r.error.message)
  const rows = (r.data ?? []).map((x) => ({ customerId: (x.customer_id as string | null) ?? null, leadId: (x.lead_id as string | null) ?? null }))
  const name = await names(b, rows)
  return (r.data ?? []).map((x, i) => dealFrom(x, name(rows[i])))
}

export async function saveDeal(b: string, d: DealInput) {
  if (isDemoMode) return demo.demoSaveDeal(b, d)
  return err((await db().rpc('crm_save_deal', { p_business: b, p_id: d.id, p_title: d.title, p_customer: d.customerId, p_lead: d.leadId, p_value: d.value, p_expected: d.expectedClose, p_owner: null, p_notes: d.notes })).error)
}

export async function moveDeal(b: string, id: string, stage: DealStage, reason = '') {
  if (isDemoMode) return demo.demoMoveDeal(b, id, stage, reason)
  return err((await db().rpc('crm_move_deal', { p_deal: id, p_stage: stage, p_reason: reason })).error)
}

export async function dealEvents(b: string, id: string): Promise<DealEvent[]> {
  if (isDemoMode) return demo.demoDealEvents(b, id).map((e) => ({ from: e.from, to: e.to, note: e.note, at: e.at }))
  const r = await db().from('crm_deal_events').select('from_stage, to_stage, note, at').eq('business_id', b).eq('deal_id', id).order('at')
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []).map((x) => ({ from: (x.from_stage as DealStage | null) ?? null, to: x.to_stage as DealStage, note: (x.note as string | null) ?? null, at: String(x.at) }))
}

const quoteFrom = (r: Record<string, unknown>, contact: string): QuoteRow => ({
  id: String(r.id), number: String(r.number), dealId: (r.deal_id as string | null) ?? null, customerId: (r.customer_id as string | null) ?? null, leadId: (r.lead_id as string | null) ?? null, contact,
  issuedOn: String(r.issued_on).slice(0, 10), validUntil: day(r.valid_until), status: r.status as QuoteStatus, discount: n(r.discount), subtotal: n(r.subtotal), total: n(r.total), notes: String(r.notes ?? ''),
  lines: (r.lines as { description: string; quantity: number; unit_price: number }[]).map((l) => ({ description: l.description, quantity: n(l.quantity), unitPrice: n(l.unit_price) })),
})

export async function listQuotes(b: string): Promise<QuoteRow[]> {
  if (isDemoMode) { demo.ensureDemoCrm(b); return demo.demoQuotes(b).map((q) => ({ ...q, contact: demo.demoContactName(b, q.customerId, q.leadId) || (q.dealId ? demo.demoContactName(b, demo.demoDeals(b).find((d) => d.id === q.dealId)?.customerId ?? null, demo.demoDeals(b).find((d) => d.id === q.dealId)?.leadId ?? null) : '') })).sort((a, z) => z.number.localeCompare(a.number)) }
  const r = await db().from('crm_quotes').select('*').eq('business_id', b).order('number', { ascending: false }).limit(500)
  if (r.error) throw new Error(r.error.message)
  const deals = (r.data ?? []).filter((x) => x.deal_id && !x.customer_id && !x.lead_id).map((x) => x.deal_id as string)
  const dealContacts = deals.length ? await db().from('crm_deals').select('id, customer_id, lead_id').eq('business_id', b).in('id', deals) : { data: [] }
  const viaDeal = new Map((dealContacts.data ?? []).map((d) => [String(d.id), { customerId: (d.customer_id as string | null) ?? null, leadId: (d.lead_id as string | null) ?? null }]))
  const refs = (r.data ?? []).map((x) => (x.customer_id || x.lead_id ? { customerId: (x.customer_id as string | null) ?? null, leadId: (x.lead_id as string | null) ?? null } : viaDeal.get(x.deal_id as string) ?? { customerId: null, leadId: null }))
  const name = await names(b, refs)
  return (r.data ?? []).map((x, i) => quoteFrom(x, name(refs[i])))
}

export async function saveQuote(b: string, q: QuoteInput) {
  if (isDemoMode) return demo.demoSaveQuote(b, q)
  return err((await db().rpc('crm_save_quote', { p_business: b, p_id: q.id, p_deal: q.dealId, p_customer: q.customerId, p_lead: q.leadId, p_valid: q.validUntil, p_lines: q.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unitPrice })), p_discount: q.discount, p_notes: q.notes })).error)
}

export async function setQuoteStatus(b: string, id: string, status: 'sent' | 'accepted' | 'declined') {
  if (isDemoMode) return demo.demoSetQuoteStatus(b, id, status)
  return err((await db().rpc('crm_set_quote_status', { p_quote: id, p_status: status })).error)
}

export async function crmReport(b: string): Promise<CrmReport> {
  if (isDemoMode) { demo.ensureDemoCrm(b); return demo.demoCrmReport(b) }
  const { data, error } = await db().rpc('crm_report', { p_business: b })
  if (error) throw new Error(error.message)
  const x = data as { stages: { stage: DealStage; deals: number; value: number }[]; open_value: number; open_deals: number; won_this_month: number; won_deals_this_month: number; win_rate: number | null; leads: Record<string, number>; overdue_tasks: number; due_today: number; lost_reasons: { reason: string; deals: number }[] }
  return { stages: x.stages.map((s) => ({ stage: s.stage, deals: n(s.deals), value: n(s.value) })), openValue: n(x.open_value), openDeals: n(x.open_deals), wonThisMonth: n(x.won_this_month), wonDealsThisMonth: n(x.won_deals_this_month), winRate: x.win_rate === null ? null : n(x.win_rate), leads: x.leads, overdueTasks: n(x.overdue_tasks), dueToday: n(x.due_today), lostReasons: x.lost_reasons.map((l) => ({ reason: l.reason, deals: n(l.deals) })) }
}
