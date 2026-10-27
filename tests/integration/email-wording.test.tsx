import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CheckEmail } from '@/core/auth/CheckEmail'
import { inboxLink, suggestEmail } from '@/core/auth/emailHelp'

// @ts-ignore the template file is plain JavaScript that the apply script also uses
const load = () => import('../../supabase/email-templates/templates.mjs') as Promise<{ TEMPLATES: Record<string, { subject: string; html: string }>; SUPPORT: string }>
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('the emails Supabase sends for DOA', () => {
  it('has all six, each with a subject and a body', async () => {
    const { TEMPLATES } = await load()
    expect(Object.keys(TEMPLATES).sort()).toEqual(['confirmation', 'email_change', 'invite', 'magic_link', 'reauthentication', 'recovery'])
    for (const [k, t] of Object.entries(TEMPLATES)) { expect(t.subject.length, k).toBeGreaterThan(10); expect(t.html.length, k).toBeGreaterThan(500) }
  })
  it('uses plain subjects that name the product: short, no capitals for emphasis, no exclamation marks, no sales words', async () => {
    const { TEMPLATES } = await load()
    for (const [k, t] of Object.entries(TEMPLATES)) {
      expect(t.subject.length, k).toBeLessThanOrEqual(60); expect(t.subject, k).toContain('DOA'); expect(t.subject, k).not.toMatch(/[!?$%]|[A-Z]{4,}/); expect(t.subject.toLowerCase(), k).not.toMatch(/free|urgent|act now|click here|winner|guarantee|offer|limited/)
    }
  })
  it('keeps the body free of the things that look like spam: no sales words, shouting, shortened links, images or scripts', async () => {
    const { TEMPLATES } = await load()
    for (const [k, t] of Object.entries(TEMPLATES)) {
      const words = plain(t.html)
      expect(words, k).not.toMatch(/\bfree\b|urgent|act now|click here|winner|guarantee|limited time|buy now|\$\$|100%|!!|\bdiscount\b/i)
      expect(words.replace(/\bDOA\b/g, ''), k).not.toMatch(/\b[A-Z]{5,}\b/)
      expect(t.html, k).not.toMatch(/<img|<script|bit\.ly|tinyurl|goo\.gl|<iframe|<form/i)
      expect(t.html.replace('<!doctype html>', ''), k).not.toContain('!')
    }
  })
  it('says why the person is getting it, names the sender and says how to reach a person', async () => {
    const { TEMPLATES, SUPPORT } = await load()
    for (const [k, t] of Object.entries(TEMPLATES)) {
      const words = plain(t.html)
      expect(words, k).toContain('You are receiving this because'); expect(words, k).toContain('DOA Business Suite'); expect(words, k).toContain(SUPPORT); expect(words, k).toContain('not an advertisement'); expect(t.html, k).toContain('{{ .Email }}')
    }
  })
  it('carries the link or code Supabase fills in, as a button and again as plain text, and never an empty link', async () => {
    const { TEMPLATES } = await load()
    for (const k of ['confirmation', 'invite', 'magic_link', 'recovery', 'email_change']) {
      const html = TEMPLATES[k].html
      expect(html.match(/\{\{ \.ConfirmationURL \}\}/g)?.length, k).toBe(3) // the button's address, the plain-text line and its address
      expect(html, k).toContain('Or copy this link into your browser'); expect(html, k).not.toContain('href=""')
    }
    expect(TEMPLATES.reauthentication.html).toContain('{{ .Token }}'); expect(TEMPLATES.email_change.html).toContain('{{ .NewEmail }}')
  })
  it('greets by name when the sign-up gave one, and is still polite when it did not', async () => {
    const { TEMPLATES } = await load()
    expect(TEMPLATES.confirmation.html).toContain('{{ if .Data.name }}Hello {{ .Data.name }},{{ else }}Hello,{{ end }}')
  })
  it('is well-formed: a language, a title, a viewport, and a hidden preview line for the inbox list', async () => {
    const { TEMPLATES } = await load()
    for (const [k, t] of Object.entries(TEMPLATES)) { expect(t.html, k).toMatch(/^<!doctype html>/i); expect(t.html, k).toContain('<html lang="en">'); expect(t.html, k).toContain('<title>'); expect(t.html, k).toContain('name="viewport"'); expect(t.html, k).toContain('display:none') }
  })
  it('asks the person to use the same address for an invitation, which is how it is matched', async () => {
    const { TEMPLATES } = await load()
    expect(plain(TEMPLATES.invite.html)).toContain('use this same email address')
  })
})

