import { STANDALONE_APPS, appsOn } from '@/core/app-catalogue/apps'
import { getCalendar } from '@/demo/demoCalendar'
import { PLANS, PLAN_PRICES } from '@/core/subscriptions/plans'
import { getCrm } from '@/demo/demoCrm'
import { getFinance } from '@/demo/demoFinance'
import { getInv } from '@/demo/demoInventory'
import { getInvoices } from '@/demo/demoInvoices'
import { getTrade } from '@/demo/demoTrade'
import { demoPlatformPatchBusiness, demoPlatformPatchMembers, demoPlatformRemoveBusiness, demoPlatformRemoveUsers, demoPlatformSetPlan, demoPlatformSetSuspended, getDemoState } from '@/demo/demoStore'
import type { DemoBusiness } from '@/demo/demoStore'
import type { PlanCode } from '@/shared/types/domain'

/**
 * Browser-only platform console data for demo mode. Mirrors supabase/migrations/20261021000021_platform_admin.sql: the same three roles
 * (owner, engineer, support), a reason for every change, an append-only action log, and at least one owner at all times.
 */
export type PlatformRole = 'owner' | 'engineer' | 'support'
export type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
export type BusinessState = 'active' | 'suspended' | 'archived'

export interface PBusinessRow { id: string; name: string; industry: string; status: BusinessState; createdAt: string; ownerName: string | null; ownerEmail: string | null; members: number; planCode: string | null; planName: string | null; subscriptionStatus: SubStatus | null; trialEnd: string | null; periodEnd: string | null; startedWithApp: string | null; apps: string[] }
export interface PAppActivity { records: number; lastAt: string | null }
export interface PAppEvent { at: string; module: string; action: 'start' | 'on' | 'off'; by: string | null }
export interface PAppAdoption { app: string; workspaces: number; started: number; grew: number; active30d: number }
export interface POverview {
  businesses: number; suspended: number; archived: number; newThisMonth: number; paid: number; trial: number; pastDue: number; mrr: number; users: number; platformTeam: number; activeToday: number | null
  byIndustry: { industry: string; businesses: number }[]; trialsEnding: { id: string; name: string; trialEnd: string }[]; recent: { id: string; name: string; industry: string; createdAt: string; status: BusinessState }[]
}
export interface PBusinessDetail {
  id: string; name: string; legalName: string | null; industry: string; status: BusinessState; createdAt: string; country: string; currency: string; timezone: string
  owner: { id: string; name: string; email: string } | null
  subscription: { planCode: string; planName: string; status: SubStatus; trialEnd: string | null; periodEnd: string | null; price: number } | null
  members: { userId: string | null; name: string; email: string; role: string; status: string; joinedAt: string | null }[]
  modules: string[]; activity: { at: string; action: string; entity: string }[]; platformActions: { at: string; action: string; by: string | null; reason: string | null }[]
  startedWithApp: string | null; apps: string[]; appActivity: Record<string, PAppActivity>; appEvents: PAppEvent[]
}
export interface PUserRow { id: string; name: string; email: string; createdAt: string | null; lastSignIn: string | null; platformRole: PlatformRole | null; businesses: { businessId: string; business: string; role: string; status: string; joinedAt: string | null; isOwner: boolean; businessStatus: BusinessState }[] }
export interface PPlan { code: string; name: string; price: number; currency: string; interval: string; maxMembers: number; maxBranches: number; businesses: number }
export interface PAuditRow { id: string; at: string; action: string; by: string | null; businessId: string | null; business: string | null; reason: string | null }
export interface PHealth { checkedAt: string; checks: { name: string; ok: boolean; detail: string }[]; businessChanges24h: number; platformActions24h: number }
export interface PUsage { databaseBytes: number; databaseCapBytes: number; storageBytes: number; storageCapBytes: number; businesses: number; users: number; auditEvents: number }
export interface PAdmin { userId: string; name: string; email: string; role: PlatformRole; since: string }

interface Sub { status: SubStatus; trialEnd: string | null; periodEnd: string; plan?: PlanCode }
interface Platform { admins: { userId: string; role: PlatformRole; since: string }[]; subs: Record<string, Sub>; audit: (PAuditRow & { detail?: unknown })[]; details: Record<string, { legalName: string | null; timezone: string }> }

