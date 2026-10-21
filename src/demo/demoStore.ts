import { useSyncExternalStore } from 'react'
import type { IndustryCode, ModuleCode, PlanCode, RoleName } from '@/shared/types/domain'
import { PLANS } from '@/core/subscriptions/plans'
import { computeModuleStatuses } from '@/core/module-registry/availability'
import { rolePermissions } from '@/core/permissions/roles'
import type { ModuleStatus } from '@/core/module-registry/availability'
import { INDUSTRY_TEMPLATES, compatibleModules, defaultModules } from '@/core/module-registry/registry'

/**
 * Browser-only demo backend. Used ONLY when Supabase is not configured.
 * Passwords are stored in plain text in localStorage: this is not security, just a demo.
 */

export interface DemoUser { id: string; email: string; password: string; name: string }
export interface DemoSettings { tax_rate_percent?: number; setup?: Record<string, string | number | boolean> }
export interface DemoBusiness { id: string; name: string; industry: IndustryCode; settings?: DemoSettings; archived?: boolean }
export interface DemoMember { id: string; businessId: string; userId: string | null; email: string; name: string; role: RoleName; status: 'active' | 'suspended' | 'revoked' | 'invited' }

export interface DemoBusinessModules { plan: PlanCode | null; enabled: ModuleCode[]; disabledHistory: ModuleCode[] }

interface State {
  modules: Record<string, DemoBusinessModules>
  userId: string | null
  users: DemoUser[]
  businesses: DemoBusiness[]
  members: DemoMember[]
}

const KEY = 'doa.demo.v2'

export const DEMO_LOGINS = [
  { email: 'owner@demo.test', password: 'demo1234', note: 'Owner of 3 businesses (farm, bakery, retail)' },
  { email: 'cashier@demo.test', password: 'demo1234', note: 'Cashier at CityMart only' },
]

const seed = (): State => ({
  userId: null,
  modules: {
    'b-farm': { plan: 'growth', enabled: defaultModules('farm'), disabledHistory: [] },
    // Starter on purpose: shows modules locked behind a plan upgrade.
    'b-bakery': { plan: 'starter', enabled: defaultModules('bakery'), disabledHistory: [] },
    'b-retail': { plan: 'growth', enabled: defaultModules('retail'), disabledHistory: [] },
  },
  users: [
    { id: 'u-owner', email: 'owner@demo.test', password: 'demo1234', name: 'Demo Owner' },
    { id: 'u-cashier', email: 'cashier@demo.test', password: 'demo1234', name: 'Demo Cashier' },
    { id: 'u-acct', email: 'accountant@demo.test', password: 'demo1234', name: 'Demo Accountant' },
  ],
  businesses: [
    { id: 'b-farm', name: 'Greenfield Farms', industry: 'farm' },
    { id: 'b-bakery', name: 'Sunrise Bakery', industry: 'bakery' },
    { id: 'b-retail', name: 'CityMart', industry: 'retail' },
  ],
  members: [
    { id: 'm1', businessId: 'b-farm', userId: 'u-owner', email: 'owner@demo.test', name: 'Demo Owner', role: 'owner', status: 'active' },
    { id: 'm2', businessId: 'b-bakery', userId: 'u-owner', email: 'owner@demo.test', name: 'Demo Owner', role: 'owner', status: 'active' },
    { id: 'm3', businessId: 'b-retail', userId: 'u-owner', email: 'owner@demo.test', name: 'Demo Owner', role: 'owner', status: 'active' },
    { id: 'm4', businessId: 'b-retail', userId: 'u-cashier', email: 'cashier@demo.test', name: 'Demo Cashier', role: 'cashier', status: 'active' },
    { id: 'm5', businessId: 'b-bakery', userId: 'u-acct', email: 'accountant@demo.test', name: 'Demo Accountant', role: 'accountant', status: 'active' },
    { id: 'm6', businessId: 'b-retail', userId: 'u-acct', email: 'accountant@demo.test', name: 'Demo Accountant', role: 'accountant', status: 'active' },
  ],
})

