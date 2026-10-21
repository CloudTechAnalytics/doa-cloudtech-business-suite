import type { LucideIcon } from 'lucide-react'
import { getIndustry } from '@/core/industry-registry'
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

/** Apps for a business. Only usable modules (enabled, entitled, permitted) appear; this is presentation only. */
export function buildApps(industry: IndustryCode, usable: ReadonlySet<ModuleCode>): AppDef[] {
  const pick = (codes: ModuleCode[]) => codes.filter((c) => usable.has(c)).map((c) => MODULES[c])
  const fromSpec = (s: SharedAppSpec): AppDef | null => {
    const modules = pick(s.modules)
    return modules.length ? { id: s.id, label: s.label, color: s.color, icon: modules[0].icon, modules } : null
  }
  const industryApps: (AppDef | null)[] = getIndustry(industry).navigation.map((section, i) => {
    const modules = pick(section.modules)
    return modules.length ? { id: `${industry}-${i}`, label: section.label, color: INDUSTRY_COLORS[industry] ?? '#1971c2', icon: modules[0].icon, modules } : null
  })
  return [...BEFORE.map(fromSpec), ...industryApps, ...AFTER.map(fromSpec)].filter((a): a is AppDef => a !== null)
}

export const appPath = (m: ModuleDefinition) => `/app/${m.path}`

/** The app whose menu contains the page being viewed (null on the home screen). */
export function findCurrentApp(apps: AppDef[], pathname: string): AppDef | null {
  return apps.find((a) => a.modules.some((m) => pathname === appPath(m) || pathname.startsWith(`${appPath(m)}/`))) ?? null
}

export type SidebarEntry =
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'link'; key: string; module: ModuleDefinition; app: AppDef }

/**
 * What the sidebar shows. An app with several modules gets a heading and its links; an app with a single
 * module is just a link (a heading would repeat its name).
 */
export function sidebarEntries(apps: AppDef[]): SidebarEntry[] {
  return apps.flatMap((app): SidebarEntry[] => {
    const links = app.modules.map((module) => ({ kind: 'link' as const, key: module.code, module, app }))
    return app.modules.length > 1 ? [{ kind: 'heading', key: `h-${app.id}`, label: app.label }, ...links] : links
  })
}

/** Record-menu entries: shared module quick actions plus the industry's workflows. */
export function buildQuickActions(industry: IndustryCode, usable: ReadonlySet<ModuleCode>): QuickAction[] {
  const shared = ALL_MODULES.filter((m) => m.owner === 'platform' && m.quickAction && usable.has(m.code)).map((m) => ({
    label: m.quickAction!.label, module: m.code, to: `/app/${m.path}${m.quickAction!.query ? `?${m.quickAction!.query}` : ''}`,
  }))
  const own = getIndustry(industry).workflows.filter((w) => usable.has(w.module)).map((w) => ({ label: w.label, module: w.module, to: `/app/${MODULES[w.module].path}` }))
  return [...own, ...shared]
}