const KEY = 'doa.demo.platform.v1'
const DAY = 86400000
const iso = (ms: number) => new Date(ms).toISOString()
const seed = (): Platform => ({
  admins: [{ userId: 'u-platform', role: 'owner', since: iso(Date.now() - 200 * DAY) }, { userId: 'u-engineer', role: 'engineer', since: iso(Date.now() - 90 * DAY) }, { userId: 'u-support', role: 'support', since: iso(Date.now() - 30 * DAY) }],
  subs: {}, audit: [], details: {},
})
function load(): Platform { try { const raw = localStorage.getItem(KEY); if (raw) return { ...seed(), ...(JSON.parse(raw) as Platform) } } catch { /* fresh */ } return seed() }
let state = load()
const commit = (next: Platform) => { state = next; try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ } }
export const resetDemoPlatform = () => commit(seed())

/** The demo businesses that start out paying; every other business starts on a 14 day trial from its creation date. */
const PAYING = new Set(['b-farm', 'b-pharmacy'])
const created = (b: DemoBusiness) => b.createdAt ?? iso(Date.now() - 30 * DAY)
function subOf(b: DemoBusiness): Sub {
  const own = state.subs[b.id]; if (own) return own
  const at = new Date(created(b)).getTime()
  return PAYING.has(b.id) ? { status: 'active', trialEnd: null, periodEnd: iso(Date.now() + 20 * DAY) } : { status: 'trialing', trialEnd: iso(at + 14 * DAY), periodEnd: iso(at + 14 * DAY) }
}
const planOf = (b: DemoBusiness): PlanCode => getDemoState().modules[b.id]?.plan ?? 'starter'
const statusOf = (b: DemoBusiness): BusinessState => (b.archived ? 'archived' : b.suspended ? 'suspended' : 'active')

const me = () => getDemoState().userId
const myEmail = () => getDemoState().users.find((u) => u.id === me())?.email ?? null
export const demoPlatformRole = (): PlatformRole | null => state.admins.find((a) => a.userId === me())?.role ?? null
function need(level: 'read' | 'write' | 'owner'): PlatformRole {
  const r = demoPlatformRole()
  if (!r || (level === 'write' && r === 'support') || (level === 'owner' && r !== 'owner')) throw new Error('permission denied')
  return r
}
const reason = (text: string) => { if (text.trim().length < 3) throw new Error('say why (it is kept in the audit log)') }
const log = (s: Platform, action: string, businessId: string | null, why: string | null, detail?: unknown) =>
  s.audit.unshift({ id: `pa-${Date.now().toString(36)}-${s.audit.length}`, at: new Date().toISOString(), action, by: myEmail(), businessId, business: businessId ? getDemoState().businesses.find((b) => b.id === businessId)?.name ?? null : null, reason: why?.trim() || null, detail })
const ownerOf = (id: string) => { const m = getDemoState().members.find((x) => x.businessId === id && x.role === 'owner' && x.status === 'active'); return m ? { id: m.userId ?? '', name: m.name, email: m.email } : null }
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function run(fn: (s: Platform) => void): string | null {
  const next = clone(state)
  try { fn(next); commit(next); return null } catch (e) { return (e as Error).message }
}

