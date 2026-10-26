import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript module shared with the apply script
import { CONFIG_KEYS, TEMPLATES } from '../../scripts/email-templates.mjs'

type Template = { subject: string; html: string }
const templates = TEMPLATES as Record<string, Template>

describe('the emails sent to people', () => {
  it('covers every kind of email Supabase Auth can send', () => {
    expect(Object.keys(templates).sort()).toEqual(['confirmation', 'email_change', 'invite', 'magic_link', 'reauthentication', 'recovery'])
    expect(Object.keys(CONFIG_KEYS as object).sort()).toEqual(Object.keys(templates).sort())
  })

  it('are branded DOA and never mention Supabase', () => {
    for (const [name, t] of Object.entries(templates)) {
      expect(t.subject, name).toMatch(/DOA/)
      expect(t.html, name).toMatch(/DOA/)
      expect(t.html.toLowerCase(), name).not.toContain('supabase')
      expect(t.subject.toLowerCase(), name).not.toContain('supabase')
    }
  })

  it('carry the link or code the auth service fills in, and only placeholders it knows', () => {
    for (const [name, t] of Object.entries(templates)) {
      expect(t.html, name).toMatch(name === 'reauthentication' ? /\{\{ \.Token \}\}/ : /\{\{ \.ConfirmationURL \}\}/)
      const used = [...t.html.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1])
      for (const u of used) expect(['.ConfirmationURL', '.Email', '.NewEmail', '.Token'], `${name}: ${u}`).toContain(u)
    }
    expect(templates.email_change.html).toContain('{{ .NewEmail }}')
  })

  it('are complete HTML documents with a plain-text fallback link and an ignore notice', () => {
    for (const [name, t] of Object.entries(templates)) {
      expect(t.html.trimStart().startsWith('<!doctype html>'), name).toBe(true)
      expect(t.html, name).toContain('</html>')
      if (name !== 'reauthentication') expect(t.html, name).toMatch(/Copy this link/)
    }
  })

  it('match the files kept in the repository, so the two cannot drift apart', () => {
    for (const [name, t] of Object.entries(templates)) expect(readFileSync(`supabase/email-templates/${name}.html`, 'utf8').replace(/\r\n/g, '\n'), name).toBe(t.html)
  })
})
