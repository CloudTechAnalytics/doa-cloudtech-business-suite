import { Check, Minus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PLANS, PLAN_PRICES } from '@/core/subscriptions/plans'
import { naira } from '@/shared/utilities/format'
import type { PlanCode } from '@/shared/types/domain'
import { Mark } from './Mark'
import { Reveal } from './Reveal'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'


const ORDER: PlanCode[] = ['starter', 'basic', 'growth', 'business']
const TAGLINE: Record<PlanCode, string> = {
  starter: 'To try it out or run a very small business.',
  basic: 'For a business that buys from suppliers and tracks expenses.',
  growth: 'For a busy business with several branches and staff.',
  business: 'For a larger business with many branches and people.',
}
const FEATURED: PlanCode = 'growth'

const FEATURES: { label: string; has: (p: PlanCode) => boolean }[] = [
  { label: 'Sales, customers and stock', has: () => true },
  { label: 'Purchases and suppliers', has: (p) => !PLANS[p].excluded.includes('purchases') },
  { label: 'Expenses', has: (p) => !PLANS[p].excluded.includes('expenses') },
  { label: 'Finance reports', has: (p) => !PLANS[p].excluded.includes('reports') },
  { label: 'Industry apps (farm, bakery, pharmacy, school, mart)', has: () => true },
]

const FAQ: [string, string][] = [
  ['Is there a free trial?', 'Yes. Every business gets 14 days free to try everything, and you do not need a card to start.'],
  ['What happens after the 14 days?', 'Your records stay exactly as they are; nothing is deleted when a trial ends. Online card payment is still being added, so for now a plan is arranged with the DOA team.'],
  ['Are prices per user?', 'No. A plan covers the whole business, up to the number of people and branches shown on the plan.'],
  ['I run more than one business. Do I pay once?', 'Each business has its own plan, records, staff and subscription, so a farm and a shop are priced separately.'],
  ['Can I change plan later?', 'Yes. A business can move to a bigger or smaller plan as it changes; the DOA team does this for you until self-service billing is ready.'],
  ['What do the plans leave out?', 'Starter does not include Purchases, Suppliers, Expenses or Finance reports. Basic adds all of those except reports. Growth and Business include everything.'],
]

export function PricingPage() {
  return (
    <div className="bg-white text-ink">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#f1f6fb] via-white to-white px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-20">
        <h1 className="anim-fade-up mx-auto max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">Simple <Mark>pricing</Mark></h1>
        <p className="anim-fade-up mx-auto mt-5 max-w-xl text-lg font-medium text-ink/70" style={{ '--d': '120ms' } as React.CSSProperties}>Start free for 14 days. Pick a plan when you are ready. One price covers the whole business.</p>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {ORDER.map((code, i) => {
            const plan = PLANS[code]; const hot = code === FEATURED; const price = PLAN_PRICES[code]
            return (
              <Reveal as="li" key={code} delay={i * 80}>
                <div className={`relative flex h-full flex-col rounded-2xl bg-white p-6 shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-raised ${hot ? 'ring-2 ring-amber' : 'ring-1 ring-ink/10'}`}>
                  {hot && <span className="absolute -top-3 left-6 rounded-full bg-amber px-3 py-0.5 text-xs font-bold">Most popular</span>}
                  <h2 className="text-lg font-bold">{plan.name}</h2>
                  <p className="mt-1 min-h-10 text-sm text-ink/60">{TAGLINE[code]}</p>
                  <p className="mt-5"><span className="tabular text-4xl font-extrabold">{price === 0 ? 'Free' : naira(price).replace(/\.00$/, '')}</span>{price > 0 && <span className="text-sm text-ink/60"> / month</span>}</p>
                  <ul className="mt-5 space-y-2 border-t border-line pt-5 text-sm">
                    <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />Up to <b>{plan.limits.maxMembers}</b> people</li>
                    <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{plan.limits.maxBranches === 1 ? <>One branch</> : <>Up to <b>{plan.limits.maxBranches}</b> branches</>}</li>
                    {FEATURES.map((f) => f.has(code)
                      ? <li key={f.label} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{f.label}</li>
                      : <li key={f.label} className="flex gap-2 text-ink/40"><Minus className="mt-0.5 size-4 shrink-0" aria-hidden />{f.label}</li>)}
                  </ul>
                  <Link to="/start" className={`mt-6 inline-flex h-11 items-center justify-center rounded-md text-sm font-bold transition hover:-translate-y-0.5 ${hot ? 'bg-amber text-ink shadow-card hover:bg-amber-dark' : 'bg-white text-ink ring-2 ring-amber hover:bg-amber/15'}`}>{price === 0 ? 'Start free' : 'Try it free for 14 days'}</Link>
                </div>
              </Reveal>
            )
          })}
        </ul>
        <p className="mt-6 text-center text-sm text-ink/60">Prices are in naira, per business, per month.</p>
      </section>

      <section className="bg-canvas px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <Reveal><h2 className="text-center text-3xl font-bold tracking-tight">Questions about <Mark>pricing</Mark></h2></Reveal>
          <div className="mt-8 divide-y divide-ink/10 rounded-xl bg-white shadow-card">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{q}<span aria-hidden className="text-xl leading-none text-ink/50 transition group-open:rotate-45">+</span></summary>
                <p className="mt-2 text-ink/70">{a}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-ink/70">More answers in the <Link to="/help" className="font-semibold underline">Help centre</Link>.</p>
        </div>
      </section>
      <SiteFooter />
    </div>
  )
}