// ---------------------------------------------------------------------- reads
export function demoPlatformOverview(): POverview {
  need('read')
  const st = getDemoState(); const all = st.businesses
  const live = all.filter((b) => !b.archived); const active = live.filter((b) => !b.suspended)
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const trialsEnding = active.filter((b) => { const s = subOf(b); return s.status === 'trialing' && s.trialEnd && new Date(s.trialEnd).getTime() <= Date.now() + 7 * DAY }).map((b) => ({ id: b.id, name: b.name, trialEnd: subOf(b).trialEnd! })).sort((a, b) => a.trialEnd.localeCompare(b.trialEnd))
  const by = new Map<string, number>(); for (const b of live) by.set(b.industry, (by.get(b.industry) ?? 0) + 1)
  return {
    businesses: live.length, suspended: live.filter((b) => b.suspended).length, archived: all.length - live.length,
    newThisMonth: live.filter((b) => new Date(created(b)) >= monthStart).length,
    paid: active.filter((b) => subOf(b).status === 'active').length, trial: active.filter((b) => subOf(b).status === 'trialing').length, pastDue: active.filter((b) => subOf(b).status === 'past_due').length,
    mrr: active.filter((b) => subOf(b).status === 'active').reduce((a, b) => a + PLAN_PRICES[planOf(b)], 0),
    users: st.users.length, platformTeam: state.admins.length, activeToday: null,
    byIndustry: [...by].map(([industry, businesses]) => ({ industry, businesses })).sort((a, b) => b.businesses - a.businesses), trialsEnding,
    recent: [...all].sort((a, b) => created(b).localeCompare(created(a))).slice(0, 6).map((b) => ({ id: b.id, name: b.name, industry: b.industry, createdAt: created(b), status: statusOf(b) })),
  }
}
function rowOf(b: DemoBusiness): PBusinessRow {
  const st = getDemoState(); const s = subOf(b); const o = ownerOf(b.id)
  return { id: b.id, name: b.name, industry: b.industry, status: statusOf(b), createdAt: created(b), ownerName: o?.name ?? null, ownerEmail: o?.email ?? null, members: st.members.filter((m) => m.businessId === b.id && m.status === 'active').length,
    planCode: planOf(b), planName: PLANS[planOf(b)].name, subscriptionStatus: s.status, trialEnd: s.trialEnd, periodEnd: s.periodEnd, startedWithApp: b.startedWithApp ?? null, apps: appsOn(getDemoState().modules[b.id]?.enabled ?? []) }
}

/** How much each app has really been used in a business: records and the time of the latest one (the database twin is _app_activity()). */
function activityOf(id: string): Record<string, PAppActivity> {
  const t = getTrade(); const crm = getCrm(); const inv = getInvoices(); const fin = getFinance(); const stock = getInv()
  const sum = (rows: { at: string | undefined }[]): PAppActivity => ({ records: rows.length, lastAt: rows.map((r) => r.at).filter((x): x is string => !!x).sort().at(-1) ?? null })
  const mine = <T extends { businessId: string }>(xs: T[]) => xs.filter((x) => x.businessId === id)
  return {
    crm: sum([...mine(t.customers).map((c) => ({ at: c.createdAt })), ...mine(crm.leads).map((l) => ({ at: l.createdAt })), ...mine(crm.deals).map((d) => ({ at: d.createdAt })), ...mine(crm.quotes).map((q) => ({ at: q.createdAt }))]),
    pos: sum(mine(t.sales).map((s) => ({ at: s.soldAt }))), inventory: sum(mine(stock.movements).map((m) => ({ at: m.at }))),
    invoices: sum(mine(inv.invoices).map((i) => ({ at: i.createdAt }))), expenses: sum(mine(fin.expenses).map((e) => ({ at: e.createdAt ?? `${e.date}T00:00:00.000Z` }))),
    finance: { records: 0, lastAt: null },
    calendar: sum(mine(getCalendar().events).map((e) => ({ at: e.createdAt }))),
  }
}