/** Mirrors the migrations that switch a new module on for existing businesses of an industry (e.g. farm-products for farms, bakery-waste for bakeries). */
function withNewDefaults(st: State): State {
  const modules = { ...st.modules }
  for (const b of st.businesses) {
    const m = modules[b.id]
    if (m) {
      const missing = defaultModules(b.industry).filter((c) => !m.enabled.includes(c) && !m.disabledHistory.includes(c))
      if (missing.length) modules[b.id] = { ...m, enabled: [...m.enabled, ...missing] }
    }
  }
  return { ...st, modules }
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return withNewDefaults(JSON.parse(raw) as State)
  } catch { /* fall through to seed */ }
  return seed()
}

let state = load()
const listeners = new Set<() => void>()

function commit(next: State) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const getDemoState = () => state
export const useDemoState = () => useSyncExternalStore(subscribe, () => state)

let counter = Date.now()
const uid = (p: string) => `${p}-${(counter++).toString(36)}`

export function demoSignIn(email: string, password: string): string | null {
  const u = state.users.find((x) => x.email === email.toLowerCase() && x.password === password)
  if (!u) return 'Invalid email or password.'
  commit({ ...state, userId: u.id })
  return null
}

export function demoSignUp(name: string, email: string, password: string): string | null {
  const e = email.toLowerCase()
  if (state.users.some((x) => x.email === e)) return 'An account with this email already exists.'
  const user: DemoUser = { id: uid('u'), email: e, password, name }
  // Accept pending invitations for this email, mirroring accept_my_invitations().
  const members = state.members.map((m) =>
    m.status === 'invited' && m.email === e ? { ...m, userId: user.id, name, status: 'active' as const } : m)
  commit({ ...state, users: [...state.users, user], members, userId: user.id })
  return null
}

export function demoSignOut() { commit({ ...state, userId: null }) }

/** Mirrors archive_business(): owner only, exact name to confirm, data kept but the business disappears. */
export function demoArchiveBusiness(businessId: string, confirmName: string): string | null {
  const b = state.businesses.find((x) => x.id === businessId && !x.archived)
  if (!b || !isOwner(businessId)) return 'only the owner can delete a business'
  if (confirmName.trim() !== b.name) return 'type the business name exactly to confirm'
  commit({ ...state, businesses: state.businesses.map((x) => (x.id === businessId ? { ...x, archived: true } : x)) })
  return null
}

export function demoReset() { commit({ ...seed() }) }

export function demoCreateBusiness(name: string, industry: IndustryCode, settings: DemoSettings = {}): string {
  const user = state.users.find((u) => u.id === state.userId)
  if (!user) throw new Error('Not signed in')
  const b: DemoBusiness = { id: uid('b'), name, industry, settings }
  const m: DemoMember = { id: uid('m'), businessId: b.id, userId: user.id, email: user.email, name: user.name, role: 'owner', status: 'active' }
  commit({
    ...state,
    businesses: [...state.businesses, b],
    members: [...state.members, m],
    modules: { ...state.modules, [b.id]: { plan: 'starter', enabled: defaultModules(industry), disabledHistory: [] } },
  })
  return b.id
}

export function demoRoleIn(businessId: string): RoleName | null {
  const m = state.members.find((x) => x.businessId === businessId && x.userId === state.userId && x.status === 'active')
  return m?.role ?? null
}

export const canManageStaff = (role: RoleName | null) => role === 'owner' || role === 'business_admin'

export function demoInvite(businessId: string, email: string, role: RoleName): string | null {
  if (!canManageStaff(demoRoleIn(businessId))) return 'permission denied'
  if (role === 'owner') return 'owner role cannot be assigned'
  const e = email.trim().toLowerCase()
  if (state.members.some((m) => m.businessId === businessId && m.email === e && m.status !== 'revoked')) return 'Already a member or invited.'
  const plan = state.modules[businessId]?.plan
  if (!plan) return 'subscription is not active'
  const used = state.members.filter((m) => m.businessId === businessId && ['active', 'suspended', 'invited'].includes(m.status)).length
  if (used >= PLANS[plan].limits.maxMembers) return 'member limit reached for the current plan'
  const existing = state.users.find((u) => u.email === e)
  const m: DemoMember = existing
    ? { id: uid('m'), businessId, userId: existing.id, email: e, name: existing.name, role, status: 'active' }
    : { id: uid('m'), businessId, userId: null, email: e, name: e, role, status: 'invited' }
  commit({ ...state, members: [...state.members, m] })
  return null
}

