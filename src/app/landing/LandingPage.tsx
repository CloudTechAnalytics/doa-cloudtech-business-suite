import { ArrowRight, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { HeroBackdrop } from './HeroBackdrop'
import { HowItWorks } from './HowItWorks'
import { IndustryExplorer, SharedApps } from './IndustryExplorer'
import { Mark } from './Mark'
import { MobileApps } from './MobileApps'
import { PhoneShowcase } from './phones/PhoneShowcase'
import { Reveal } from './Reveal'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'
import { InstallNote, StoreBadges } from './StoreBadges'

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

const primaryBtn = 'inline-flex h-12 items-center justify-center rounded-md bg-amber px-6 text-base font-bold text-ink shadow-card transition duration-200 hover:-translate-y-0.5 hover:bg-amber-dark hover:shadow-raised active:translate-y-0'
const quietBtn = 'inline-flex h-12 items-center justify-center rounded-md bg-white/80 px-6 text-base font-semibold text-ink ring-2 ring-amber transition duration-200 hover:-translate-y-0.5 hover:bg-amber/15 hover:shadow-card active:translate-y-0'

const FACTS = [['14 days', 'free on every business'], ['5 kinds', 'of business, one login'], ['₦', 'Naira and receipts built in'], ['Any phone', 'installs like an app']] as const

/** The public front door: a hero with two phones running the app, how it works, a picker for your kind of business, the mobile apps, and why DOA. */
export function LandingPage() {
  return (
    <div className="bg-white text-ink">
      <SiteHeader />

      <section className="relative isolate overflow-hidden bg-gradient-to-b from-[#f1f6fb] via-white to-white px-4 pb-20 pt-12 sm:px-6 sm:pb-28 sm:pt-16 lg:pt-20">
        <HeroBackdrop />
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6">
          <div className="text-center lg:text-left">
            <p className="anim-fade-up inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-sm font-bold text-ink shadow-card ring-1 ring-ink/10" style={d(60)}><Sparkles className="size-4 text-amber" aria-hidden /> New: online schools with their own courses</p>
            <h1 aria-label="Every business you run. One app." className="relative mt-6 text-5xl font-extrabold leading-[1.06] tracking-tight sm:text-6xl xl:text-7xl">
              {['Every', 'business', 'you', 'run.'].map((w, i) => <span key={w} aria-hidden className="word-mask mr-[0.25em]"><span style={d(80 + i * 90)}>{w}</span></span>)}
              <br className="hidden sm:block" />
              <span aria-hidden className="relative whitespace-nowrap"><span className="anim-marker absolute -inset-x-2 inset-y-1 -z-0 -rotate-1 rounded-xl bg-[#fbb130]" style={d(900)} /><span className="word-mask relative"><span style={d(450)}>One app.</span></span></span>
            </h1>
            <p className="anim-fade-up mx-auto mt-7 max-w-xl text-xl font-medium text-ink/80 lg:mx-0 sm:text-2xl" style={d(220)}>
              Sell, stock, record and get paid. Shops, farms, bakeries, pharmacies and schools, each with <span className="relative whitespace-nowrap"><span className="relative z-10 font-bold text-ink">its own books</span><span aria-hidden className="anim-marker absolute inset-x-0 bottom-0 h-3 rounded-sm bg-amber/70" style={d(1100)} /></span>, under one login.
            </p>
            <div className="anim-fade-up mt-9 flex flex-wrap items-center justify-center gap-3 lg:justify-start" style={d(380)}>
              <Link to="/start" className={primaryBtn}>Start free for 14 days<ArrowRight className="ml-2 size-5" aria-hidden /></Link>
              <a href="#how" className={quietBtn}>See how it works</a>
            </div>
            <div className="anim-fade-up mt-8 flex flex-col items-center gap-3 lg:items-start" style={d(520)}>
              <StoreBadges />
              <p className="text-sm font-semibold text-ink/70"><InstallNote /></p>
            </div>
            <dl className="anim-fade-up mt-10 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-ink/10 pt-6 sm:grid-cols-4" style={d(640)}>
              {FACTS.map(([big, small]) => <div key={big}><dt className="text-2xl font-extrabold tracking-tight">{big}</dt><dd className="text-sm font-medium text-ink/65">{small}</dd></div>)}
            </dl>
          </div>
          <PhoneShowcase />
        </div>
      </section>

      <div className="relative -mt-px bg-canvas pb-20 pt-24" style={{ borderTopLeftRadius: '50% 7rem', borderTopRightRadius: '50% 7rem' }}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <HowItWorks />
          <div className="mt-28"><IndustryExplorer /></div>
          <SharedApps />
          <MobileApps />

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

      <SiteFooter />
    </div>
  )
}