/** Per app, across Business apps workspaces: using it now, started with it, started with it and later added another, used in the last 30 days. */
export function demoPlatformAppAdoption(): PAppAdoption[] {
  need('read')
  const ws = getDemoState().businesses.filter((b) => b.industry === 'general' && !b.archived).map((b) => ({ b, apps: appsOn(getDemoState().modules[b.id]?.enabled ?? []), act: activityOf(b.id) }))
  const cutoff = new Date(Date.now() - 30 * DAY).toISOString()
  return STANDALONE_APPS.map((a) => ({
    app: a.id, workspaces: ws.filter((w) => w.apps.includes(a.id)).length, started: ws.filter((w) => w.b.startedWithApp === a.id).length,
    grew: ws.filter((w) => w.b.startedWithApp === a.id && w.apps.length > 1).length,
    active30d: ws.filter((w) => w.apps.includes(a.id) && (w.act[a.id].lastAt ?? '') >= cutoff).length,
  }))
}
export function demoPlatformBusinesses(search = ''): PBusinessRow[] {
  need('read'); const q = search.trim().toLowerCase()
  return getDemoState().businesses.map(rowOf).filter((b) => !q || (b.name + (b.ownerEmail ?? '') + (b.ownerName ?? '')).toLowerCase().includes(q)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export function demoPlatformBusiness(id: string): PBusinessDetail {
  need('read')
  const st = getDemoState(); const b = st.businesses.find((x) => x.id === id); if (!b) throw new Error('business not found')
  const s = subOf(b)
  return {
    id: b.id, name: b.name, legalName: state.details[id]?.legalName ?? null, industry: b.industry, status: statusOf(b), createdAt: created(b), country: 'NG', currency: 'NGN', timezone: state.details[id]?.timezone ?? 'Africa/Lagos', owner: ownerOf(id),
    subscription: { planCode: planOf(b), planName: PLANS[planOf(b)].name, status: s.status, trialEnd: s.trialEnd, periodEnd: s.periodEnd, price: PLAN_PRICES[planOf(b)] },
    members: st.members.filter((m) => m.businessId === id).map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, status: m.status, joinedAt: null })),
    modules: [...(st.modules[id]?.enabled ?? [])].sort(), activity: [],
    platformActions: state.audit.filter((a) => a.businessId === id).slice(0, 20).map((a) => ({ at: a.at, action: a.action, by: a.by, reason: a.reason })),
    startedWithApp: b.startedWithApp ?? null, apps: appsOn(st.modules[id]?.enabled ?? []), appActivity: activityOf(id),
    // The first minute of setup is noise, except the "start" entries that say which app it began with.
    appEvents: (st.appEvents ?? []).filter((e) => e.businessId === id && (e.action === 'start' || new Date(e.at).getTime() > new Date(created(b)).getTime() + 60000)).reverse().sort((x, y) => y.at.localeCompare(x.at)).slice(0, 60).map((e) => ({ at: e.at, module: e.module, action: e.action, by: e.by })),
  }
}
export function demoPlatformUsers(search = ''): PUserRow[] {
  need('read'); const q = search.trim().toLowerCase(); const st = getDemoState()
  return st.users.map((u): PUserRow => ({
    id: u.id, name: u.name, email: u.email, createdAt: null, lastSignIn: null, platformRole: state.admins.find((a) => a.userId === u.id)?.role ?? null,
    businesses: st.members.filter((m) => m.userId === u.id).map((m) => {
      const b = st.businesses.find((x) => x.id === m.businessId)
      return { businessId: m.businessId, business: b?.name ?? '', role: m.role, status: m.status, joinedAt: null, isOwner: m.role === 'owner', businessStatus: (b?.archived ? 'archived' : b?.suspended ? 'suspended' : 'active') as BusinessState }
    }).sort((a, b) => a.business.localeCompare(b.business)),
  })).filter((u) => !q || (u.name + u.email).toLowerCase().includes(q))
}
export function demoPlatformUser(id: string): PUserRow {
  const u = demoPlatformUsers().find((x) => x.id === id); if (!u) throw new Error('user not found')
  return u
}
export function demoPlatformPlans(): PPlan[] {
  need('read'); const st = getDemoState()
  return (Object.keys(PLANS) as PlanCode[]).map((code) => ({
    code, name: PLANS[code].name, price: PLAN_PRICES[code], currency: 'NGN', interval: 'month', maxMembers: PLANS[code].limits.maxMembers, maxBranches: PLANS[code].limits.maxBranches,
    businesses: st.businesses.filter((b) => !b.archived && planOf(b) === code).length,
  }))
}
export function demoPlatformAudit(): PAuditRow[] { need('read'); return state.audit.map((a) => ({ id: a.id, at: a.at, action: a.action, by: a.by, businessId: a.businessId, business: a.business, reason: a.reason })) }
export function demoPlatformHealth(): PHealth {
  need('read'); const st = getDemoState(); const live = st.businesses.filter((b) => !b.archived)
  const expired = live.filter((b) => { const s = subOf(b); return !b.suspended && s.status === 'trialing' && s.trialEnd && new Date(s.trialEnd).getTime() < Date.now() }).length
  const pastDue = live.filter((b) => subOf(b).status === 'past_due').length
  const day = Date.now() - DAY
  return {
    checkedAt: new Date().toISOString(), businessChanges24h: 0, platformActions24h: state.audit.filter((a) => new Date(a.at).getTime() >= day).length,
    checks: [
      { name: 'Database', ok: true, detail: 'Answering queries' },
      { name: 'Businesses without a subscription', ok: true, detail: '0 found' },
      { name: 'Trials that ran out but are still marked as trials', ok: expired === 0, detail: `${expired} found` },
      { name: 'Subscriptions past due', ok: pastDue === 0, detail: `${pastDue} found` },
      { name: 'Suspended businesses', ok: true, detail: `${live.filter((b) => b.suspended).length} suspended` },
      { name: 'Invitations waiting to be accepted', ok: true, detail: `${st.members.filter((m) => m.status === 'invited').length} waiting` },
    ],
  }
}
export function demoPlatformAdmins(): PAdmin[] {
  need('read'); const st = getDemoState()
  return state.admins.map((a) => { const u = st.users.find((x) => x.id === a.userId); return { userId: a.userId, name: u?.name ?? '', email: u?.email ?? '', role: a.role, since: a.since } })
}

