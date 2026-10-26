import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LandingPage } from '@/app/landing/LandingPage'
import { SCREENS } from '@/app/landing/phones/screens'

const html = renderToStaticMarkup(<MemoryRouter><LandingPage /></MemoryRouter>)

describe('the landing page', () => {
  it('opens with a hero that promises one app, shows two phones, and offers the free start', () => {
    expect(html).toContain('aria-label="Every business you run. One app."')
    expect(html).toContain('Start free for 14 days'); expect(html).toContain('See how it works')
    expect(html).toContain('DOA running on an iPhone and an Android phone')
    expect(html).toContain('New: online schools with their own courses')
  })

  it('marks the app store badges as coming soon and says the site installs today', () => {
    expect(html).toContain('Google Play: coming soon'); expect(html).toContain('App Store: coming soon')
    expect(html).toContain('Installs from your browser today')
    expect(html).toContain('Add to Home Screen')
  })

  it('walks through how it works, and replaces the long list of apps with a picker for your kind of business', () => {
    expect(html).toContain('id="how"'); for (const t of ['Pick your business', 'Record in seconds', 'Get paid and see where you stand']) expect(html).toContain(t)
    expect(html).toContain('id="apps"'); expect(html).toContain('id="industries"'); expect(html).toContain('role="tablist"')
    for (const name of ['Retail', 'Farm', 'Bakery', 'Pharmacy', 'School']) expect(html).toContain(name)
    expect(html).not.toContain('Choose your <span'); expect(html).not.toContain('Business apps'); expect(html).not.toContain('Industry apps')
  })

  it('still has the shared apps, the mobile section, why DOA and the closing call to action', () => {
    expect(html).toContain('every business'); expect(html).toContain('id="mobile"'); expect(html).toContain('in your pocket'); expect(html).toContain('id="why"'); expect(html).toContain('Try it free')
  })

  it('keeps every phone screen in the page for the transitions, with only one in view', () => {
    for (const s of Object.values(SCREENS)) expect(html.length).toBeGreaterThan(0), expect(s.node).toBeTruthy()
    expect(html).toContain('Charge ₦96,700'); expect(html).toContain('Save register'); expect(html).toContain('Expiry watch')
  })
})
