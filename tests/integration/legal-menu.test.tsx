import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SiteNav } from '@/app/landing/SiteNav'
import { LEGAL, landingMenus } from '@/app/navigation/navigation'
import { INDUSTRIES } from '@/core/industry-registry'

const { industries } = landingMenus()
const legal = industries.find((c) => c.id === 'legal')!

describe('Legal & Law Firms in the Industries menu', () => {
  it('is the last entry, after the five industries, which are unchanged', () => {
    expect(industries.map((c) => c.id)).toEqual(['retail', 'farm', 'bakery', 'pharmacy', 'school', 'legal'])
  })
  it('has the title, the description and the six features it was given, in order', () => {
    expect(legal.title).toBe('Legal & Law Firms')
    expect(legal.description).toBe('Legal practice management for law firms, legal teams, and professional legal practitioners.')
    expect(legal.items.map((i) => i.label)).toEqual(['Clients & Contacts', 'Matters & Cases', 'Legal Documents', 'Calendar & Tasks', 'Time Tracking & Billing', 'Reports & Analytics'])
  })
  it('sends the call to action, and every feature, to The Counsel website, as an outside link', () => {
    expect(legal.cta).toEqual({ label: 'Start with Legal', to: 'https://thecounsels.org', external: true })
    expect(legal.items.every((i) => i.to === 'https://thecounsels.org' && i.external === true)).toBe(true)
    expect(LEGAL.url).toBe('https://thecounsels.org')
  })
  it('has its own colour, different from every other industry and app in the menu', () => {
    const others = [...industries.filter((c) => c.id !== 'legal'), ...landingMenus().apps].map((c) => c.color.toLowerCase())
    expect(others).not.toContain(legal.color.toLowerCase()); expect(legal.color).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it('is only a menu entry: not an industry of DOA, so nothing else in the product lists it', () => {
    expect(Object.keys(INDUSTRIES)).not.toContain('legal')
  })
  it('does not change the other industries: they still point inside DOA, to their own start page', () => {
    for (const c of industries.filter((x) => x.id !== 'legal')) { expect(c.cta?.to).toBe(`/start?type=${c.id}`); expect(c.cta?.external).toBeUndefined(); expect(c.items.every((i) => !i.external)).toBe(true) }
  })
})

describe('the menu on the page', () => {
  it('is closed until opened, so the site loads as before', () => {
    const html = renderToStaticMarkup(<MemoryRouter><SiteNav /></MemoryRouter>)
    expect(html).toContain('Industries'); expect(html).not.toContain('Legal &amp; Law Firms')
  })
})