// ------------------------------------------------------------------- changes
export function demoPlatformSetSubscription(businessId: string, v: { plan: PlanCode | null; status: SubStatus | null; extendDays: number | null; reason: string }): string | null {
  return run((s) => {
    need('write'); reason(v.reason)
    const b = getDemoState().businesses.find((x) => x.id === businessId && !x.archived); if (!b) throw new Error('business not found')
    if (v.status && !['trialing', 'active', 'past_due', 'canceled', 'expired'].includes(v.status)) throw new Error('choose a subscription status')
    if (v.extendDays !== null && (v.extendDays < 1 || v.extendDays > 366)) throw new Error('extend by 1 to 366 days')
    if (v.plan && !(v.plan in PLANS)) throw new Error('unknown plan')
    const before = subOf(b); const next: Sub = { ...before }
    if (v.status) next.status = v.status
    if (v.extendDays !== null) {
      next.periodEnd = iso(Math.max(new Date(next.periodEnd).getTime(), Date.now()) + v.extendDays * DAY)
      if (next.status === 'trialing') next.trialEnd = iso(Math.max(new Date(next.trialEnd ?? Date.now()).getTime(), Date.now()) + v.extendDays * DAY)
    } else if (v.status === 'active' && new Date(next.periodEnd).getTime() < Date.now()) next.periodEnd = iso(Date.now() + 30 * DAY)
    s.subs[businessId] = next
    log(s, 'subscription.update', businessId, v.reason, { before, plan: v.plan, status: v.status, extendDays: v.extendDays })
    if (v.plan) demoPlatformSetPlan(businessId, v.plan)
  })
}
export function demoPlatformSetBusinessStatus(businessId: string, status: 'active' | 'suspended', why: string): string | null {
  return run((s) => {
    need('write'); reason(why)
    if (status !== 'active' && status !== 'suspended') throw new Error('choose active or suspended')
    const b = getDemoState().businesses.find((x) => x.id === businessId && !x.archived); if (!b) throw new Error('business not found')
    if (statusOf(b) === status) return
    log(s, status === 'suspended' ? 'business.suspend' : 'business.reactivate', businessId, why, { from: statusOf(b), to: status })
    demoPlatformSetSuspended(businessId, status === 'suspended')
  })
}
export function demoPlatformAddAdmin(email: string, role: PlatformRole): string | null {
  return run((s) => {
    need('owner')
    if (!['owner', 'engineer', 'support'].includes(role)) throw new Error('choose owner, engineer or support')
    const u = getDemoState().users.find((x) => x.email === email.trim().toLowerCase()); if (!u) throw new Error('no account has that email; they must sign up first')
    const ex = s.admins.find((a) => a.userId === u.id)
    if (ex?.role === 'owner' && role !== 'owner' && s.admins.filter((a) => a.role === 'owner').length === 1) throw new Error('there must always be at least one platform owner')
    if (ex) ex.role = role; else s.admins.push({ userId: u.id, role, since: new Date().toISOString() })
    log(s, 'team.set', null, null, { email: u.email, role })
  })
}
export function demoPlatformRemoveAdmin(userId: string): string | null {
  return run((s) => {
    need('owner')
    const a = s.admins.find((x) => x.userId === userId); if (!a) throw new Error('that person is not on the platform team')
    if (a.role === 'owner' && s.admins.filter((x) => x.role === 'owner').length === 1) throw new Error('there must always be at least one platform owner')
    s.admins = s.admins.filter((x) => x.userId !== userId)
    log(s, 'team.remove', null, null, { userId, role: a.role })
  })
}

