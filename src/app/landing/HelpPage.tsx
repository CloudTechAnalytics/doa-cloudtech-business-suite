import { ArrowRight, BookOpen, Building2, GraduationCap, Package, Search, ShieldCheck, ShoppingCart, Smartphone, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mark } from './Mark'
import { Reveal } from './Reveal'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'
import { StoreBadges } from './StoreBadges'

interface Topic { id: string; title: string; blurb: string; icon: LucideIcon; color: string; articles: { q: string; a: string }[] }

/** Help articles are plain data so they are easy to add to. Keep every answer true to what the product does today. */
const TOPICS: Topic[] = [
  { id: 'start', title: 'Getting started', blurb: 'Create an account and your first business.', icon: BookOpen, color: '#1c7ed6', articles: [
    { q: 'How do I start?', a: 'Choose Try it free, pick the kind of business (shop, farm, bakery, pharmacy or school), give it a name and you are in. The first 14 days are free.' },
    { q: 'Can I run more than one business?', a: 'Yes. One login can own a farm, a shop and a school. Each has its own records, staff and subscription, and none can see another. Switch between them from the business name at the top of the app.' },
    { q: 'Which apps do I get?', a: 'The shared apps (Sales, CRM, Inventory, Purchase, Finance, Staff) plus the apps for your kind of business. Apps your business does not need stay out of the way.' },
    { q: 'Can I use DOA on my phone?', a: 'Yes. Open DOA in Chrome on Android and choose Install app, or in Safari on iPhone tap Share, then Add to Home Screen. It opens full screen like any other app. Native Google Play and App Store apps are on the way.' },
    { q: 'I made a mistake in a record. Can I edit it?', a: 'Money and stock are never edited after they are recorded. You fix a mistake with a correction, a return or a reversal, so there is always an honest history.' },
  ] },
  { id: 'sales', title: 'Sales and customers', blurb: 'Selling, receipts, credit and your customer list.', icon: ShoppingCart, color: '#2f9e44', articles: [
    { q: 'How do I make a sale?', a: 'Open Sales, tap the products, choose how the customer pays and complete the sale. The server works out the final prices and takes the stock out for you.' },
    { q: 'Can a customer pay part now and the rest later?', a: 'Yes. Enter the amount paid; what is left shows as what the customer owes, on their profile.' },
    { q: 'Where do I see everything about a customer?', a: 'Open the customer from CRM. Their page shows what they bought, what they owe, notes and follow-ups.' },
    { q: 'How do I deal with a return?', a: 'Open the sale in History and record the return. Stock goes back and the money is refunded as a new entry.' },
  ] },
  { id: 'stock', title: 'Stock and purchases', blurb: 'Products, counts, suppliers and what you owe.', icon: Package, color: '#e8590c', articles: [
    { q: 'How do I add stock?', a: 'Use Receive stock on the Products or Inventory page, or receive goods against a purchase order. Stock only changes through these steps, never by typing a new number.' },
    { q: 'What is a stock count?', a: 'A count compares what you physically have with what the system says. A manager approves it, and the difference is recorded as an adjustment.' },
    { q: 'How do I record damaged or expired goods?', a: 'Use Damaged & Expired. The goods leave your stock and the loss is recorded with the reason.' },
    { q: 'Where do I see what I owe suppliers?', a: 'On the Suppliers page and in Reports. Orders, deliveries and payments are on the Purchases page.' },
  ] },
  { id: 'industries', title: 'Farm, bakery and pharmacy', blurb: 'Apps built for these businesses.', icon: Building2, color: '#7048e8', articles: [
    { q: 'What does the farm app do?', a: 'It tracks batches of animals or crops, feeding, mortality, harvests, health and equipment, and shows live animals and losses on the dashboard.' },
    { q: 'What does the bakery app do?', a: 'It keeps recipes, records production batches, takes ingredients out of stock, tracks waste and shows the cost of what you bake.' },
    { q: 'How does the pharmacy app handle expiry?', a: 'Every medicine has batches with expiry dates and sells the earliest expiry first. Expired, quarantined or undated batches cannot be sold. Prescription-only medicines go through a prescription and a pharmacist.' },
    { q: 'Is there a shop (Mart) app?', a: 'Yes. Mart adds products with packs and barcodes, cashier shifts, stock counts, supplier returns and reports.' },
  ] },
  { id: 'school', title: 'Schools', blurb: 'Students, attendance, results and fees.', icon: GraduationCap, color: '#7048e8', articles: [
    { q: 'How do I set up a school?', a: 'Open School Settings and choose Start from the standard structure. It creates classes for your kind of school, three terms, subjects, a grading scale and marks. You can change all of it afterwards.' },
    { q: 'How do teachers and parents sign in?', a: 'Invite them under Staff with the Teacher or Parent role, using the email recorded on their staff or guardian record. They are matched to their records the first time they open the school.' },
    { q: 'What is an online school?', a: 'A kind of school that offers courses instead of classes. You add the courses you offer, each with a description and duration, and the units inside them. Learners enrol in a course, and the school runs in cohorts (intakes) instead of terms.' },
    { q: 'How do I register many students at once?', a: 'On the Students page choose Import CSV, download the template, fill it in and upload it. Rows with a problem are skipped and explained; the rest are registered. The same file imported twice never registers anyone twice.' },
    { q: 'How do I print receipts, report cards and ID cards?', a: 'Open the receipt, report card or student and use Print. Report cards can be printed for a whole class from Results, and ID cards for a whole list from Students. Each student can have a passport photo that appears on the ID card and report card.' },
    { q: 'Who sees results?', a: 'Teachers enter scores, the principal approves and publishes them, and parents only ever see published results for their own children.' },
    { q: 'How do school fees work?', a: 'Set up the fees, make bills for the term, and record payments against each bill. A payment can never be more than what is owed. A wrong payment is reversed, not edited.' },
  ] },
  { id: 'people', title: 'Staff and access', blurb: 'Roles, invitations and who can see what.', icon: Users, color: '#7048e8', articles: [
    { q: 'How do I add someone?', a: 'Go to Staff, enter their email and pick a role. They accept the invitation by signing up or signing in with that email. In a school, adding a staff member with Can sign in creates their login with a temporary password that they must replace on first sign-in.' },
    { q: 'What can each role do?', a: 'Roles decide which apps and actions a person gets. A cashier works at the till, an accountant sees finance, and a teacher only reaches their own classes.' },
    { q: 'Can I stop someone without deleting them?', a: 'Yes. Suspend a person to stop their access immediately, or revoke the role. Their past records stay.' },
  ] },
  { id: 'trust', title: 'Your data and safety', blurb: 'Privacy, history and backups.', icon: ShieldCheck, color: '#017e84', articles: [
    { q: 'Can another business see my records?', a: 'No. Every business is kept separate and the database itself refuses access from anyone who is not a member.' },
    { q: 'Is there a history of changes?', a: 'Yes. Important changes are logged with who made them and when, and the log cannot be changed.' },
    { q: 'Can I delete a record?', a: 'A record that was never used (a customer who never bought, a product with no stock history) can be deleted. Anything with history is archived instead so your books stay correct.' },
  ] },
]

