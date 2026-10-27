import { ArrowRight, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { STANDALONE_APPS } from '@/core/app-catalogue/apps'
import { Mark } from './Mark'
import { Reveal } from './Reveal'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

/** The standalone apps, each usable on its own with no industry. Industry apps have their own section of the site. */
export function AppsPage() {
  return (
    <div className="bg-white text-ink">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#f1f6fb] via-white to-white px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-20">
        <h1 className="anim-fade-up mx-auto max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">Start with one <Mark>useful app</Mark></h1>
        <p className="anim-fade-up mx-auto mt-5 max-w-2xl text-lg font-medium text-ink/70" style={{ '--d': '120ms' } as React.CSSProperties}>Use DOA CRM, POS, Inventory, Invoices, Expenses and Finance on their own, with no industry to choose. Add more when you need them, and switch on an industry app when your business needs one. Your records stay put.</p>
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {STANDALONE_APPS.map((a, i) => (
            <li key={a.id}>
              <Reveal delay={i * 60} className="flex h-full flex-col rounded-2xl bg-white p-6 shadow-card ring-1 ring-ink/10">
                <span className="grid size-12 place-items-center rounded-xl text-white" style={{ background: a.color }}><a.icon className="size-6" aria-hidden /></span>
                <h2 className="mt-4 text-xl font-bold">{a.name}</h2>
                <p className="text-sm font-medium text-ink/60">{a.tagline}</p>
                <p className="mt-3 text-sm text-ink/80">{a.description}</p>
                <ul className="mt-3 space-y-1.5 text-sm text-ink/80">{a.benefits.map((b) => <li key={b} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{b}</li>)}</ul>
                <p className="mt-3 text-xs font-semibold text-ink/60">{a.free}</p>
                <Link to="/start?type=general" className="mt-auto inline-flex pt-4 text-sm font-semibold text-accent hover:underline">Start with {a.name.replace('DOA ', '')}<ArrowRight className="ml-1 size-4" aria-hidden /></Link>
              </Reveal>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-center text-sm text-ink/70">Running a farm, bakery, pharmacy, shop or school? See the <Link to="/#industries" className="font-semibold underline">industry apps</Link>. <Link to="/pricing" className="font-semibold underline">Pricing</Link> is per business, not per user.</p>
      </section>
      <SiteFooter />
    </div>
  )
}