describe('catching a mistyped address before the email is sent', () => {
  it('suggests the well-known address when the domain is one slip away', () => {
    for (const [typed, fix] of [['ada@gmial.com', 'ada@gmail.com'], ['ada@gmail.con', 'ada@gmail.com'], ['ada@gmai.com', 'ada@gmail.com'], ['ada@gamil.com', 'ada@gmail.com'], ['ada@hotmial.com', 'ada@hotmail.com'], ['ada@yahooo.com', 'ada@yahoo.com'], ['ada@outlok.com', 'ada@outlook.com'], ['ada@iclod.com', 'ada@icloud.com']]) expect(suggestEmail(typed), typed).toBe(fix)
  })
  it('leaves a correct address, a company address and a different well-known one alone', () => {
    for (const ok of ['ada@gmail.com', 'ada@yahoo.com', 'ada@school.edu.ng', 'ada@acme-stores.com', 'ada@cloudtech.ng', 'ada@gmail.co.uk', 'ada@live.com', 'ada@proton.me']) expect(suggestEmail(ok), ok).toBeNull()
  })
  it('never changes the part before the @, and ignores what is not an address', () => {
    expect(suggestEmail('Ada.Obi+shop@gmial.com')).toBe('Ada.Obi+shop@gmail.com'); expect(suggestEmail('not an email')).toBeNull(); expect(suggestEmail('')).toBeNull(); expect(suggestEmail('a@b@gmial.com')).toBeNull()
  })
  it('is case-insensitive about the domain', () => { expect(suggestEmail('ada@GMIAL.com')).toBe('ada@gmail.com') })
})

describe('opening the inbox after sign-up', () => {
  it('links to the right inbox for the common mail services, and to none for a company address', () => {
    expect(inboxLink('a@gmail.com')).toEqual({ name: 'Gmail', url: 'https://mail.google.com/' }); expect(inboxLink('a@googlemail.com')?.name).toBe('Gmail')
    expect(inboxLink('a@outlook.com')?.name).toBe('Outlook'); expect(inboxLink('a@HOTMAIL.com')?.name).toBe('Outlook'); expect(inboxLink('a@yahoo.com')?.name).toBe('Yahoo Mail'); expect(inboxLink('a@icloud.com')?.name).toBe('iCloud Mail')
    expect(inboxLink('a@acme-stores.com')).toBeNull(); expect(inboxLink('nonsense')).toBeNull()
  })
  it('shows the check-email screen with the address, the sender, what to look for, the spam folder and a way to ask for help', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CheckEmail email="ada@gmail.com" reason="signup" onBack={() => undefined} /></MemoryRouter>)
    for (const s of ['Check your email', 'ada@gmail.com', 'Open Gmail', 'https://mail.google.com/', 'DOA Business Suite', 'doabusinesssuite@gmail.com', 'Confirm your email address for DOA Business Suite', 'Spam', 'Not spam', 'Send it again in', 'Use a different email', 'href="/contact"']) expect(html).toContain(s)
  })
  it('has no inbox button for an address it cannot link to, and says when the address was not confirmed yet', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CheckEmail email="ada@acme-stores.com" reason="unconfirmed" onBack={() => undefined} /></MemoryRouter>)
    expect(html).not.toContain('target="_blank"'); expect(html).toContain('This email has not been confirmed yet.')
  })
})
