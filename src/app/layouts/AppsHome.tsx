import { Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { buildApps, appPath } from '@/app/navigation/navigation'
import { useBusiness } from '@/core/business-context/BusinessProvider'
import { useModules } from '@/core/module-registry/ModulesProvider'
import { INDUSTRY_TEMPLATES } from '@/core/module-registry/registry'

/** The home screen: one tile per app, like Odoo's home menu. */
export function AppsHome() {
  const { active } = useBusiness()
  const { statuses } = useModules()
  const [q, setQ] = useState('')
  if (!active) return null
  const usable = new Set(statuses.filter((s) => s.usable).map((s) => s.code))
  const apps = buildApps(active.industry, usable).filter((a) => !q.trim() || a.label.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="min-h-[calc(100dvh-3rem)] bg-white">
      <div className="px-4 pb-16 pt-12 text-center sm:px-8">
        <h1 className="text-3xl font-bold text-ink sm:text-4xl">{active.name}</h1>
        <div className="mx-auto mt-3 h-1 w-20 rounded-full bg-amber" aria-hidden />
        <p className="mt-3 text-sm text-ink/60">{INDUSTRY_TEMPLATES[active.industry].name}</p>
      </div>

      {/* Same arched grey section as the landing page's app picker. */}
      <div className="-mt-6 bg-canvas px-4 pb-20 pt-16 sm:px-8" style={{ borderTopLeftRadius: '50% 7rem', borderTopRightRadius: '50% 7rem' }}>
      <div className="mx-auto max-w-4xl">
        <label className="relative mx-auto mb-10 block max-w-sm">
          <span className="sr-only">Search apps</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink/50" aria-hidden />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps…"
            className="h-10 w-full rounded-full border border-line bg-white pl-9 pr-4 text-sm text-ink placeholder:text-ink/50 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30"
          />
        </label>

        {apps.length === 0 ? (
          <p className="text-center text-sm text-ink/60">No app matches “{q}”.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 md:grid-cols-5">
            {apps.map((a) => (
              <li key={a.id}>
                <Link to={appPath(a.modules[0])} className="group flex flex-col items-center gap-2.5 rounded-xl p-2 outline-offset-4 transition-transform hover:-translate-y-0.5">
                  <span className="grid size-16 place-items-center rounded-2xl shadow-raised transition-shadow group-hover:shadow-[0_14px_30px_-10px_rgba(17,24,39,0.35)] sm:size-[72px]" style={{ background: `linear-gradient(140deg, ${a.color}, ${a.color}cc)` }}>
                    <a.icon className="size-8 text-white sm:size-9" aria-hidden strokeWidth={1.75} />
                  </span>
                  <span className="text-center text-[13px] font-semibold leading-tight text-ink">{a.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </div>
  )
}
