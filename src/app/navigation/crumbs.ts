import type { AppDef } from '@/app/navigation/navigation'
import { ACCOUNT_MODULES, appPath, sectionPath } from '@/app/navigation/navigation'
import type { ModuleDefinition } from '@/shared/types/domain'

export interface Crumb { label: string; to: string | null }

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Where the person is, as a trail for the top bar: the app, the module when it is not the same name, and the part of it that is open (read from ?tab=).
 * "Invoices / Ageing", "CRM / Deals", "Stock and purchasing / Inventory / Counts". The last crumb is the page itself and has no link; a repeated name is shown once.
 * A module with parts opens on its first part when the address names none, as the pages do.
 */
export function breadcrumb(apps: AppDef[], pathname: string, search: string): Crumb[] {
  const clean = pathname.replace(/\/$/, '')
  if (clean === '/app') return [{ label: 'Apps', to: null }]
  const app = apps.find((a) => a.modules.some((m) => clean === appPath(m) || clean.startsWith(`${appPath(m)}/`)))
  if (!app) return [{ label: 'DOA', to: null }]
  const mod = app.modules.find((m) => clean === appPath(m) || clean.startsWith(`${appPath(m)}/`)) as ModuleDefinition
  const tab = (new URLSearchParams(search).get('tab') ?? '').toLowerCase()
  const section = mod.sections?.length ? (mod.sections.find((s) => s.key === tab || s.label.toLowerCase() === tab) ?? mod.sections[0]) : null
  const trail: Crumb[] = [{ label: app.label, to: null }, { label: mod.name, to: appPath(mod) }, ...(section ? [{ label: section.label, to: sectionPath(mod, section) }] : [])]
  const out: Crumb[] = []
  for (const c of trail) if (!out.length || !same(out[out.length - 1].label, c.label)) out.push(c)
  // Only the first crumb is an app (it has no page of its own); the rest link to where they are, except the last.
  return out.map((c, i) => (i === out.length - 1 ? { ...c, to: null } : c))
}

export interface PageHit { label: string; group: string; to: string; keywords: string }

/** Everything in the sidebar and the Record menu, flattened so it can be searched by name. Account pages (staff, settings) are included. */
export function pageIndex(apps: AppDef[], quick: { label: string; to: string }[]): PageHit[] {
  const hits: PageHit[] = []
  const seen = new Set<string>()
  for (const app of apps) {
    for (const m of app.modules) {
      const group = ACCOUNT_MODULES.includes(m.code) ? 'Settings and people' : app.label
      if (!seen.has(m.code)) { seen.add(m.code); hits.push({ label: m.name, group, to: appPath(m), keywords: `${m.description} ${app.label}` }) }
      for (const s of m.sections ?? []) hits.push({ label: `${m.name}: ${s.label}`, group, to: sectionPath(m, s), keywords: app.label })
    }
  }
  for (const q of quick) hits.push({ label: q.label, group: 'Record', to: q.to, keywords: 'new add create record' })
  return hits
}

/** Pages whose name, group or description contains every word typed. Names that start with the text come first. */
export function searchPages(index: PageHit[], term: string, limit = 8): PageHit[] {
  const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return index
    .map((h) => { const name = h.label.toLowerCase(); const hay = `${name} ${h.group.toLowerCase()} ${h.keywords.toLowerCase()}`; return { h, ok: words.every((w) => hay.includes(w)), starts: words.every((w) => name.split(/[\s:]+/).some((p) => p.startsWith(w))) } })
    .filter((x) => x.ok)
    .sort((a, z) => Number(z.starts) - Number(a.starts) || a.h.label.length - z.h.label.length)
    .slice(0, limit)
    .map((x) => x.h)
}