/** Permanent deletion: the business and everything in it are gone, only the platform's own log remains. Demo data of other apps for that business is left behind in the browser. */
export function demoPlatformPurgeBusiness(businessId: string, confirmName: string, why: string): string | null {
  return run((s) => {
    need('owner'); reason(why)
    const b = getDemoState().businesses.find((x) => x.id === businessId); if (!b) throw new Error('business not found')
    if (confirmName.trim() !== b.name) throw new Error('type the business name exactly to confirm')
    // The people who belonged only to this business lose their accounts too; anyone elsewhere, on the platform team, or doing this keeps theirs.
    const st = getDemoState()
    const here = [...new Set(st.members.filter((m) => m.businessId === businessId && m.userId).map((m) => m.userId!))]
    const doomed = here.filter((u) => u !== getDemoState().userId && !s.admins.some((a) => a.userId === u) && !st.members.some((m) => m.userId === u && m.businessId !== businessId))
    log(s, 'business.purge', businessId, why, { name: b.name, accounts_deleted: doomed.length, accounts_kept: here.length - doomed.length })
    s.audit[0].business = b.name
    delete s.subs[businessId]; delete s.details[businessId]
    demoPlatformRemoveBusiness(businessId)
    demoPlatformRemoveUsers(doomed)
  })
}
/** Mirrors platform_delete_user(): platform owner only, type the email, never yourself, the platform team, or someone who still owns a business. */
export function demoPlatformDeleteUser(userId: string, confirmEmail: string, why: string): string | null {
  return run((s) => {
    need('owner'); reason(why)
    const st = getDemoState(); const u = st.users.find((x) => x.id === userId); if (!u) throw new Error('user not found')
    if (userId === st.userId) throw new Error('you cannot delete your own account')
    if (confirmEmail.trim().toLowerCase() !== u.email.toLowerCase()) throw new Error('type the email address exactly to confirm')
    if (s.admins.some((a) => a.userId === userId)) throw new Error('this person is on the platform team; remove them from the team first')
    const owned = st.members.filter((m) => m.userId === userId && m.role === 'owner').map((m) => st.businesses.find((b) => b.id === m.businessId)?.name).filter(Boolean)
    if (owned.length) throw new Error(`this person owns ${owned.join(', ')}. Transfer the ownership or delete the business first`)
    log(s, 'user.delete', null, why, { email: u.email, name: u.name, memberships_removed: st.members.filter((m) => m.userId === userId).length })
    demoPlatformRemoveUsers([userId])
  })
}
export function demoPlatformUpdateBusiness(businessId: string, v: { name: string; legalName: string; timezone: string; reason: string }): string | null {
  return run((s) => {
    need('write'); reason(v.reason)
    const b = getDemoState().businesses.find((x) => x.id === businessId && !x.archived); if (!b) throw new Error('business not found')
    const name = v.name.trim(); if (name.length < 1 || name.length > 120) throw new Error('enter the business name (up to 120 characters)')
    if (!v.timezone.trim() || !(Intl.supportedValuesOf('timeZone').includes(v.timezone.trim()) || v.timezone.trim() === 'Africa/Lagos')) throw new Error('unknown time zone')
    log(s, 'business.update', businessId, v.reason, { before: { name: b.name, ...s.details[businessId] }, after: { name, legalName: v.legalName.trim() || null, timezone: v.timezone.trim() } })
    s.details[businessId] = { legalName: v.legalName.trim() || null, timezone: v.timezone.trim() }
    demoPlatformPatchBusiness(businessId, { name })
  })
}
export function demoPlatformTransferOwnership(businessId: string, email: string, why: string): string | null {
  return run((s) => {
    need('owner'); reason(why)
    const st = getDemoState(); const b = st.businesses.find((x) => x.id === businessId && !x.archived); if (!b) throw new Error('business not found')
    const target = st.members.find((m) => m.businessId === businessId && m.status === 'active' && m.email.toLowerCase() === email.trim().toLowerCase())
    if (!target) throw new Error('that person is not an active member of this business; invite them first')
    const current = st.members.find((m) => m.businessId === businessId && m.role === 'owner' && m.status === 'active')
    if (current?.id === target.id) throw new Error('that person already owns this business')
    log(s, 'business.transfer_ownership', businessId, why, { from: current?.email, to: target.email })
    demoPlatformPatchMembers(businessId, (m) => (m.id === target.id ? { ...m, role: 'owner' } : m.id === current?.id ? { ...m, role: 'business_admin' } : m))
  })
}
export function demoPlatformSetMemberStatus(businessId: string, userId: string, status: 'active' | 'suspended' | 'revoked', why: string): string | null {
  return run((s) => {
    need('write'); reason(why)
    if (!['active', 'suspended', 'revoked'].includes(status)) throw new Error('choose active, suspended or revoked')
    const st = getDemoState(); const b = st.businesses.find((x) => x.id === businessId && !x.archived); if (!b) throw new Error('business not found')
    const m = st.members.find((x) => x.businessId === businessId && x.userId === userId); if (!m) throw new Error('that person is not a member of this business')
    if (status !== 'active' && m.role === 'owner' && m.status === 'active') throw new Error('this person owns the business; transfer ownership before stopping their access')
    if (m.status === status) return
    log(s, 'member.' + status, businessId, why, { userId, from: m.status, to: status })
    demoPlatformPatchMembers(businessId, (x) => (x.id === m.id ? { ...x, status } : x))
  })
}
/** Mirrors platform_remove_user_everywhere(): every membership is revoked except in businesses the person owns; refused when they own them all. */
export function demoPlatformRemoveUserEverywhere(userId: string, why: string): { removed: number; keptOwned: string | null } | string {
  let out: { removed: number; keptOwned: string | null } = { removed: 0, keptOwned: null }
  const err = run((s) => {
    need('write'); reason(why)
    const st = getDemoState(); if (!st.users.some((u) => u.id === userId)) throw new Error('user not found')
    if (userId === st.userId) throw new Error('you cannot remove yourself')
    const live = st.members.filter((m) => m.userId === userId && m.status !== 'revoked' && st.businesses.some((b) => b.id === m.businessId && !b.archived))
    const owned = live.filter((m) => m.role === 'owner').map((m) => st.businesses.find((b) => b.id === m.businessId)!.name).sort().join(', ') || null
    const doomed = live.filter((m) => m.role !== 'owner')
    if (!doomed.length && owned) throw new Error(`this person owns ${owned}. Transfer the ownership before removing them`)
    for (const m of doomed) {
      log(s, 'member.revoked', m.businessId, why, { userId, from: m.status, to: 'revoked', everywhere: true })
      demoPlatformPatchMembers(m.businessId, (x) => (x.id === m.id ? { ...x, status: 'revoked' } : x))
    }
    out = { removed: doomed.length, keptOwned: owned }
  })
  return err ?? out
}
export function demoPlatformArchiveBusiness(businessId: string, why: string): string | null {
  return run((s) => {
    need('owner'); reason(why)
    const b = getDemoState().businesses.find((x) => x.id === businessId && !x.archived); if (!b) throw new Error('business not found')
    log(s, 'business.archive', businessId, why, { name: b.name })
    demoPlatformPatchBusiness(businessId, { archived: true })
  })
}

/** Demo mode keeps its data in this browser, so "database size" is what the demo data takes in browser storage. */
export function demoPlatformUsage(): PUsage {
  need('read')
  let bytes = 0
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('doa.demo')) bytes += (localStorage.getItem(k) ?? '').length * 2 } } catch { /* storage unavailable */ }
  const o = demoPlatformOverview()
  return { databaseBytes: bytes, databaseCapBytes: 500 * 1024 * 1024, storageBytes: 0, storageCapBytes: 1024 * 1024 * 1024, businesses: o.businesses, users: o.users, auditEvents: state.audit.length }
}
