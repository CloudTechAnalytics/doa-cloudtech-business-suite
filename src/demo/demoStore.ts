import { useSyncExternalStore } from 'react'
import type { IndustryCode, ModuleCode, PlanCode, RoleName } from '@/shared/types/domain'
import { PLANS } from '@/core/subscriptions/plans'
import { THEMES } from '@/core/theme/themes'
import { computeModuleStatuses } from '@/core/module-registry/availability'
import { rolePermissions } from '@/core/permissions/roles'
import type { ModuleStatus } from '@/core/module-registry/availability'
import { INDUSTRY_TEMPLATES, compatibleModules, defaultModules } from '@/core/module-registry/registry'

/**
 * Browser-only demo backend. Used ONLY when Supabase is not configured.
 * Passwords are stored in plain text in localStorage: this is not security, just a demo.
 */

export interface DemoUser { id: string; email: string; password: string; name: string; mustChange?: boolean }
export interface DemoSettings { tax_rate_percent?: number; theme?: string; setup?: Record<string, string | number | boolean> }
export interface DemoBusiness { id: string; name: string; industry: IndustryCode; settings?: DemoSettings; archived?: boolean; suspended?: boolean; createdAt?: string }
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
  { email: 'owner@demo.test', password: 'demo1234', note: 'Owner of 5 businesses (farm, bakery, retail, pharmacy, school)' },
  { email: 'cashier@demo.test', password: 'demo1234', note: 'Cashier at CityMart and CarePlus Pharmacy' },
  { email: 'pharmacist@demo.test', password: 'demo1234', note: 'Pharmacist at CarePlus Pharmacy' },
  { email: 'teacher@demo.test', password: 'demo1234', note: 'Class teacher at Bright Future Academy' },
  { email: 'parent@demo.test', password: 'demo1234', note: 'Parent at Bright Future Academy' },
  { email: 'bursar@demo.test', password: 'demo1234', note: 'Bursar at Bright Future Academy' },
  { email: 'platform@demo.test', password: 'demo1234', note: 'Platform owner: opens the Platform console' },
  { email: 'engineer@demo.test', password: 'demo1234', note: 'Platform engineer: can manage businesses and subscriptions' },
  { email: 'support@demo.test', password: 'demo1234', note: 'Platform support: read only' },
]

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
const seed = (): State => ({
  userId: null,
  modules: {
    'b-farm': { plan: 'growth', enabled: defaultModules('farm'), disabledHistory: [] },
    // Starter on purpose: shows modules locked behind a plan upgrade.
    'b-bakery': { plan: 'starter', enabled: defaultModules('bakery'), disabledHistory: [] },
    'b-retail': { plan: 'growth', enabled: defaultModules('retail'), disabledHistory: [] },
    'b-pharmacy': { plan: 'growth', enabled: defaultModules('pharmacy'), disabledHistory: [] },
    'b-school': { plan: 'growth', enabled: defaultModules('school'), disabledHistory: [] },
  },
  users: [
    { id: 'u-owner', email: 'owner@demo.test', password: 'demo1234', name: 'Demo Owner' },
    { id: 'u-cashier', email: 'cashier@demo.test', password: 'demo1234', name: 'Demo Cashier' },
    { id: 'u-acct', email: 'accountant@demo.test', password: 'demo1234', name: 'Demo Accountant' },
    { id: 'u-pharm', email: 'pharmacist@demo.test', password: 'demo1234', name: 'Demo Pharmacist' },
    { id: 'u-teacher', email: 'teacher@demo.test', password: 'demo1234', name: 'Mr Teacher' },
    { id: 'u-parent', email: 'parent@demo.test', password: 'demo1234', name: 'Mrs Obi' },
    { id: 'u-bursar', email: 'bursar@demo.test', password: 'demo1234', name: 'Demo Bursar' },
    { id: 'u-principal', email: 'principal@demo.test', password: 'demo1234', name: 'Demo Principal' },
    { id: 'u-platform', email: 'platform@demo.test', password: 'demo1234', name: 'Platform Owner' },
    { id: 'u-engineer', email: 'engineer@demo.test', password: 'demo1234', name: 'Platform Engineer' },
    { id: 'u-support', email: 'support@demo.test', password: 'demo1234', name: 'Platform Support' },
  ],
  businesses: [
    { id: 'b-farm', name: 'Greenfield Farms', industry: 'farm', createdAt: daysAgo(120) },
    { id: 'b-bakery', name: 'Sunrise Bakery', industry: 'bakery', createdAt: daysAgo(6) },
    { id: 'b-retail', name: 'CityMart', industry: 'retail', createdAt: daysAgo(11) },
    { id: 'b-pharmacy', name: 'CarePlus Pharmacy', industry: 'pharmacy', createdAt: daysAgo(50) },
    { id: 'b-school', name: 'Bright Future Academy', industry: 'school', createdAt: daysAgo(2) },
  ],
  members: [
    { id: 'm1', businessId: 'b-farm', userId: 'u-owner', email: 'owner@demo.test', name: 'Demo Owner', role: 'owner', status: 'active' },
    { id: 'm2', businessId: 'b-bakery', userId: 'u-owner', email: 'owner@demo.test', name: 'Demo Owner', role: 'owner', status: 'active' },
    { id: 'm3', businessId: 'b-retail', userId: 'u-owner', email: 'owner@demo.test', name: 'Demo Owner', role: 'owner', status: 'active' },
    { id: 'm4', businessId: 'b-retail', userId: 'u-cashier', email: 'cashier@demo.test', name: 'Demo Cashier', role: 'cashier', status: 'active' },
    { id: 'm5', businessId: 'b-bakery', userId: 'u-acct', email: 'accountant@demo.test', name: 'Demo Accountant', role: 'accountant', status: 'active' },
    { id: 'm6', businessId: 'b-retail', userId: 'u-acct', email: 'accountant@demo.test', name: 'Demo Accountant', role: 'accountant', status: 'active' },
    { id: 'm7', businessId: 'b-pharmacy', userId: 'u-owner', email: 'owner@demo.test', name: 'Demo Owner', role: 'owner', status: 'active' },
    { id: 'm8', businessId: 'b-pharmacy', userId: 'u-pharm', email: 'pharmacist@demo.test', name: 'Demo Pharmacist', role: 'pharmacist', status: 'active' },
    { id: 'm9', businessId: 'b-pharmacy', userId: 'u-cashier', email: 'cashier@demo.test', name: 'Demo Cashier', role: 'cashier', status: 'active' },
    { id: 'm10', businessId: 'b-school', userId: 'u-owner', email: 'owner@demo.test', name: 'Demo Owner', role: 'owner', status: 'active' },
    { id: 'm11', businessId: 'b-school', userId: 'u-principal', email: 'principal@demo.test', name: 'Demo Principal', role: 'principal', status: 'active' },
    { id: 'm12', businessId: 'b-school', userId: 'u-teacher', email: 'teacher@demo.test', name: 'Mr Teacher', role: 'teacher', status: 'active' },
    { id: 'm13', businessId: 'b-school', userId: 'u-bursar', email: 'bursar@demo.test', name: 'Demo Bursar', role: 'bursar', status: 'active' },
    { id: 'm14', businessId: 'b-school', userId: 'u-parent', email: 'parent@demo.test', name: 'Mrs Obi', role: 'parent', status: 'active' },
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
  // Demo accounts added in later releases (such as the platform team) must also work for browsers that saved the demo data earlier.
  const have = new Set(st.users.map((u) => u.id))
  const users = [...st.users, ...seed().users.filter((u) => !have.has(u.id))]
  const businesses = st.businesses.map((b) => (b.createdAt ? b : { ...b, createdAt: daysAgo(30) }))
  return { ...st, modules, users, businesses }
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

/** Mirrors school_create_login(): an account with a temporary password that the person must replace at first sign-in. Never for an email that already has an account. */
export function demoCreateLoginUser(businessId: string, name: string, email: string, password: string, role: RoleName): string | null {
  const e = email.trim().toLowerCase()
  if (state.users.some((x) => x.email === e)) return 'this email already has an account; send an invitation instead and they sign in with their own password'
  const user: DemoUser = { id: uid('u'), email: e, password, name, mustChange: true }
  const old = state.members.find((m) => m.businessId === businessId && m.email === e && m.status === 'invited')
  const m: DemoMember = { id: old?.id ?? uid('m'), businessId, userId: user.id, email: e, name, role, status: 'active' }
  commit({ ...state, users: [...state.users, user], members: [...state.members.filter((x) => x !== old), m] })
  return user.id
}

/** The signed-in person choosing their own password (clears the "must change" flag). */
export function demoSetOwnPassword(password: string): string | null {
  if (!state.userId) return 'Not signed in'
  commit({ ...state, users: state.users.map((u) => (u.id === state.userId ? { ...u, password, mustChange: false } : u)) })
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

/** Demo only: a person changing their own name on the profile page. */
export function demoSetUserName(userId: string, name: string) {
  commit({ ...state, users: state.users.map((u) => (u.id === userId ? { ...u, name } : u)), members: state.members.map((m) => (m.userId === userId ? { ...m, name } : m)) })
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
  const b: DemoBusiness = { id: uid('b'), name, industry, settings, createdAt: new Date().toISOString() }
  const m: DemoMember = { id: uid('m'), businessId: b.id, userId: user.id, email: user.email, name: user.name, role: 'owner', status: 'active' }
  commit({
    ...state,
    businesses: [...state.businesses, b],
    members: [...state.members, m],
    modules: { ...state.modules, [b.id]: { plan: 'starter', enabled: defaultModules(industry), disabledHistory: [] } },
  })
  return b.id
}

/** Mirrors set_business_theme(): settings managers only, named themes only. */
export function demoSetTheme(businessId: string, theme: string): string | null {
  const b = state.businesses.find((x) => x.id === businessId && !x.archived)
  if (!b || !canManageStaff(demoRoleIn(businessId))) return 'permission denied'
  if (!THEMES.some((t) => t.key === theme)) return 'choose one of the colour themes'
  commit({ ...state, businesses: state.businesses.map((x) => (x.id === businessId ? { ...x, settings: { ...x.settings, theme } } : x)) })
  return null
}

export function demoRoleIn(businessId: string): RoleName | null {
  const m = state.members.find((x) => x.businessId === businessId && x.userId === state.userId && x.status === 'active')
  return m?.role ?? null
}

export const canManageStaff = (role: RoleName | null) => role === 'owner' || role === 'business_admin'

export function demoInvite(businessId: string, email: string, role: RoleName): string | null {
  if (!canManageStaff(demoRoleIn(businessId))) return 'permission denied'
  return demoInviteUnchecked(businessId, email, role)
}

/** The invitation itself, for callers that have already checked who may invite (the school staff page lets a principal invite). */
export function demoInviteUnchecked(businessId: string, email: string, role: RoleName): string | null {
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

/** Withdraws a login invitation that has not been used yet. */
export function demoCancelInvite(businessId: string, email: string) {
  const e = email.trim().toLowerCase()
  commit({ ...state, members: state.members.filter((m) => !(m.businessId === businessId && m.email === e && m.status === 'invited')) })
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

/** Demo only, for the Platform console: suspending hides the business from everyone, like the database does. */
export function demoPlatformSetSuspended(businessId: string, suspended: boolean) {
  commit({ ...state, businesses: state.businesses.map((x) => (x.id === businessId ? { ...x, suspended } : x)) })
}
export function demoPlatformSetPlan(businessId: string, plan: PlanCode) { patchModules(businessId, { plan }) }
/** Demo only, for the Platform console: rename, archive, and change who owns or can use a business. */
export function demoPlatformPatchBusiness(businessId: string, patch: Partial<DemoBusiness>) {
  commit({ ...state, businesses: state.businesses.map((x) => (x.id === businessId ? { ...x, ...patch } : x)) })
}
export function demoPlatformRemoveBusiness(businessId: string) {
  const modules = { ...state.modules }; delete modules[businessId]
  commit({ ...state, businesses: state.businesses.filter((b) => b.id !== businessId), members: state.members.filter((m) => m.businessId !== businessId), modules })
}
export function demoPlatformRemoveUsers(ids: string[]) {
  const gone = new Set(ids)
  commit({ ...state, users: state.users.filter((u) => !gone.has(u.id)), members: state.members.filter((m) => !m.userId || !gone.has(m.userId)) })
}
export function demoPlatformPatchMembers(businessId: string, fn: (m: DemoMember) => DemoMember) {
  commit({ ...state, members: state.members.map((m) => (m.businessId === businessId ? fn(m) : m)) })
}

/** Demo only: stands in for a verified payment-provider webhook. */
export function demoSetPlan(businessId: string, plan: PlanCode | null): string | null {
  if (!isOwner(businessId)) return 'permission denied'
  patchModules(businessId, { plan })
  return null
}
