import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { HelpPage } from '@/app/landing/HelpPage'
import { PricingPage, planFor } from '@/app/landing/PricingPage'

const page = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>)

describe('which plan fits', () => {
  it('picks the smallest plan with room for the people and branches', () => {
    expect(planFor(1, 1, false, false)).toBe('starter'); expect(planFor(3, 1, false, false)).toBe('starter'); expect(planFor(4, 1, false, false)).toBe('basic')
    expect(planFor(6, 1, false, false)).toBe('growth'); expect(planFor(5, 2, false, false)).toBe('growth'); expect(planFor(16, 1, false, false)).toBe('business'); expect(planFor(50, 10, false, false)).toBe('business')
  })
  it('moves up when suppliers, expenses or finance reports are needed', () => {
    expect(planFor(2, 1, true, false)).toBe('basic'); expect(planFor(2, 1, false, true)).toBe('growth'); expect(planFor(2, 1, true, true)).toBe('growth')
  })
  it('says so when nothing is big enough', () => { expect(planFor(51, 1, false, false)).toBeNull(); expect(planFor(5, 11, false, false)).toBeNull() })
})

describe('the pricing page', () => {
  const html = page(<PricingPage />)
  it('asks what fits you, shows all four plans and what every plan includes', () => {
    expect(html).toContain('Which plan fits you?'); expect(html).toContain('id="plans"')
    for (const p of ['Starter', 'Basic', 'Growth', 'Business']) expect(html).toContain(p)
    expect(html).toContain('Fits you'); expect(html).toContain('No per-user fees'); expect(html).toContain('Start free.')
    expect(html).toContain('Google Play: coming soon')
  })
  it('recommends a plan to start with and keeps the questions', () => { expect(html).toContain('You fit'); expect(html).toContain('Questions about'); expect(html).toContain('Is there a free trial?') })
})

describe('the help page', () => {
  const html = page(<HelpPage />)
  it('has search, popular searches, topics with article counts and the new answers', () => {
    expect(html).toContain('How can we'); expect(html).toContain('Popular:')
    for (const w of ['install', 'return', 'expiry', 'import', 'receipt', 'suspend']) expect(html).toContain(`>${w}</button>`)
    expect(html).toContain('Can I use DOA on my phone?'); expect(html).toContain('Add to Home Screen'); expect(html).toContain('Take the help with you')
  })
})
