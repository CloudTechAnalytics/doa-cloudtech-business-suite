import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(p, 'utf8')

describe('the installable app (PWA)', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest')) as { name: string; short_name: string; start_url: string; scope: string; display: string; theme_color: string; background_color: string; icons: { src: string; sizes: string; type: string; purpose: string }[] }

  it('has the manifest an Android install and the Play Store need', () => {
    expect(manifest).toMatchObject({ short_name: 'DOA', display: 'standalone', scope: '/', start_url: '/businesses' })
    expect(manifest.name.length).toBeGreaterThan(2); expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i); expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i)
    const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`)
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']))
  })

  it('has every icon it names, as a real PNG of the right size', () => {
    for (const icon of manifest.icons) {
      const path = `public${icon.src}`
      expect(existsSync(path), path).toBe(true)
      const buf = readFileSync(path)
      expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      const [w] = icon.sizes.split('x').map(Number)
      expect(buf.readUInt32BE(16)).toBe(w); expect(buf.readUInt32BE(20)).toBe(w)
    }
    expect(existsSync('public/icons/apple-touch-icon.png')).toBe(true)
  })

  it('is linked from the page, with the colours and the iPhone settings', () => {
    const html = read('index.html')
    for (const needle of ['rel="manifest" href="/manifest.webmanifest"', 'name="theme-color"', 'rel="apple-touch-icon"', 'apple-mobile-web-app-capable']) expect(html).toContain(needle)
  })

  it('keeps a service worker that stores only the app\'s own files, never data', () => {
    const sw = read('public/sw.js')
    expect(sw).toContain("url.origin !== self.location.origin")   // the database, sign-in and other sites go straight to the network
    expect(sw).toContain("req.method !== 'GET'")                    // nothing that writes is ever touched
    expect(sw).toMatch(/\/assets\//); expect(sw).not.toMatch(/supabase|api\/|rest\/v1|auth\/v1/i)
    expect(existsSync('public/offline.html')).toBe(true)
  })
})

describe('phone layouts', () => {
  const css = read('src/index.css')
  it('turns every table into cards on a phone, except the ones that opt out', () => {
    expect(css).toMatch(/@media \(max-width: 639px\) \{\s*main table:not\(\[data-keep-table\]\) \{ display: block;/)
    expect(css).toContain('td::before { content: attr(data-label)')
    expect(read('src/industries/school/components/TimetableGrid.tsx')).toContain('<table data-keep-table')
  })
  it('labels the cells so a card says what each line is, in the app and in the platform console', () => {
    expect(read('src/app/layouts/AppShell.tsx')).toContain('useGridLabels(true, mainRef)')
    expect(read('src/core/platform-admin/PlatformLayout.tsx')).toContain('useGridLabels(true, mainRef)')
  })
})
