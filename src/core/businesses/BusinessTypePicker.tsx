import { Check } from 'lucide-react'
import { industryColor } from '@/app/navigation/navigation'
import type { IndustryDefinition } from '@/core/industry-registry/types'
import { groupByCategory } from './selection'
import { Badge } from '@/shared/components'
import type { IndustryCode } from '@/shared/types/domain'

/**
 * Pick one or more business types. Each ticked type becomes its own business. Cards are native checkboxes,
 * so keyboard and screen readers work.
 */
export function BusinessTypePicker({ industries, selected, onToggle }: { industries: IndustryDefinition[]; selected: readonly IndustryCode[]; onToggle: (id: IndustryCode) => void }) {
  return (
    <div role="group" aria-label="Business types" className="space-y-8">
      {groupByCategory(industries).map((g) => (
        <section key={g.category}>
          <h2 className="mb-3 text-xl font-bold tracking-tight text-ink">{g.category}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.items.map((d) => {
              const soon = d.status !== 'active'
              const Icon = d.icon
              return (
                <label key={d.id} className={`relative block ${soon ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                  <input type="checkbox" name="business-type" aria-label={d.name} className="peer sr-only" disabled={soon} checked={selected.includes(d.id)} onChange={() => onToggle(d.id)} />
                  <span className={`flex h-full items-center gap-3 rounded-lg border border-transparent bg-white p-4 shadow-card transition peer-checked:border-brand peer-checked:bg-brand/[0.04] peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${soon ? 'opacity-60' : 'hover:shadow-raised'}`}>
                    <span className="grid size-11 shrink-0 place-items-center rounded-lg text-white" style={{ background: industryColor(d.id) }}><Icon className="size-6" aria-hidden strokeWidth={1.75} /></span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">{d.name}{soon && <Badge>Coming soon</Badge>}</span>
                      <span className="mt-0.5 block text-sm text-ink/60">{d.description}</span>
                    </span>
                  </span>
                  <span aria-hidden className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-brand text-white opacity-0 shadow-pill transition peer-checked:opacity-100"><Check className="size-3.5" strokeWidth={3} /></span>
                </label>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
