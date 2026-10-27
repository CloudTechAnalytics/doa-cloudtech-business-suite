import type { ModuleStatus } from '@/core/module-registry/availability'
import { STANDALONE_APPS, appState, canSwitchOff, neededBy } from './apps'
import type { AppCategory, AppState, StandaloneApp } from './apps'

/** Pure rules behind the App Store, kept apart from the components so they can be tested on their own. */

export type StoreFilter = 'all' | 'installed' | 'not_installed' | 'businesses' | AppCategory
export const STORE_FILTERS: { key: StoreFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'installed', label: 'Installed' }, { key: 'not_installed', label: 'Not installed' },
  { key: 'sell', label: 'Sell and customers' }, { key: 'stock', label: 'Stock' }, { key: 'money', label: 'Money' }, { key: 'businesses', label: 'Whole businesses' },
]

/** An app is installed when all of its modules are on for this business (whether or not this person may use it). */
export const isInstalled = (s: AppState) => s === 'active' || s === 'needs_plan' || s === 'no_permission'

/** Whether an app matches every word typed (name, one-line tagline, description and the names of what it does). No words match everything. */
export function appMatches(app: StandaloneApp, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hay = `${app.name} ${app.tagline} ${app.description} ${app.features.map((f) => f.label).join(' ')}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** The apps to list for a search and a filter. Words match the name, the one-line tagline, the description and the names of what it does. "Whole businesses" lists no apps. */
export function filterApps(statuses: ModuleStatus[], filter: StoreFilter, query: string, apps: StandaloneApp[] = STANDALONE_APPS): StandaloneApp[] {
  if (filter === 'businesses') return []
  return apps.filter((a) => {
    const st = appState(a, statuses)
    if (filter === 'installed' && !isInstalled(st)) return false
    if (filter === 'not_installed' && isInstalled(st)) return false
    if ((filter === 'sell' || filter === 'stock' || filter === 'money') && a.category !== filter) return false
    return appMatches(a, query)
  })
}

export type StoreAction =
  | { kind: 'open' } | { kind: 'install' } | { kind: 'remove' } | { kind: 'plans' }
  | { kind: 'none'; note: string }

/**
 * What a person can do with an app right now. Only people who manage the business's settings can install or remove (the database checks too); everyone else is told who to ask.
 * An app another app needs, or one the business type requires, cannot be removed, and the note says why.
 */
export function actionsFor(app: StandaloneApp, statuses: ModuleStatus[], canManage: boolean): { primary: StoreAction; secondary: StoreAction | null } {
  const st = appState(app, statuses)
  if (st === 'unavailable') return { primary: { kind: 'none', note: 'This business type has its own tools for this. Create a Business apps workspace to use it on its own.' }, secondary: null }
  if (st === 'needs_plan') return { primary: { kind: 'plans' }, secondary: null }
  if (st === 'no_permission') return { primary: { kind: 'none', note: 'Your role does not give access to this app. Ask the business owner.' }, secondary: null }
  if (st === 'available') return { primary: canManage ? { kind: 'install' } : { kind: 'none', note: 'Ask the business owner to install it.' }, secondary: null }
  // installed and usable
  if (!canManage) return { primary: { kind: 'open' }, secondary: null }
  if (canSwitchOff(app, statuses)) return { primary: { kind: 'open' }, secondary: { kind: 'remove' } }
  const by = neededBy(app, statuses)
  return { primary: { kind: 'open' }, secondary: { kind: 'none', note: by.length ? `Needed by ${by.map((o) => o.name).join(', ')}, so it stays on.` : 'Part of this kind of business, so it stays on.' } }
}

/** How many apps are installed, for the line under the title. */
export function installedCount(statuses: ModuleStatus[], apps: StandaloneApp[] = STANDALONE_APPS) {
  return apps.filter((a) => isInstalled(appState(a, statuses))).length
}
