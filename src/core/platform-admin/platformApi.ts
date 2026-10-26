import * as pl from '@/demo/demoPlatform'
import type { PAdmin, PAuditRow, PBusinessDetail, PBusinessRow, PHealth, PPlan, POverview, PUserRow, PlatformRole, SubStatus } from '@/demo/demoPlatform'
import { isDemoMode } from '@/shared/utilities/env'
import { supabase } from '@/shared/utilities/supabase'
import type { PlanCode } from '@/shared/types/domain'

/** Platform console data access. Live mode calls database functions that check the platform team table; demo mode runs the browser mirror. */
export type { PAdmin, PAuditRow, PBusinessDetail, PBusinessRow, PHealth, PPlan, POverview, PUserRow, PlatformRole, SubStatus }
export type { BusinessState } from '@/demo/demoPlatform'

type Row = Record<string, unknown>
const n = (v: unknown) => Number(v ?? 0)
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const rpc = async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await supabase!.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
const msg = async (fn: string, args: Record<string, unknown>) => (await supabase!.rpc(fn, args)).error?.message ?? null

/** The signed-in person's platform role, or null for everyone else. Never throws: a failure means "not a platform admin". */
export async function platformRole(): Promise<PlatformRole | null> {
  if (isDemoMode) return pl.demoPlatformRole()
  const { data } = await supabase!.rpc('platform_role')
  return (data as PlatformRole | null) ?? null
}

export async function loadOverview(): Promise<POverview> {
  if (isDemoMode) return pl.demoPlatformOverview()
  const x = await rpc<Row>('platform_overview')
  return {
    businesses: n(x.businesses), suspended: n(x.suspended), archived: n(x.archived), newThisMonth: n(x.new_this_month), paid: n(x.paid), trial: n(x.trial), pastDue: n(x.past_due), mrr: n(x.mrr), users: n(x.users), platformTeam: n(x.platform_team), activeToday: n(x.active_today),
    byIndustry: ((x.by_industry as Row[]) ?? []).map((r) => ({ industry: String(r.industry), businesses: n(r.businesses) })),
    trialsEnding: ((x.trials_ending as Row[]) ?? []).map((r) => ({ id: String(r.id), name: String(r.name), trialEnd: String(r.trial_end) })),
    recent: ((x.recent as Row[]) ?? []).map((r) => ({ id: String(r.id), name: String(r.name), industry: String(r.industry), createdAt: String(r.created_at), status: r.status as POverview['recent'][number]['status'] })),
  }
}
export async function loadBusinesses(search = ''): Promise<PBusinessRow[]> {
  if (isDemoMode) return pl.demoPlatformBusinesses(search)
  return (await rpc<Row[]>('platform_businesses', { p_search: search.trim() || null })).map((r) => ({
    id: String(r.id), name: String(r.name), industry: String(r.industry), status: r.status as PBusinessRow['status'], createdAt: String(r.created_at), ownerName: s(r.owner_name), ownerEmail: s(r.owner_email), members: n(r.members),
    planCode: s(r.plan_code), planName: s(r.plan_name), subscriptionStatus: s(r.subscription_status) as SubStatus | null, trialEnd: s(r.trial_end), periodEnd: s(r.current_period_end),
  }))
}
export async function loadBusiness(id: string): Promise<PBusinessDetail> {
  if (isDemoMode) return pl.demoPlatformBusiness(id)
  const x = await rpc<Row>('platform_business_detail', { p_business: id })
  const sub = x.subscription as Row | null; const owner = x.owner as Row | null
  return {
    id: String(x.id), name: String(x.name), legalName: s(x.legal_name), industry: String(x.industry), status: x.status as PBusinessDetail['status'], createdAt: String(x.created_at), country: String(x.country), currency: String(x.currency), timezone: String(x.timezone),
    owner: owner ? { id: String(owner.id), name: String(owner.name ?? ''), email: String(owner.email ?? '') } : null,
    subscription: sub ? { planCode: String(sub.plan_code), planName: String(sub.plan_name), status: sub.status as SubStatus, trialEnd: s(sub.trial_end), periodEnd: s(sub.period_end), price: n(sub.price) } : null,
    members: ((x.members as Row[]) ?? []).map((m) => ({ userId: s(m.user_id), name: String(m.name ?? ''), email: String(m.email ?? ''), role: String(m.role), status: String(m.status), joinedAt: s(m.joined_at) })),
    modules: ((x.modules as string[]) ?? []), activity: ((x.activity as Row[]) ?? []).map((a) => ({ at: String(a.at), action: String(a.action), entity: String(a.entity) })),
    platformActions: ((x.platform_actions as Row[]) ?? []).map((a) => ({ at: String(a.at), action: String(a.action), by: s(a.by), reason: s(a.reason) })),
  }
}
export async function loadUsers(search = ''): Promise<PUserRow[]> {
  if (isDemoMode) return pl.demoPlatformUsers(search)
  return (await rpc<Row[]>('platform_users', { p_search: search.trim() || null })).map((r) => ({
    id: String(r.id), name: String(r.name ?? ''), email: String(r.email ?? ''), createdAt: s(r.created_at), lastSignIn: s(r.last_sign_in), platformRole: s(r.platform_role) as PlatformRole | null,
    businesses: ((r.businesses as Row[]) ?? []).map((b) => ({ businessId: String(b.business_id), business: String(b.business), role: String(b.role), status: String(b.status) })),
  }))
}
export async function loadPlans(): Promise<PPlan[]> {
  if (isDemoMode) return pl.demoPlatformPlans()
  return (await rpc<Row[]>('platform_plans')).map((r) => ({ code: String(r.code), name: String(r.name), price: n(r.price), currency: String(r.currency), interval: String(r.interval), maxMembers: n((r.limits as Row)?.max_members), maxBranches: n((r.limits as Row)?.max_branches), businesses: n(r.businesses) }))
}
export async function loadAudit(): Promise<PAuditRow[]> {
  if (isDemoMode) return pl.demoPlatformAudit()
  return (await rpc<Row[]>('platform_audit', { p_limit: 200 })).map((r) => ({ id: String(r.id), at: String(r.at), action: String(r.action), by: s(r.by), businessId: s(r.business_id), business: s(r.business), reason: s(r.reason) }))
}
export async function loadHealth(): Promise<PHealth> {
  if (isDemoMode) return pl.demoPlatformHealth()
  const x = await rpc<Row>('platform_health'); const a = (x.activity as Row) ?? {}
  return { checkedAt: String(x.checked_at), checks: ((x.checks as Row[]) ?? []).map((c) => ({ name: String(c.name), ok: !!c.ok, detail: String(c.detail) })), businessChanges24h: n(a.business_changes_24h), platformActions24h: n(a.platform_actions_24h) }
}
export async function loadTeam(): Promise<PAdmin[]> {
  if (isDemoMode) return pl.demoPlatformAdmins()
  return (await rpc<Row[]>('platform_admins_list')).map((r) => ({ userId: String(r.user_id), name: String(r.name ?? ''), email: String(r.email ?? ''), role: r.role as PlatformRole, since: String(r.since) }))
}

