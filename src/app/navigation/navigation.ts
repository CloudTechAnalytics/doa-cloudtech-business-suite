import type { LucideIcon } from 'lucide-react'
import { INDUSTRIES, getIndustry } from '@/core/industry-registry'
import { ALL_MODULES, MODULES } from '@/core/module-registry/registry'
import type { IndustryCode, ModuleCode, ModuleDefinition } from '@/shared/types/domain'

/**
 * Odoo-style model: the platform is a set of "apps". Each app has a few menu entries (modules) that appear
 * in the top navbar once the app is open; the home screen shows one tile per app.
 */
export interface AppDef {
  id: string
  label: string
  icon: LucideIcon
  /** Tile colour on the home screen. */
  color: string
  modules: ModuleDefinition[]
}
export interface QuickAction { label: string; to: string; module: ModuleCode }

interface SharedAppSpec { id: string; label: string; color: string; modules: ModuleCode[] }

/** Platform apps, in home-screen order. Industry apps are inserted after Dashboard. */
const BEFORE: SharedAppSpec[] = [{ id: 'dashboard', label: 'Dashboard', color: '#2b5aa0', modules: ['dashboard'] }]
const AFTER: SharedAppSpec[] = [
  { id: 'sales', label: 'Sales', color: '#2f9e44', modules: ['sales'] },
  { id: 'crm', label: 'CRM', color: '#d6336c', modules: ['customers'] },
  { id: 'inventory', label: 'Inventory', color: '#e8590c', modules: ['inventory'] },
  { id: 'purchase', label: 'Purchase', color: '#1c7ed6', modules: ['purchases', 'suppliers'] },
  { id: 'finance', label: 'Finance', color: '#017e84', modules: ['expenses', 'reports'] },
  { id: 'staff', label: 'Staff', color: '#7048e8', modules: ['staff'] },
  { id: 'settings', label: 'Settings', color: '#5f6b7a', modules: ['settings'] },
]
const INDUSTRY_COLORS: Record<string, string> = { farm: '#5c940d', bakery: '#d9480f', retail: '#1971c2', pharmacy: '#0ca678' }

/** Colour used for an industry's tile on the home screen and in the business-type picker. */
export const industryColor = (id: string) => INDUSTRY_COLORS[id] ?? '#1971c2'

const COLOR_PRIORITY = ['sales', 'inventory', 'finance', 'staff', 'crm', 'purchase', 'settings']
/** An industry section that holds shared modules (stock, sales, finance, staff) keeps those apps' familiar colours; the rest use the industry colour. */
const OWN_PALETTE = ['#e03131', '#5c940d', '#f08c00', '#1098ad', '#4263eb']
function sectionColor(codes: ModuleCode[], fallbackIndex: number): string {
  const spec = COLOR_PRIORITY.map((id) => AFTER.find((a) => a.id === id)!).find((a) => a.modules.some((m) => codes.includes(m)))
  return spec?.color ?? OWN_PALETTE[fallbackIndex % OWN_PALETTE.length]
}

/** Apps for a business. Only usable modules (enabled, entitled, permitted) appear; this is presentation only. */
export function buildApps(industry: IndustryCode, usable: ReadonlySet<ModuleCode>): AppDef[] {
  const pick = (codes: ModuleCode[]) => codes.filter((c) => usable.has(c)).map((c) => MODULES[c])
  const fromSpec = (s: SharedAppSpec): AppDef | null => {
    const modules = pick(s.modules)
    return modules.length ? { id: s.id, label: s.label, color: s.color, icon: modules[0].icon, modules } : null
  }
  const hasShared = (codes: ModuleCode[]) => COLOR_PRIORITY.some((id) => AFTER.find((a) => a.id === id)!.modules.some((m) => codes.includes(m)))
  const pure = getIndustry(industry).navigation.filter((sec) => !hasShared(sec.modules)).length
  let own = 0 // sections with no shared module get their own colours in turn (a lone one keeps the industry colour)
  const industryApps: (AppDef | null)[] = getIndustry(industry).navigation.map((section, i) => {
    const modules = pick(section.modules)
    if (!modules.length) return null
    const color = hasShared(section.modules) ? sectionColor(section.modules, 0) : pure === 1 ? (INDUSTRY_COLORS[industry] ?? '#1971c2') : OWN_PALETTE[own++ % OWN_PALETTE.length]
    return { id: `${industry}-${i}`, label: section.label, color, icon: modules[0].icon, modules }
  })
  // A module an industry lists in its own sections (e.g. the farm's Inventory) is not repeated under the generic apps.
  const claimed = new Set(getIndustry(industry).navigation.flatMap((s) => s.modules))
  const generic = (s: SharedAppSpec) => fromSpec({ ...s, modules: s.modules.filter((c) => !claimed.has(c)) })
  return [...BEFORE.map(generic), ...industryApps, ...AFTER.map(generic)].filter((a): a is AppDef => a !== null)
}

export const appPath = (m: ModuleDefinition) => `/app/${m.path}`

/** The app whose menu contains the page being viewed (null on the home screen). */
export function findCurrentApp(apps: AppDef[], pathname: string): AppDef | null {
  return apps.find((a) => a.modules.some((m) => pathname === appPath(m) || pathname.startsWith(`${appPath(m)}/`))) ?? null
}

/** Modules that live in the account menu (top right) instead of the sidebar: the people who work here, who has access, and settings. */
export const ACCOUNT_MODULES: readonly ModuleCode[] = ['farm-workers', 'staff', 'settings']

