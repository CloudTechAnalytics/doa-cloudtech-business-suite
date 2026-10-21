import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BrandLockup } from '@/app/layouts/Brand'
import { industryColor, landingApps } from '@/app/navigation/navigation'
import type { LandingApp } from '@/app/navigation/navigation'
import { listIndustries } from '@/core/industry-registry'
import { Badge } from '@/shared/components'
import { SiteHeader } from './SiteHeader'


const primaryBtn = 'inline-flex h-12 items-center justify-center rounded-md bg-brand px-6 text-base font-semibold text-white shadow-card transition-colors hover:bg-brand-dark'
const quietBtn = 'inline-flex h-12 items-center justify-center rounded-md bg-canvas px-6 text-base font-semibold text-ink/80 transition-colors hover:bg-line'

function AppCard({ app }: { app: LandingApp }) {
  return (
    <li className="flex items-center gap-3 rounded-lg bg-white p-4 shadow-card">
      <span className="grid size-11 shrink-0 place-items-center rounded-lg text-white" style={{ background: app.color }}><app.icon className="size-6" aria-hidden strokeWidth={1.75} /></span>
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{app.label}</span>
        <span className="block text-sm text-ink/60">{app.blurb}</span>
      </span>
    </li>
  )
}

/** The public front door. "Try it free" opens the business picker. */
export function LandingPage() {
  const { shared, industries } = landingApps()
  // Finance (expenses and reports) is registered but its screens are not built, so it is not advertised.
  const businessApps = shared.filter((a) => a.id !== 'finance')

  return (
    <div className="bg-white text-ink">
      <SiteHeader />

      <section className="px-4 pb-24 pt-16 text-center sm:px-6 sm:pt-24">
        <h1 className="mx-auto max-w-4xl text-5xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl lg:text-7xl">
          All your business on{' '}
          <span className="relative whitespace-nowrap"><span aria-hidden className="absolute -inset-x-2 inset-y-1 -z-0 -rotate-1 rounded-xl bg-[#fbb130]" /><span className="relative">one platform</span></span>.
        </h1>
        <p className="mx-auto mt-8 max-w-2xl text-xl font-medium text-ink/80 sm:text-2xl">
          Shops, farms and bakeries, each with{' '}
          <span className="relative whitespace-nowrap"><span className="relative z-10">its own books</span><span aria-hidden className="absolute -bottom-1 left-0 h-1 w-full rounded-full bg-[#1bb6f9]" /></span>
          , under one login.
        </p>
        <div className="relative mx-auto mt-10 flex w-fit flex-wrap items-center justify-center gap-3">
          <Link to="/start" className={primaryBtn}>Start now, it&apos;s free</Link>
          <a href="#apps" className={quietBtn}>See the apps</a>
          <p className="absolute left-full top-9 ml-3 hidden w-44 -rotate-3 text-left text-sm font-semibold text-brand xl:block">
            14-day free trial on every business
            <svg viewBox="0 0 60 30" className="-mt-1 -ml-9 h-8 w-14 -scale-x-100 text-brand" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M58 4C44 2 28 8 12 24m0 0 1-12m-1 12 12-2" /></svg>
          </p>
        </div>
      </section>

      <div className="bg-canvas pb-20 pt-20" style={{ borderTopLeftRadius: '50% 7rem', borderTopRightRadius: '50% 7rem' }}>
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <section id="apps" className="scroll-mt-24 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Choose your <span className="relative inline-block">apps<span aria-hidden className="absolute -bottom-1 left-0 h-1.5 w-full rounded-full bg-mint" /></span></h2>
            <p className="mx-auto mt-4 max-w-xl text-base font-medium text-ink/80">Everything a growing business needs, ready the moment you sign up.</p>
          </section>

          <h3 className="mb-3 mt-10 text-xl font-bold">Business apps</h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{businessApps.map((a) => <AppCard key={a.id} app={a} />)}</ul>
          <h3 className="mb-3 mt-10 text-xl font-bold">Industry apps</h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{industries.map((a) => <AppCard key={a.id} app={a} />)}</ul>

          <section id="industries" className="mt-24 scroll-mt-24">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Built for your kind of business</h2>
            <p className="mx-auto mt-4 max-w-xl text-center text-base font-medium text-ink/80">Pick a starting point. Run more than one business? Pick them all.</p>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {listIndustries().map((d) => {
                const soon = d.status !== 'active'
                const card = (
                  <span className={`flex h-full items-center gap-4 rounded-lg bg-white p-5 shadow-card ${soon ? 'opacity-60' : 'transition hover:shadow-raised'}`}>
                    <span className="grid size-12 shrink-0 place-items-center rounded-lg text-white" style={{ background: industryColor(d.id) }}><d.icon className="size-6" aria-hidden strokeWidth={1.75} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-lg font-semibold">{d.name}{soon && <Badge>Coming soon</Badge>}{!soon && d.modules.some((m) => m.maturity === 'preview') && <Badge tone="info">Preview</Badge>}</span>
                      <span className="mt-0.5 block text-sm text-ink/60">{d.description}</span>
                    </span>
                    {!soon && <ArrowRight className="size-5 shrink-0 text-brand" aria-hidden />}
                  </span>
                )
                return <li key={d.id}>{soon ? card : <Link to={`/start?type=${d.id}`} aria-label={`Start with ${d.name}`}>{card}</Link>}</li>
              })}
            </ul>
          </section>

          <section id="why" className="mt-24 scroll-mt-24">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Why DOA B-Suite</h2>
            <dl className="mt-10 grid gap-10 sm:grid-cols-3">
              <div><dt className="text-lg font-bold">One login, separate books</dt><dd className="mt-2 text-ink/70">Create a farm, a bakery and a shop under one account. Each has its own records, staff, modules and subscription, and none can see another.</dd></div>
              <div><dt className="text-lg font-bold">Numbers you can trust</dt><dd className="mt-2 text-ink/70">Stock, sales and payments are recorded as an unchangeable history. Mistakes are corrected with new entries, never erased, and every important change is logged.</dd></div>
              <div><dt className="text-lg font-bold">Only what your business needs</dt><dd className="mt-2 text-ink/70">A farm sees farm tools, a shop sees the till. Staff see only what their role allows, and unused modules stay out of the way.</dd></div>
            </dl>
          </section>

          <section className="mt-24 rounded-2xl bg-brand px-6 py-14 text-center text-white sm:px-12">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready to try it?</h2>
            <p className="mx-auto mt-3 max-w-lg text-white/80">Pick your business type, name it, and you are in. The first 14 days are free.</p>
            <Link to="/start" className="mt-8 inline-flex h-12 items-center rounded-md bg-white px-7 text-base font-semibold text-brand hover:bg-white/90">Try it free</Link>
          </section>
        </div>
      </div>

      <footer className="bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-ink/60 sm:px-6">
          <BrandLockup />
          <span>&copy; {new Date().getFullYear()} CloudTech Analytics</span>
          <span className="flex gap-5"><Link to="/sign-in" className="hover:text-ink">Sign in</Link><Link to="/start" className="hover:text-ink">Try it free</Link></span>
        </div>
      </footer>
    </div>
  )
}