// Changes return an error message, or null when it worked.
export async function setSubscription(businessId: string, v: { plan: PlanCode | null; status: SubStatus | null; extendDays: number | null; reason: string }): Promise<string | null> {
  if (isDemoMode) return pl.demoPlatformSetSubscription(businessId, v)
  return msg('platform_set_subscription', { p_business: businessId, p_plan: v.plan, p_status: v.status, p_extend_days: v.extendDays, p_reason: v.reason })
}
export async function setBusinessStatus(businessId: string, status: 'active' | 'suspended', reason: string): Promise<string | null> {
  if (isDemoMode) return pl.demoPlatformSetBusinessStatus(businessId, status, reason)
  return msg('platform_set_business_status', { p_business: businessId, p_status: status, p_reason: reason })
}
export async function addAdmin(email: string, role: PlatformRole): Promise<string | null> {
  if (isDemoMode) return pl.demoPlatformAddAdmin(email, role)
  return msg('platform_add_admin', { p_email: email, p_role: role })
}
export async function removeAdmin(userId: string): Promise<string | null> {
  if (isDemoMode) return pl.demoPlatformRemoveAdmin(userId)
  return msg('platform_remove_admin', { p_user: userId })
}

export async function updateBusiness(businessId: string, v: { name: string; legalName: string; timezone: string; reason: string }): Promise<string | null> {
  if (isDemoMode) return pl.demoPlatformUpdateBusiness(businessId, v)
  return msg('platform_update_business', { p_business: businessId, p_name: v.name, p_legal_name: v.legalName, p_timezone: v.timezone, p_reason: v.reason })
}
export async function transferOwnership(businessId: string, email: string, reason: string): Promise<string | null> {
  if (isDemoMode) return pl.demoPlatformTransferOwnership(businessId, email, reason)
  return msg('platform_transfer_ownership', { p_business: businessId, p_email: email, p_reason: reason })
}
export async function setMemberStatus(businessId: string, userId: string, status: 'active' | 'suspended' | 'revoked', reason: string): Promise<string | null> {
  if (isDemoMode) return pl.demoPlatformSetMemberStatus(businessId, userId, status, reason)
  return msg('platform_set_member_status', { p_business: businessId, p_user: userId, p_status: status, p_reason: reason })
}
export async function archiveBusiness(businessId: string, reason: string): Promise<string | null> {
  if (isDemoMode) return pl.demoPlatformArchiveBusiness(businessId, reason)
  return msg('platform_archive_business', { p_business: businessId, p_reason: reason })
}