export type SidebarEntry =
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'link'; key: string; module: ModuleDefinition; app: AppDef }

/**
 * What the sidebar shows. An app with several modules gets a heading and its links; an app with a single
 * module is just a link (a heading would repeat its name).
 */
export function sidebarEntries(allApps: AppDef[]): SidebarEntry[] {
  const apps = allApps.map((a) => ({ ...a, modules: a.modules.filter((m) => !ACCOUNT_MODULES.includes(m.code)) })).filter((a) => a.modules.length > 0)
  return apps.flatMap((app): SidebarEntry[] => {
    const links = app.modules.map((module) => ({ kind: 'link' as const, key: module.code, module, app }))
    return app.modules.length > 1 ? [{ kind: 'heading', key: `h-${app.id}`, label: app.label }, ...links] : links
  })
}

export interface LandingApp { id: string; label: string; blurb: string; icon: LucideIcon; color: string }

const LANDING_BLURBS: Record<string, string> = {
  sales: 'Point of sale, payments, receipts and returns',
  crm: 'Leads, customers, follow-ups and credit limits',
  inventory: 'A stock ledger with transfers and counts',
  purchase: 'Orders, goods received and supplier payments',
  finance: 'Expenses and reports',
  staff: 'Roles and access, business by business',
}

/** Apps shown on the public landing page: the shared apps, then one per active industry. Not business-specific. */
export function landingApps(): { shared: LandingApp[]; industries: LandingApp[] } {
  const shared = AFTER.filter((a) => a.id !== 'settings').map((a) => ({
    id: a.id, label: a.label, color: a.color, icon: MODULES[a.modules[0]].icon, blurb: LANDING_BLURBS[a.id] ?? '',
  }))
  const industries = Object.values(INDUSTRIES).filter((d) => d.status === 'active' && d.navigation.length > 0).map((d) => ({
    id: d.id, label: d.appName ?? d.navigation[0].label, color: industryColor(d.id), icon: d.icon, blurb: d.description,
  }))
  return { shared, industries }
}

export interface SiteMenuItem { label: string; icon: LucideIcon; to: string; blurb?: string; tag?: 'Preview' | 'Soon' }
export interface SiteMenuColumn { id: string; title: string; color: string; icon: LucideIcon; description?: string; items: SiteMenuItem[]; /** Modules not listed (the menu shows the first few so the panel fits the screen). */ more?: number; cta?: { label: string; to: string } }

const TAGS = { preview: 'Preview', soon: 'Soon' } as const
const itemFor = (m: ModuleDefinition, to: string): SiteMenuItem => ({ label: m.name, icon: m.icon, to, blurb: m.description, tag: m.maturity ? TAGS[m.maturity] : undefined })

/** The public site's "Apps" and "Industries" menus, built from the registries so they never drift from the product. */
export function landingMenus(): { apps: SiteMenuColumn[]; industries: SiteMenuColumn[] } {
  const platform = ALL_MODULES.filter((m) => m.owner === 'platform')
  const shared = (title: string, group: string, color: string): SiteMenuColumn | null => {
    const mods = platform.filter((m) => m.navGroup === group)
    return mods.length ? { id: group, title, color, icon: mods[0].icon, items: mods.map((m) => itemFor(m, '/start')) } : null
  }
  const owned = Object.values(INDUSTRIES).filter((d) => d.status === 'active' && d.modules.length > 0).map((d): SiteMenuColumn => ({
    id: d.id, title: d.appName ?? d.navigation[0]?.label ?? d.name, color: industryColor(d.id), icon: d.icon,
    // The panel must fit the screen without scrolling, so each column lists its first six modules; the rest are in the product.
    items: d.modules.slice(0, 6).map((m) => itemFor(m, `/start?type=${d.id}`)),
    more: Math.max(d.modules.length - 6, 0),
  }))
  const apps = [
    shared('Sales', 'Sales and customers', '#2f9e44'),
    shared('Stock and purchasing', 'Stock and purchasing', '#e8590c'),
    ...owned,
    shared('Finance', 'Finance', '#017e84'),
    shared('Administration', 'Administration', '#7048e8'),
  ].filter((c): c is SiteMenuColumn => c !== null)

  const industries = Object.values(INDUSTRIES).map((d): SiteMenuColumn => {
    const soon = d.status !== 'active'
    const mods = d.defaultModules.map((c) => MODULES[c]).filter((m): m is ModuleDefinition => !!m).slice(0, 6)
    return {
      id: d.id, title: d.name, color: industryColor(d.id), icon: d.icon, description: d.description,
      items: soon ? [] : mods.map((m) => ({ ...itemFor(m, `/start?type=${d.id}`), blurb: undefined })),
      cta: soon ? undefined : { label: `Start with ${d.name.split(' ')[0]}`, to: `/start?type=${d.id}` },
    }
  })
  return { apps, industries }
}

/** Record-menu entries: shared module quick actions plus the industry's workflows. */
export function buildQuickActions(industry: IndustryCode, usable: ReadonlySet<ModuleCode>): QuickAction[] {
  const shared = ALL_MODULES.filter((m) => m.owner === 'platform' && m.quickAction && usable.has(m.code)).map((m) => ({
    label: m.quickAction!.label, module: m.code, to: `/app/${m.path}${m.quickAction!.query ? `?${m.quickAction!.query}` : ''}`,
  }))
  const own = getIndustry(industry).workflows.filter((w) => usable.has(w.module)).map((w) => ({ label: w.label, module: w.module, to: `/app/${MODULES[w.module].path}` }))
  return [...own, ...shared]
}
