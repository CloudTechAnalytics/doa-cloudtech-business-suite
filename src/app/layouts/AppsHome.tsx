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
    <div className="min-h-[calc(100dvh-3rem)] bg-gradient-to-br from-brand via-brand to-brand-dark px-4 pb-16 pt-10 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-10 text-center text-white">
          <h1 className="text-2xl font-semibold">{active.name}</h1>
          <p className="mt-1 text-sm text-white/70">{INDUSTRY_TEMPLATES[active.industry].name}</p>
          <label className="relative mx-auto mt-6 block max-w-sm">
            <span className="sr-only">Search apps</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/60" aria-hidden />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps…"
              className="h-10 w-full rounded-full border border-white/20 bg-white/10 pl-9 pr-4 text-sm text-white placeholder:text-white/60 focus:border-white/50 focus:bg-white/15 focus:outline-none"
            />
          </label>
        </div>

        {apps.length === 0 ? (
          <p className="text-center text-sm text-white/70">No app matches “{q}”.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 md:grid-cols-5">
            {apps.map((a) => (
              <li key={a.id}>
                <Link to={appPath(a.modules[0])} className="group flex flex-col items-center gap-2.5 rounded-xl p-2 outline-offset-4 transition-transform hover:-translate-y-0.5">
                  <span className="grid size-16 place-items-center rounded-2xl shadow-raised ring-1 ring-white/20 transition-shadow group-hover:shadow-[0_14px_30px_-8px_rgba(0,0,0,0.45)] sm:size-[72px]" style={{ background: `linear-gradient(140deg, ${a.color}, ${a.color}cc)` }}>
                    <a.icon className="size-8 text-white sm:size-9" aria-hidden strokeWidth={1.75} />
                  </span>
                  <span className="text-center text-[13px] font-medium leading-tight text-white">{a.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