export function demoSetStatus(memberId: string, status: DemoMember['status']): string | null {
  const m = state.members.find((x) => x.id === memberId)
  if (!m || !canManageStaff(demoRoleIn(m.businessId))) return 'permission denied'
  if (m.role === 'owner' || m.userId === state.userId) return 'this membership cannot be changed'
  commit({ ...state, members: state.members.map((x) => (x.id === memberId ? { ...x, status } : x)) })
  return null
}

// ---------------------------------------------------------- modules & industry (demo)
const isOwner = (businessId: string) => demoRoleIn(businessId) === 'owner'
const canManageSettings = (businessId: string) => canManageStaff(demoRoleIn(businessId))

export function demoModuleStatuses(businessId: string): ModuleStatus[] {
  const b = state.businesses.find((x) => x.id === businessId)
  const mods = state.modules[businessId]
  const role = demoRoleIn(businessId)
  if (!b || !mods || !role) return []
  return computeModuleStatuses({ industry: b.industry, enabled: mods.enabled, plan: mods.plan, permissions: rolePermissions(role) })
}

function patchModules(businessId: string, patch: Partial<DemoBusinessModules>) {
  commit({ ...state, modules: { ...state.modules, [businessId]: { ...state.modules[businessId], ...patch } } })
}

export function demoEnableModule(businessId: string, code: ModuleCode): string | null {
  const b = state.businesses.find((x) => x.id === businessId)
  if (!b || !canManageSettings(businessId)) return 'permission denied'
  if (!compatibleModules(b.industry).includes(code)) return 'module is not compatible with this industry'
  const cur = state.modules[businessId]
  if (!cur.enabled.includes(code)) patchModules(businessId, { enabled: [...cur.enabled, code] })
  return null
}

export function demoDisableModule(businessId: string, code: ModuleCode): string | null {
  const b = state.businesses.find((x) => x.id === businessId)
  if (!b || !canManageSettings(businessId)) return 'permission denied'
  const status = demoModuleStatuses(businessId).find((m) => m.code === code)
  if (!status || status.isRequired) return 'this module cannot be disabled'
  const cur = state.modules[businessId]
  patchModules(businessId, { enabled: cur.enabled.filter((c) => c !== code), disabledHistory: [...new Set([...cur.disabledHistory, code])] })
  return null
}

export function demoPreviewIndustryChange(businessId: string, industry: IndustryCode) {
  const b = state.businesses.find((x) => x.id === businessId)
  if (!b || !isOwner(businessId)) throw new Error('only the owner can change the industry')
  if (!INDUSTRY_TEMPLATES[industry].available) throw new Error(`industry ${industry} is not available`)
  if (b.industry === industry) throw new Error('business already uses this industry')
  const allowed = compatibleModules(industry)
  const enabled = state.modules[businessId].enabled
  return {
    incompatible: enabled.filter((c) => !allowed.includes(c)),
    toEnable: defaultModules(industry).filter((c) => !enabled.includes(c)),
  }
}

export function demoChangeIndustry(businessId: string, industry: IndustryCode, confirm: boolean): string | null {
  try {
    const plan = demoPreviewIndustryChange(businessId, industry)
    if (plan.incompatible.length && !confirm) return 'Incompatible modules would be disabled. Confirm to proceed.'
    const cur = state.modules[businessId]
    const enabled = [...cur.enabled.filter((c) => !plan.incompatible.includes(c)), ...plan.toEnable]
    commit({
      ...state,
      businesses: state.businesses.map((x) => (x.id === businessId ? { ...x, industry } : x)),
      modules: { ...state.modules, [businessId]: { ...cur, enabled, disabledHistory: [...new Set([...cur.disabledHistory, ...plan.incompatible])] } },
    })
    return null
  } catch (e) {
    return (e as Error).message
  }
}

/** Demo only: stands in for a verified payment-provider webhook. */
export function demoSetPlan(businessId: string, plan: PlanCode | null): string | null {
  if (!isOwner(businessId)) return 'permission denied'
  patchModules(businessId, { plan })
  return null
}
