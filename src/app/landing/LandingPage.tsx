import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BrandLockup } from '@/app/layouts/Brand'
import { industryColor, landingApps } from '@/app/navigation/navigation'
import type { LandingApp } from '@/app/navigation/navigation'
import { listIndustries } from '@/core/industry-registry'
import { Badge } from '@/shared/components'
import type { CSSProperties } from 'react'
import { HeroBackdrop } from './HeroBackdrop'
import { Mark } from './Mark'
import { Reveal } from './Reveal'
import { SiteHeader } from './SiteHeader'

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

const primaryBtn = 'inline-flex h-12 items-center justify-center rounded-md bg-amber px-6 text-base font-bold text-ink shadow-card transition duration-200 hover:-translate-y-0.5 hover:bg-amber-dark hover:shadow-raised active:translate-y-0'
const quietBtn = 'inline-flex h-12 items-center justify-center rounded-md bg-white/80 px-6 text-base font-semibold text-ink ring-2 ring-amber transition duration-200 hover:-translate-y-0.5 hover:bg-amber/15 hover:shadow-card active:translate-y-0'

/** One app per row: the words on one side and a real screenshot of the page on the other, alternating, with a line between rows. */
function AppRow({ app, index, to }: { app: LandingApp; index: number; to: string }) {
  const flip = index % 2 === 1
  return (
    <li className="border-t border-ink/15 first:border-t-0">
      <div className="grid items-center gap-6 py-9 md:grid-cols-12 md:gap-10">
        <Reveal className={`md:col-span-5 ${flip ? 'md:order-2' : ''}`}>
          <span className="grid size-12 place-items-center rounded-xl text-white" style={{ background: app.color }}><app.icon className="size-6" aria-hidden strokeWidth={1.75} /></span>
          <h4 className="mt-4 text-2xl font-bold tracking-tight">{app.label}</h4>
          <p className="mt-3 max-w-md text-base font-medium text-ink/70 sm:text-lg">{app.blurb}</p>
          <Link to={to} className="group mt-6 inline-flex items-center gap-2 text-sm font-bold text-ink underline decoration-amber decoration-2 underline-offset-4">Start with {app.label}<ArrowRight className="size-4 transition duration-300 group-hover:translate-x-1" aria-hidden /></Link>
        </Reveal>
        <Reveal delay={120} className={`md:col-span-7 ${flip ? 'md:order-1' : ''}`}>
          <div className="overflow-hidden rounded-xl bg-white shadow-raised ring-1 ring-ink/10 transition duration-500 hover:-translate-y-1">
            <div className="flex items-center gap-1.5 border-b border-line bg-surface px-3 py-2" aria-hidden><span className="size-2.5 rounded-full bg-[#ff5f57]" /><span className="size-2.5 rounded-full bg-[#febc2e]" /><span className="size-2.5 rounded-full bg-[#28c840]" /></div>
            <img src={`/screens/${app.id}.jpg`} alt={`The ${app.label} page in DOA`} loading="lazy" width={1366} height={599} className="block aspect-[1366/560] w-full object-cover object-top" />
          </div>
        </Reveal>
      </div>
    </li>
  )
}

