import { Mail } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { SITE, mailto } from '@/shared/utilities/site'
import { CONTACT_TOPICS, PRIVACY, TERMS } from './legalContent'
import type { LegalSection } from './legalContent'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

function Shell({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-white text-ink">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-14 sm:px-6 sm:pt-20">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        <div className="mt-3 text-base text-ink/70">{intro}</div>
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}

function Document({ title, sections }: { title: string; sections: LegalSection[] }) {
  return (
    <Shell title={title} intro={<p>Last updated {SITE.legalUpdated}. Written in plain language. Questions: <a className="font-semibold underline" href={mailto(`Question about the ${title}`)}>{SITE.supportEmail}</a>.</p>}>
      <nav aria-label="Contents" className="mt-8 rounded-xl border border-line bg-surface p-4 text-sm">
        <p className="mb-2 font-semibold">On this page</p>
        <ol className="list-decimal space-y-1 pl-5">{sections.map((s) => <li key={s.id}><a className="hover:underline" href={`#${s.id}`}>{s.title}</a></li>)}</ol>
      </nav>
      <div className="mt-8 space-y-9">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24">
            <h2 id={`${s.id}-h`} className="text-xl font-bold">{i + 1}. {s.title}</h2>
            {s.paragraphs?.map((p) => <p key={p} className="mt-3 leading-relaxed text-ink/85">{p}</p>)}
            {s.bullets && <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-ink/85">{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
          </section>
        ))}
      </div>
      <p className="mt-12 text-sm text-ink/60">See also the <Link className="font-semibold underline" to={title === 'Terms of use' ? '/privacy' : '/terms'}>{title === 'Terms of use' ? 'Privacy notice' : 'Terms of use'}</Link> and the <Link className="font-semibold underline" to="/contact">Contact page</Link>.</p>
    </Shell>
  )
}

export const TermsPage = () => <Document title="Terms of use" sections={TERMS} />
export const PrivacyPage = () => <Document title="Privacy notice" sections={PRIVACY} />

/** How to reach us, with a ready-made email for each common reason so the message arrives with what we need. */
export function ContactPage() {
  return (
    <Shell title="Contact and support" intro={<p>Write to us and we will reply by email. The more you tell us, the faster we can help.</p>}>
      <a href={mailto('Help with DOA')} className="mt-8 flex items-center gap-4 rounded-2xl border border-line bg-white p-5 shadow-card hover:bg-surface">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-amber text-ink"><Mail className="size-6" aria-hidden /></span>
        <span><span className="block text-sm text-ink/60">Email us at</span><span className="block text-lg font-bold">{SITE.supportEmail}</span></span>
      </a>
      <h2 className="mb-3 mt-10 text-xl font-bold">What are you writing about?</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
        {CONTACT_TOPICS.map((t) => (
          <li key={t.title} className="p-4">
            <p className="font-semibold">{t.title}</p>
            <p className="mt-1 text-sm text-ink/75">{t.body}</p>
            <a className="mt-2 inline-block text-sm font-semibold text-accent underline" href={mailto(t.subject)}>Write to us about this</a>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-ink/60">Please never send your password in an email. We will never ask for it. Our <Link className="font-semibold underline" to="/help">Help page</Link> answers common questions, and the <Link className="font-semibold underline" to="/terms">Terms</Link> and <Link className="font-semibold underline" to="/privacy">Privacy notice</Link> explain how DOA works with your information.</p>
    </Shell>
  )
}
