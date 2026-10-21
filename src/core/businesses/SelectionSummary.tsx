import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { industryColor } from '@/app/navigation/navigation'
import type { IndustryDefinition } from '@/core/industry-registry/types'
import { MODULES } from '@/core/module-registry/registry'
import type { IndustryCode, ModuleCode } from '@/shared/types/domain'
import { includedModuleNames } from './selection'

/** The "N business types selected" panel: what each includes, optional add-ons, and the action button. */
export function SelectionSummary({ selected, addons, onToggleAddon, children }: {
  selected: IndustryDefinition[]
  addons: Readonly<Record<string, ReadonlySet<ModuleCode>>>
  onToggleAddon: (industry: IndustryCode, code: ModuleCode) => void
  children?: ReactNode
}) {
  const n = selected.length
  return (
    <aside aria-label="Your selection" className="h-fit rounded-xl bg-white p-5 shadow-card lg:sticky lg:top-24">
      <h2 className="text-lg font-bold text-ink">{n === 0 ? 'Nothing selected yet' : `${n} business type${n === 1 ? '' : 's'} selected`}</h2>
      {n === 0 ? (
        <p className="mt-2 text-sm text-ink/60">Tick every kind of business you run. Each one becomes its own business.</p>
      ) : (
        <>
          <div className="mt-3 space-y-4">
            {selected.map((d) => {
              const names = includedModuleNames(d)
              return (
                <section key={d.id} aria-label={d.name} className="border-t border-line pt-3 first:border-0 first:pt-0">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-8 place-items-center rounded-md text-white" style={{ background: industryColor(d.id) }}><d.icon className="size-4" aria-hidden /></span>
                    <span className="text-sm font-semibold">{d.name}</span>
                  </div>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-ink/60 hover:text-ink">Includes {names.length} modules</summary>
                    <ul className="mt-1.5 space-y-1">
                      {names.map((x) => <li key={x} className="flex items-center gap-2"><Check className="size-3.5 shrink-0 text-accent" aria-hidden />{x}</li>)}
                    </ul>
                  </details>
                  {d.optionalModules.length > 0 && (
                    <fieldset className="mt-2">
                      <legend className="mb-1 text-xs font-semibold text-ink/50">Optional add-ons</legend>
                      <div className="space-y-1.5">
                        {d.optionalModules.map((c) => (
                          <label key={c} className="flex cursor-pointer items-center gap-2 text-sm">
                            <input type="checkbox" className="size-4 accent-brand" checked={addons[d.id]?.has(c) ?? false} onChange={() => onToggleAddon(d.id, c)} />
                            {MODULES[c]?.name ?? c}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </section>
              )
            })}
          </div>
          {n > 1 && <p className="mt-4 text-xs text-ink/60">This creates {n} separate businesses, each with its own data, staff and subscription.</p>}
          <p className="mt-4 rounded-lg bg-accent-soft p-3 text-center text-sm text-accent">
            <b>14-day trial</b> on the Starter plan. A few modules need a higher plan.
          </p>
        </>
      )}
      {children && <div className="mt-5">{children}</div>}
    </aside>
  )
}