const POPULAR = ['install', 'return', 'expiry', 'import', 'receipt', 'suspend'] as const

export function HelpPage() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string>(TOPICS[0].id)
  const term = q.trim().toLowerCase()
  const results = useMemo(() => term ? TOPICS.flatMap((t) => t.articles.filter((a) => (a.q + ' ' + a.a).toLowerCase().includes(term)).map((a) => ({ ...a, topic: t.title }))) : [], [term])
  const topic = TOPICS.find((t) => t.id === open) ?? TOPICS[0]

  return (
    <div className="bg-white text-ink">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#f1f6fb] via-white to-white px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-20">
        <h1 className="anim-fade-up mx-auto max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">How can we <Mark>help</Mark>?</h1>
        <div className="anim-fade-up relative mx-auto mt-8 max-w-xl" style={{ '--d': '120ms' } as React.CSSProperties}>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink/40" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Search help" placeholder="Search for an answer, like returns or expiry" className="h-14 w-full rounded-full border border-line bg-white pl-12 pr-5 text-base shadow-card outline-none focus:border-amber focus:ring-2 focus:ring-amber/40" />
        </div>
        <div className="anim-fade-up mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2" style={{ '--d': '220ms' } as React.CSSProperties}>
          <span className="self-center text-sm font-semibold text-ink/60">Popular:</span>
          {POPULAR.map((p) => <button key={p} type="button" onClick={() => setQ(p)} className="rounded-full bg-white px-3.5 py-1.5 text-sm font-semibold ring-1 ring-ink/15 transition hover:-translate-y-0.5 hover:bg-amber/15 hover:shadow-card">{p}</button>)}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        {term ? (
          <div className="mx-auto max-w-3xl">
            <p className="mb-4 text-sm text-ink/60">{results.length} answer{results.length === 1 ? '' : 's'} for &ldquo;{q.trim()}&rdquo;</p>
            {results.length ? <div className="divide-y divide-ink/10 rounded-xl bg-white shadow-card ring-1 ring-ink/5">{results.map((a) => <Article key={a.topic + a.q} q={a.q} a={a.a} tag={a.topic} />)}</div>
              : <p className="rounded-xl bg-canvas p-6 text-center text-ink/70">Nothing matches that. Try a simpler word, or browse the topics by clearing the search.</p>}
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
            <ul className="grid gap-2 sm:grid-cols-2 lg:block lg:space-y-2">
              {TOPICS.map((t) => (
                <Reveal as="li" key={t.id}>
                  <button type="button" onClick={() => setOpen(t.id)} aria-pressed={open === t.id} className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition ${open === t.id ? 'bg-white shadow-raised ring-2 ring-amber' : 'bg-white shadow-card ring-1 ring-ink/5 hover:-translate-y-0.5'}`}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg text-white" style={{ background: t.color }}><t.icon className="size-5" aria-hidden /></span>
                    <span className="min-w-0"><span className="flex items-center justify-between font-semibold">{t.title}<span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-ink/55">{t.articles.length}</span></span><span className="block text-xs text-ink/60">{t.blurb}</span></span>
                  </button>
                </Reveal>
              ))}
            </ul>
            <div key={topic.id} className="anim-fade-up">
              <h2 className="text-2xl font-bold tracking-tight">{topic.title}</h2>
              <div className="mt-4 divide-y divide-ink/10 rounded-xl bg-white shadow-card ring-1 ring-ink/5">{topic.articles.map((a) => <Article key={a.q} q={a.q} a={a.a} />)}</div>
            </div>
          </div>
        )}

        <Reveal as="section" className="mt-16 grid items-center gap-6 rounded-3xl bg-gradient-to-br from-brand via-[#0f3a66] to-brand p-8 text-white sm:p-10 lg:grid-cols-[1fr_auto]">
          <div><p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-amber"><Smartphone className="size-4" aria-hidden /> On your phone</p><h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Take the help with you</h2><p className="mt-2 max-w-lg text-white/80">DOA installs to your home screen from the browser today. Google Play and App Store apps are coming soon.</p></div>
          <StoreBadges dark />
        </Reveal>

        <Reveal as="section" className="mt-16 rounded-2xl bg-canvas px-6 py-10 text-center">
          <h2 className="text-xl font-bold">New here?</h2>
          <p className="mx-auto mt-2 max-w-md text-ink/70">The quickest way to learn is to try it. Every business starts with 14 free days.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3"><Link to="/start" className="inline-flex h-11 items-center rounded-md bg-amber px-5 text-sm font-bold shadow-card transition hover:-translate-y-0.5 hover:bg-amber-dark">Try it free<ArrowRight className="ml-2 size-4" aria-hidden /></Link><Link to="/pricing" className="inline-flex h-11 items-center rounded-md bg-white px-5 text-sm font-semibold ring-2 ring-amber transition hover:bg-amber/15">See pricing</Link></div>
        </Reveal>
      </section>
      <SiteFooter />
    </div>
  )
}

function Article({ q, a, tag }: { q: string; a: string; tag?: string }) {
  return (
    <details className="group px-5 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
        <span>{q}{tag && <span className="ml-2 text-xs font-medium text-ink/50">{tag}</span>}</span>
        <span aria-hidden className="text-xl leading-none text-ink/50 transition group-open:rotate-45">+</span>
      </summary>
      <p className="mt-2 text-ink/70">{a}</p>
    </details>
  )
}
