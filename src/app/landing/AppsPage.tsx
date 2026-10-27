import clsx from 'clsx'
import { ArrowRight, Search } from 'lucide-react'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { AppDetailsPanel } from '@/core/app-catalogue/AppDetails'
import { APP_CATEGORIES, STANDALONE_APPS, startPath } from '@/core/app-catalogue/apps'
import type { StandaloneApp } from '@/core/app-catalogue/apps'
import { appMatches } from '@/core/app-catalogue/storeLogic'
import { INDUSTRIES } from '@/core/industry-registry'
import { industryColor } from '@/app/navigation/navigation'
import { Mark } from './Mark'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

type Filter = 'all' | 'sell' | 'stock' | 'money' | 'businesses'
const FILTERS: { key: Filter; label: string }[] = [{ key: 'all', label: 'All' }, ...APP_CATEGORIES.map((c) => ({ key: c.key as Filter, label: c.label })), { key: 'businesses', label: 'Whole businesses' }]

/** What the filters and the search show on the public Apps page. Same rules as inside the App Store, without the installed state (there is no workspace yet). */
export function publicApps(filter: Filter, query: string): StandaloneApp[] {
  if (filter === 'businesses') return []
  return STANDALONE_APPS.filter((a) => (filter === 'all' || a.category === filter) && appMatches(a, query))
}

/**
 * The public Apps page. It reads like the App Store inside the product (the same search, filters, rows and details panel), so a person sees the same thing before and
 * after signing up. Here the action is "Start with this app": it goes to that app's sign-in, and the workspace opens with only that app on.
 */
export function AppsPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<StandaloneApp | null>(null)
  const apps = publicApps(filter, query)
  const businesses = Object.values(INDUSTRIES).filter((d) => d.status === 'active' && d.id !== 'general' && (!query.trim() || `${d.name} ${d.description}`.toLowerCase().includes(query.trim().toLowerCase())))
  const showBusinesses = (filter === 'all' || filter === 'businesses') && businesses.length > 0
  return (
    <div className="bg-white text-ink">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#f1f6fb] via-white to-white px-4 pb-8 pt-16 text-center sm:px-6 sm:pt-20">
        <h1 className="anim-fade-up mx-auto max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">Start with one <Mark>useful app</Mark></h1>
        <p className="anim-fade-up mx-auto mt-5 max-w-2xl text-lg font-medium text-ink/70" style={{ '--d': '120ms' } as CSSProperties}>Use DOA CRM, POS, Inventory, Invoices, Expenses and Finance on their own, with no industry to choose. Add more from the App Store whenever you need them, and every app is free to start.</p>
      </section>
      <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <label className="relative mx-auto mb-4 block max-w-xl">
          <span className="sr-only">Search apps</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink/50" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps, e.g. invoice, stock, quote" className="h-11 w-full rounded-full border border-line bg-white pl-10 pr-4 text-sm shadow-card" />
        </label>
        <div className="mb-6 flex flex-wrap justify-center gap-1.5" role="group" aria-label="Filter apps">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
              className={clsx('rounded-full border px-3.5 py-1.5 text-sm transition', filter === f.key ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink/80 hover:bg-surface')}>{f.label}</button>
          ))}
        </div>

        {apps.length === 0 && !showBusinesses && <p className="py-10 text-center text-ink/60">No apps match. Try another word, or choose All.</p>}
        {apps.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white shadow-card">
            {apps.map((app) => (
              <li key={app.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 hover:bg-surface/60">
                <button type="button" onClick={() => setOpen(app)} className="flex min-w-0 flex-1 basis-72 items-center gap-4 text-left" aria-label={`Details of ${app.name}`}>
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: app.color }}><app.icon className="size-6" aria-hidden /></span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{app.name}</span><span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-ink/60">{APP_CATEGORIES.find((c) => c.key === app.category)?.label}</span></span>
                    <span className="block text-sm text-ink/70">{app.tagline}</span>
                  </span>
                </button>
                <button type="button" onClick={() => setOpen(app)} className="text-sm font-semibold text-ink/70 underline-offset-2 hover:underline">Details</button>
                <Link to={startPath(app)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-amber px-3 text-sm font-semibold text-ink hover:bg-amber-dark">Start <ArrowRight className="size-4" aria-hidden /></Link>
              </li>
            ))}
          </ul>
        )}

        {showBusinesses && (
          <section className="mt-10" aria-label="Whole businesses">
            <h2 className="text-xl font-bold">Running a whole business?</h2>
            <p className="mb-4 max-w-2xl text-sm text-ink/70">A shop, farm, bakery, pharmacy or school comes with its own screens and workflows. It is its own business, and the apps above are part of it too.</p>
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {businesses.map((d) => (
                <li key={d.id} className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4 shadow-card">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: industryColor(d.id) }}><d.icon className="size-5" aria-hidden /></span>
                  <div className="min-w-0"><p className="font-semibold">{d.name}</p><p className="text-xs text-ink/60">{d.description}</p>
                    <Link to={`/start?type=${d.id}`} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">Start a {d.name.toLowerCase()} business <ArrowRight className="size-3.5" aria-hidden /></Link></div>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="mt-10 text-center text-sm text-ink/70"><Link to="/pricing" className="font-semibold underline">See pricing</Link></p>
      </section>
      {open && <AppDetailsPanel app={open} onClose={() => setOpen(null)} footer={<Link to={startPath(open)} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-amber px-4 text-sm font-semibold text-ink hover:bg-amber-dark">Start with {open.name.replace('DOA ', '')} <ArrowRight className="size-4" aria-hidden /></Link>} />}
      <SiteFooter />
    </div>
  )
}
