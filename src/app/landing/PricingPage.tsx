import { ArrowRight, BadgeCheck, Check, Minus, Receipt, ShieldCheck, Smartphone, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PLANS, PLAN_PRICES } from '@/core/subscriptions/plans'
import { naira } from '@/shared/utilities/format'
import type { PlanCode } from '@/shared/types/domain'
import { Mark } from './Mark'
import { Reveal } from './Reveal'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'
import { StoreBadges } from './StoreBadges'


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

const INCLUDED = [
  { icon: Receipt, title: 'Receipts and reports', text: 'Designed receipts and report cards that print or share.' },
  { icon: ShieldCheck, title: 'An honest history', text: 'Money and stock are kept as a record nobody can quietly edit.' },
  { icon: Smartphone, title: 'On your phone', text: 'Installs to the home screen and works on any phone.' },
  { icon: Users, title: 'No per-user fees', text: 'One price covers the whole business, up to the plan limits.' },
] as const

/** Which plan fits: the smallest plan that has room for the people and branches and includes the tools asked for. */
export function planFor(people: number, branches: number, needPurchases: boolean, needReports: boolean): PlanCode | null {
  return ORDER.find((c) => people <= PLANS[c].limits.maxMembers && branches <= PLANS[c].limits.maxBranches && (!needPurchases || !PLANS[c].excluded.includes('purchases')) && (!needReports || !PLANS[c].excluded.includes('reports'))) ?? null
}

function Picker({ people, setPeople, branches, setBranches, purchases, setPurchases, reports, setReports, fit }: { people: number; setPeople: (n: number) => void; branches: number; setBranches: (n: number) => void; purchases: boolean; setPurchases: (b: boolean) => void; reports: boolean; setReports: (b: boolean) => void; fit: PlanCode | null }) {
  return (
    <section className="mx-auto max-w-4xl px-4 pb-10 sm:px-6">
      <Reveal className="rounded-2xl bg-white p-6 shadow-raised ring-1 ring-ink/10 sm:p-8">
        <h2 className="text-xl font-bold tracking-tight">Which plan fits you?</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <label className="block text-sm font-semibold">How many people will use it? <b className="tabular ml-1 rounded-full bg-amber px-2 py-0.5">{people}</b>
            <input type="range" min={1} max={60} value={people} onChange={(e) => setPeople(Number(e.target.value))} className="mt-3 w-full accent-[var(--color-amber-dark)]" aria-label="People who will use it" /></label>
          <label className="block text-sm font-semibold">How many branches or locations? <b className="tabular ml-1 rounded-full bg-amber px-2 py-0.5">{branches}</b>
            <input type="range" min={1} max={12} value={branches} onChange={(e) => setBranches(Number(e.target.value))} className="mt-3 w-full accent-[var(--color-amber-dark)]" aria-label="Branches or locations" /></label>
        </div>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
          <label className="flex items-center gap-2"><input type="checkbox" checked={purchases} onChange={(e) => setPurchases(e.target.checked)} /> I buy from suppliers and track expenses</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={reports} onChange={(e) => setReports(e.target.checked)} /> I want finance reports</label>
        </div>
        <p role="status" className="mt-6 rounded-xl bg-canvas px-4 py-3 text-base">
          {fit ? <>You fit <b>{PLANS[fit].name}</b>, {PLAN_PRICES[fit] === 0 ? <b>free</b> : <b>{naira(PLAN_PRICES[fit]).replace(/\.00$/, '')} a month</b>}. <a href="#plans" className="font-bold underline decoration-amber decoration-2 underline-offset-4">See it below</a>.</> : <>That is bigger than our biggest plan. <Link to="/start" className="font-bold underline decoration-amber decoration-2 underline-offset-4">Start a trial</Link> and the DOA team will arrange something that fits.</>}
        </p>
      </Reveal>
    </section>
  )
}

export function PricingPage() {
  const [people, setPeople] = useState(3); const [branches, setBranches] = useState(1); const [purchases, setPurchases] = useState(false); const [reports, setReports] = useState(false)
  const fit = planFor(people, branches, purchases, reports)
  return (
    <div className="bg-white text-ink">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#f1f6fb] via-white to-white px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-20">
        <h1 className="anim-fade-up mx-auto max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">Simple <Mark>pricing</Mark></h1>
        <p className="anim-fade-up mx-auto mt-5 max-w-xl text-lg font-medium text-ink/70" style={{ '--d': '120ms' } as React.CSSProperties}>Start free for 14 days. Pick a plan when you are ready. One price covers the whole business.</p>
      </section>

      <Picker people={people} setPeople={setPeople} branches={branches} setBranches={setBranches} purchases={purchases} setPurchases={setPurchases} reports={reports} setReports={setReports} fit={fit} />

      <section id="plans" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-16 sm:px-6">
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {ORDER.map((code, i) => {
            const plan = PLANS[code]; const hot = code === (fit ?? FEATURED); const price = PLAN_PRICES[code]
            return (
              <Reveal as="li" key={code} delay={i * 80}>
                <div className={`relative flex h-full flex-col rounded-2xl bg-white p-6 shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-raised ${hot ? 'ring-2 ring-amber' : 'ring-1 ring-ink/10'}`}>
                  {hot && <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-amber px-3 py-0.5 text-xs font-bold">{fit ? <><BadgeCheck className="size-3.5" aria-hidden /> Fits you</> : 'Most popular'}</span>}
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

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <Reveal><h2 className="text-center text-2xl font-bold tracking-tight">Every plan <Mark>includes</Mark></h2></Reveal>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{INCLUDED.map((x, i) => <Reveal as="li" key={x.title} delay={i * 80}><div className="h-full rounded-2xl bg-white p-5 shadow-card ring-1 ring-ink/10"><span className="grid size-10 place-items-center rounded-xl bg-brand text-white"><x.icon className="size-5" aria-hidden /></span><h3 className="mt-3 font-bold">{x.title}</h3><p className="mt-1 text-sm text-ink/70">{x.text}</p></div></Reveal>)}</ul>
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
      <section className="px-4 pb-20 pt-4 sm:px-6">
        <Reveal className="anim-gradient relative mx-auto max-w-4xl overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-[#0f3a66] to-brand px-6 py-12 text-center text-white sm:px-12">
          <span aria-hidden className="absolute -right-10 -top-16 size-56 rounded-full bg-mint/25 blur-3xl" />
          <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">Start free. <span className="text-amber">Decide later.</span></h2>
          <p className="relative mx-auto mt-3 max-w-md text-white/80">Fourteen days of everything, no card needed. Your records stay when the trial ends.</p>
          <Link to="/start" className="relative mt-7 inline-flex h-12 items-center rounded-md bg-amber px-7 text-base font-bold text-ink transition duration-200 hover:-translate-y-0.5 hover:bg-amber-dark hover:shadow-raised">Try it free<ArrowRight className="ml-2 size-5" aria-hidden /></Link>
          <div className="relative mt-8 flex justify-center"><StoreBadges dark /></div>
        </Reveal>
      </section>
      <SiteFooter />
    </div>
  )
}