/** The public front door. "Try it free" opens the business picker. */
export function LandingPage() {
  const { shared, industries } = landingApps()
  const businessApps = shared

  return (
    <div className="bg-white text-ink">
      <SiteHeader />

      <section className="relative isolate overflow-hidden bg-gradient-to-b from-[#f1f6fb] via-white to-white px-4 pb-24 pt-16 text-center sm:px-6 sm:pb-32 sm:pt-24">
        <HeroBackdrop />
        <h1 aria-label="All your business on one platform." className="relative mx-auto max-w-4xl text-5xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl lg:text-7xl">
          {['All', 'your', 'business', 'on'].map((w, i) => <span key={w} aria-hidden className="word-mask mr-[0.25em]"><span style={d(80 + i * 90)}>{w}</span></span>)}
          <span aria-hidden className="relative whitespace-nowrap"><span className="anim-marker absolute -inset-x-2 inset-y-1 -z-0 -rotate-1 rounded-xl bg-[#fbb130]" style={d(900)} /><span className="word-mask relative"><span style={d(450)}>one platform.</span></span></span>
        </h1>
        <p className="anim-fade-up relative mx-auto mt-8 max-w-2xl text-xl font-medium text-ink/80 sm:text-2xl" style={d(220)}>
          Shops, farms, bakeries, pharmacies and schools, each with{' '}
          <span className="relative whitespace-nowrap"><span className="relative z-10 font-bold text-ink">its own books</span><span aria-hidden className="anim-marker absolute inset-x-0 bottom-0 h-3 rounded-sm bg-amber/70" style={d(1100)} /></span>
          , under one login.
        </p>
        <div className="anim-fade-up relative mx-auto mt-10 flex w-fit flex-wrap items-center justify-center gap-3" style={d(380)}>
          <Link to="/start" className={primaryBtn}>Start now, it&apos;s free</Link>
          <a href="#apps" className={quietBtn}>See the apps</a>
        </div>
        <p className="anim-fade-up relative mt-6 text-sm font-semibold text-ink/70" style={d(520)}>14-day free trial on every business</p>
      </section>

      <div className="relative -mt-px bg-canvas pb-20 pt-20" style={{ borderTopLeftRadius: '50% 7rem', borderTopRightRadius: '50% 7rem' }}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal as="section" className="text-center">
            <span id="apps" className="relative -top-28 block h-0" />
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Choose your <Mark>apps</Mark></h2>
            <p className="mx-auto mt-4 max-w-xl text-base font-medium text-ink/80">Everything a growing business needs, ready the moment you sign up.</p>
          </Reveal>

          <Reveal><h3 className="mb-3 mt-10 text-xl font-bold">Business apps</h3></Reveal>
          <ul className="mt-2">{businessApps.map((a, i) => <AppRow key={a.id} app={a} index={i} to="/start" />)}</ul>
          <Reveal><h3 className="mb-3 mt-10 text-xl font-bold">Industry apps</h3></Reveal>
          <ul className="mt-2">{industries.map((a, i) => <AppRow key={a.id} app={a} index={i} to={`/start?type=${a.id}`} />)}</ul>

          <section id="industries" className="mt-24 scroll-mt-24">
            <Reveal>
              <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Built for your <Mark>kind of business</Mark></h2>
              <p className="mx-auto mt-4 max-w-xl text-center text-base font-medium text-ink/80">Pick a starting point. Run more than one business? Pick them all.</p>
            </Reveal>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {listIndustries().map((dfn, i) => {
                const soon = dfn.status !== 'active'
                const card = (
                  <span className={`group flex h-full items-center gap-4 rounded-lg bg-white p-5 shadow-card ${soon ? 'opacity-60' : 'transition duration-300 hover:-translate-y-1 hover:shadow-raised'}`}>
                    <span className="grid size-12 shrink-0 place-items-center rounded-lg text-white transition duration-300 group-hover:-rotate-3 group-hover:scale-110" style={{ background: industryColor(dfn.id) }}><dfn.icon className="size-6" aria-hidden strokeWidth={1.75} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-lg font-semibold">{dfn.name}{soon && <Badge>Coming soon</Badge>}{!soon && dfn.modules.some((m) => m.maturity === 'preview') && <Badge tone="info">Preview</Badge>}</span>
                      <span className="mt-0.5 block text-sm text-ink/60">{dfn.description}</span>
                    </span>
                    {!soon && <ArrowRight className="size-5 shrink-0 text-brand transition duration-300 group-hover:translate-x-1" aria-hidden />}
                  </span>
                )
                return <Reveal as="li" key={dfn.id} delay={(i % 2) * 90}>{soon ? card : <Link to={`/start?type=${dfn.id}`} aria-label={`Start with ${dfn.name}`}>{card}</Link>}</Reveal>
              })}
            </ul>
          </section>

          <section id="why" className="mt-24 scroll-mt-24">
            <Reveal><h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Why <Mark>DOA</Mark></h2></Reveal>
            <dl className="mt-10 grid gap-10 sm:grid-cols-3">
              <Reveal><dt className="text-lg font-bold">One login, <Mark>separate books</Mark></dt><dd className="mt-2 text-ink/70">Create a farm, a bakery, a shop, a pharmacy or a school under one account. Each has its own records, staff, modules and subscription, and none can see another.</dd></Reveal>
              <Reveal delay={100}><dt className="text-lg font-bold">Numbers you can <Mark>trust</Mark></dt><dd className="mt-2 text-ink/70">Stock, sales and payments are recorded as an unchangeable history. Mistakes are corrected with new entries, never erased, and every important change is logged.</dd></Reveal>
              <Reveal delay={200}><dt className="text-lg font-bold">Only what your business <Mark>needs</Mark></dt><dd className="mt-2 text-ink/70">A farm sees farm tools, a shop sees the till. Staff see only what their role allows, and unused modules stay out of the way.</dd></Reveal>
            </dl>
          </section>

          <Reveal as="section" className="anim-gradient relative mt-24 overflow-hidden rounded-2xl bg-gradient-to-r from-brand via-[#0f3a66] to-brand px-6 py-14 text-center text-white sm:px-12">
            <span aria-hidden className="absolute -right-10 -top-16 size-56 rounded-full bg-mint/25 blur-3xl" />
            <span aria-hidden className="absolute -bottom-16 -left-10 size-56 rounded-full bg-[#fbb130]/20 blur-3xl" />
            <h2 className="relative text-3xl font-bold tracking-tight sm:text-4xl">Ready to <span className="text-amber">try it</span>?</h2>
            <p className="relative mx-auto mt-3 max-w-lg text-white/80">Pick your business type, name it, and you are in. The first 14 days are free.</p>
            <Link to="/start" className="relative mt-8 inline-flex h-12 items-center rounded-md bg-amber px-7 text-base font-bold text-ink transition duration-200 hover:-translate-y-0.5 hover:bg-amber-dark hover:shadow-raised active:translate-y-0">Try it free</Link>
          </Reveal>
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
