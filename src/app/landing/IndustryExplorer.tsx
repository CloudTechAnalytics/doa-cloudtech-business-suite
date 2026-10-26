import { ArrowRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { industryColor, landingApps } from '@/app/navigation/navigation'
import { getIndustry, listIndustries } from '@/core/industry-registry'
import { Mark } from './Mark'
import { IPhone } from './phones/PhoneFrame'
import { ScreenStack } from './phones/ScreenStack'
import { INDUSTRY_SCREEN } from './phones/screens'
import { useCycle } from './phones/hooks'
import { Reveal } from './Reveal'

/**
 * Instead of a long list of apps, one picker: choose your kind of business and the phone beside it switches to that business's app, with what it includes and a button to
 * start with it. It also steps through them by itself until you take over.
 */
export function IndustryExplorer() {
  const industries = listIndustries()
  const active = industries.filter((x) => x.status === 'active')
  const ref = useRef<HTMLDivElement>(null)
  const [auto, setAuto] = useCycle(active.length, 5200, ref)
  const [picked, setPicked] = useState<number | null>(null)
  const index = picked ?? auto
  const cur = active[index]
  const modules = getIndustry(cur.id).modules.filter((m) => !m.maturity || m.maturity !== 'soon').slice(0, 9)
  const ids = active.map((x) => INDUSTRY_SCREEN[x.id] ?? 'dashboard')
  return (
    <section id="apps" className="scroll-mt-24">
      <span id="industries" className="relative -top-24 block h-0" />
      <Reveal className="text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Pick your business, <Mark>get your app</Mark></h2>
        <p className="mx-auto mt-4 max-w-xl text-base font-medium text-ink/80">Each kind of business gets its own screens and words. Run more than one? Each has its own books, under one login.</p>
      </Reveal>
      <div ref={ref} className="mt-10 grid grid-cols-[minmax(0,1fr)] items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-14">
        <div className="min-w-0">
          <div role="tablist" aria-label="Kind of business" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            {industries.map((x) => {
              const soon = x.status !== 'active'; const i = active.findIndex((a) => a.id === x.id); const on = !soon && i === index
              return (
                <button key={x.id} role="tab" aria-selected={on} disabled={soon} onClick={() => { setPicked(i); setAuto(i) }}
                  className={`flex shrink-0 items-center gap-2 rounded-full py-2 pl-2 pr-4 text-sm font-bold transition duration-300 ${on ? 'bg-ink text-white shadow-raised' : soon ? 'bg-white/60 text-ink/40 ring-1 ring-ink/10' : 'bg-white text-ink ring-1 ring-ink/15 hover:-translate-y-0.5 hover:shadow-card'}`}>
                  <span className="grid size-7 place-items-center rounded-full text-white" style={{ background: soon ? '#9aa5b1' : industryColor(x.id) }}><x.icon className="size-4" aria-hidden /></span>
                  {x.name}{soon && <span className="rounded-full bg-ink/10 px-1.5 py-px text-[9px] font-bold uppercase">Soon</span>}
                </button>
              )
            })}
          </div>
          <div key={cur.id} className="anim-fade-up mt-8 rounded-2xl bg-white p-6 shadow-card ring-1 ring-ink/10 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: industryColor(cur.id) }}>{cur.appName ?? cur.name}</p>
            <h3 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{cur.name}</h3>
            <p className="mt-2 text-base text-ink/70">{cur.description}</p>
            <p className="mt-5 text-xs font-bold uppercase tracking-wide text-ink/50">What is inside</p>
            <ul className="mt-2 flex flex-wrap gap-2">{modules.map((m) => <li key={m.code} className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold text-ink/80"><m.icon className="size-3.5" aria-hidden style={{ color: industryColor(cur.id) }} />{m.name}</li>)}</ul>
            <Link to={`/start?type=${cur.id}`} className="group mt-7 inline-flex items-center gap-2 rounded-md bg-amber px-5 py-3 text-base font-bold text-ink shadow-card transition duration-200 hover:-translate-y-0.5 hover:bg-amber-dark hover:shadow-raised">Start with {cur.name}<ArrowRight className="size-4 transition duration-300 group-hover:translate-x-1" aria-hidden /></Link>
          </div>
        </div>
        <div className="relative mx-auto">
          <div aria-hidden className="absolute left-1/2 top-1/2 size-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-3xl transition-colors duration-700 max-sm:size-[14rem]" style={{ background: industryColor(cur.id) }} />
          <div className="relative"><IPhone label={`The ${cur.name} app on an iPhone`}><ScreenStack ids={ids} active={index} /></IPhone></div>
        </div>
      </div>
    </section>
  )
}

/** The apps every business gets, whatever its kind. */
export function SharedApps() {
  const { shared } = landingApps()
  return (
    <section className="mt-24">
      <Reveal className="text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Included in <Mark>every business</Mark></h2>
        <p className="mx-auto mt-4 max-w-xl text-base font-medium text-ink/80">The everyday tools, ready the moment you sign up.</p>
      </Reveal>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shared.map((a, i) => (
          <Reveal as="li" key={a.id} delay={(i % 3) * 90}>
            <div className="group h-full rounded-2xl bg-white p-6 shadow-card ring-1 ring-ink/10 transition duration-300 hover:-translate-y-1.5 hover:shadow-raised">
              <span className="grid size-12 place-items-center rounded-xl text-white transition duration-300 group-hover:-rotate-6 group-hover:scale-110" style={{ background: a.color }}><a.icon className="size-6" aria-hidden strokeWidth={1.75} /></span>
              <h3 className="mt-4 text-xl font-bold">{a.label}</h3>
              <p className="mt-1.5 text-base text-ink/70">{a.blurb}</p>
            </div>
          </Reveal>
        ))}
      </ul>
    </section>
  )
}
