import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SignInPage, SignUpPage } from '@/core/auth/AuthPages'
import { CONTACT_TOPICS, PRIVACY, TERMS } from '@/app/landing/legalContent'
import { ContactPage, PrivacyPage, TermsPage } from '@/app/landing/LegalPages'
import { SiteFooter } from '@/app/landing/SiteFooter'
import { SITE, mailto } from '@/shared/utilities/site'

const page = (el: React.ReactElement, path = '/') => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>)
const text = (sections: { title: string; paragraphs?: string[]; bullets?: string[] }[]) => sections.flatMap((s) => [s.title, ...(s.paragraphs ?? []), ...(s.bullets ?? [])]).join('\n')

const store = new Map<string, string>()
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
beforeEach(() => { store.clear(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } }) })
afterEach(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original) })

describe('who runs DOA, in one place', () => {
  it('names the company and the support address the public pages use', () => {
    expect(SITE.company).toBe('DOA Business Suite'); expect(SITE.supportEmail).toBe('doabusinesssuite@gmail.com'); expect(SITE.legalUpdated).toMatch(/2026/)
  })
  it('builds a mail link to that address, with a subject and body when given', () => {
    expect(mailto()).toBe('mailto:doabusinesssuite@gmail.com'); expect(mailto('Help with DOA')).toBe('mailto:doabusinesssuite@gmail.com?subject=Help%20with%20DOA')
    expect(mailto('A b', 'c&d')).toBe('mailto:doabusinesssuite@gmail.com?subject=A%20b&body=c%26d')
  })
})

describe('the Terms of use', () => {
  it('cover who we are, accounts, data ownership, schools and children, proper use, money, advice, liability, ending and the law', () => {
    expect(TERMS.map((s) => s.id)).toEqual(['who', 'accounts', 'your-data', 'schools', 'use', 'money', 'not-advice', 'service', 'ending', 'law'])
    const t = text(TERMS)
    for (const s of ['DOA Business Suite', 'belongs to you', 'school is responsible', 'cash basis', 'not an accounting package', 'governed by the laws of the Federal Republic of Nigeria', 'doabusinesssuite@gmail.com', 'does not replace a pharmacist']) expect(t.toLowerCase()).toContain(s.toLowerCase())
  })
  it('promise nothing the product cannot do: no online card payment, and no claim of perfect uptime', () => {
    const t = text(TERMS)
    expect(t).toContain('Online card payment for plans is not available yet'); expect(t).toMatch(/cannot promise it will never be interrupted/)
    expect(t).not.toMatch(/100%|guarantee|24\/7|always available/i)
  })
  it('render as a page with a contents list, numbered headings and the date', () => {
    const html = page(<TermsPage />, '/terms')
    expect(html).toContain('Terms of use'); expect(html).toContain('On this page'); expect(html).toContain(SITE.legalUpdated)
    for (const s of TERMS) { expect(html).toContain(`id="${s.id}"`); expect(html).toContain(`href="#${s.id}"`) }
    expect(html).toContain('1. Who we are'); expect(html).toContain('href="/privacy"')
  })
})

describe('the Privacy notice', () => {
  const t = text(PRIVACY)
  it('says what is held, why, who sees it, where it is kept, how it is protected, for how long, and what the person can do', () => {
    expect(PRIVACY.map((s) => s.id)).toEqual(['summary', 'who', 'what', 'children', 'why', 'who-sees', 'abroad', 'security', 'keep', 'rights', 'cookies', 'changes'])
    for (const s of ['controller', 'Supabase', 'Vercel', 'Google', 'Ireland', 'HTTPS', 'audit log', 'Nigeria Data Protection Act 2023', 'Nigeria Data Protection Commission', 'one month', 'advertising or tracking cookies']) expect(t).toContain(s)
  })
  it('treats children\'s information as sensitive and puts the school in charge of it', () => {
    const kids = PRIVACY.find((s) => s.id === 'children')!
    const k = [...(kids.paragraphs ?? [])].join(' ')
    expect(k).toMatch(/sensitive/); expect(k).toMatch(/school is responsible/); expect(k).toMatch(/never use it for advertising or sell it/); expect(k).toMatch(/own children/)
  })
  it('says only what is true of the product: no card numbers, no marketing without asking, no tracking, no health records', () => {
    expect(t).toContain('we do not collect card numbers'); expect(t).toContain('We do not send marketing email without asking you first')
    expect(t).not.toMatch(/health/i); expect(t).not.toMatch(/google analytics|facebook pixel|sell your data to/i)
  })
  it('render as a page with its contents and a link back to the Terms and the Contact page', () => {
    const html = page(<PrivacyPage />, '/privacy')
    expect(html).toContain('Privacy notice'); for (const s of PRIVACY) expect(html).toContain(`id="${s.id}"`)
    expect(html).toContain('href="/terms"'); expect(html).toContain('href="/contact"')
  })
  it('have unique section ids, and no section is empty', () => {
    for (const doc of [TERMS, PRIVACY]) { expect(new Set(doc.map((s) => s.id)).size).toBe(doc.length); for (const s of doc) expect((s.paragraphs?.length ?? 0) + (s.bullets?.length ?? 0), s.id).toBeGreaterThan(0) }
  })
})

describe('the Contact page', () => {
  it('shows the support address as a mail link, and a ready-made email for each reason', () => {
    const html = page(<ContactPage />, '/contact')
    expect(html).toContain('doabusinesssuite@gmail.com'); expect(html).toContain('href="mailto:doabusinesssuite@gmail.com?subject=Help%20with%20DOA"')
    for (const c of CONTACT_TOPICS) { expect(html).toContain(c.title.replace(/'/g, '&#x27;')); expect(html).toContain(`subject=${encodeURIComponent(c.subject)}`) }
  })
  it('covers help, starting, a copy or deletion of records, a child\'s record, and a security problem', () => {
    expect(CONTACT_TOPICS.map((c) => c.subject)).toEqual(['Help with DOA', 'Starting with DOA', 'My records', 'Question about a student record', 'Security report'])
  })
  it('never asks for a password', () => { expect(page(<ContactPage />, '/contact')).toContain('never send your password'); expect(page(<ContactPage />, '/contact')).toContain('never ask for it') })
})

describe('where the pages are linked from', () => {
  it('is the footer of the website, with the company name', () => {
    const html = page(<SiteFooter />)
    for (const to of ['/contact', '/terms', '/privacy']) expect(html).toContain(`href="${to}"`)
    expect(html).toContain('DOA Business Suite'); expect(html).not.toContain('CloudTech')
  })
  it('is the create-account form, which says that creating an account means agreeing to them, and not the sign-in form', () => {
    const up = page(<SignUpPage />, '/sign-up')
    expect(up).toContain('By creating an account you agree to the'); expect(up).toContain('href="/terms"'); expect(up).toContain('href="/privacy"')
    expect(page(<SignInPage />, '/sign-in')).not.toContain('By creating an account you agree')
  })
})
